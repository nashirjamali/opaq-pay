import {
  createStealthSigner,
  deriveStealthScalar,
  getCashOutInstructions,
  getRelayerSigner,
  getSweepToVaultInstructions,
  sendPlanViaRelayer,
  type DetectedPayment,
  type MetaKeys,
} from "@opaq/sdk";
import { sequentialInstructionPlan, type Address } from "@solana/kit";
import { getVault, rpc } from "./chain";
import { loadConfidential } from "./confidential";
import { relayer } from "./env";
import { waitFor } from "./shield";

export type CashOutPhase = "sweep" | "unshield" | "send" | "close";

export interface CashOutProgress {
  /** 1-based index of the payment being cashed out. */
  current: number;
  total: number;
  phase: CashOutPhase;
}

export const CASH_OUT_PHASE_LABEL: Record<CashOutPhase, string> = {
  sweep: "Moving the USDC into the vault",
  unshield: "Taking the amount out of your private balance",
  send: "Sending the USDC",
  close: "Closing the one-time account",
};

/**
 * Sends everything the given payments hold to `recipient` as USDC, one payment at a time:
 * sweep what is still at the stealth address, unshield what is private, withdraw from the vault,
 * then close the emptied stealth account. Every step is signed by the one-time stealth key and
 * paid for by the relayer, so the wallet is not prompted.
 *
 * The withdrawal is public: it shows the amount, the recipient, and which stealth accounts paid
 * it. The caller must have told the person that before calling this.
 *
 * It reads where each payment stands first, so running it again after a failure resumes instead
 * of repeating work. Returns the USDC sent in this run, in whole units.
 */
export async function cashOutPayments(input: {
  keys: MetaKeys;
  payments: DetectedPayment[];
  recipient: Address;
  onProgress: (progress: CashOutProgress) => void;
}): Promise<number> {
  if (!relayer) throw new Error("Cashing out needs the Opaq relayer, which is not configured.");
  const vault = await getVault();
  const confidential = await loadConfidential();
  const relayerSigner = await getRelayerSigner(relayer);
  const total = input.payments.length;
  let sent = 0n;

  for (const [index, payment] of input.payments.entries()) {
    const progress = (phase: CashOutPhase) => input.onProgress({ current: index + 1, total, phase });
    const stealthSigner = createStealthSigner(deriveStealthScalar(input.keys.spendSeed, payment.tweak));
    const ctInput = { rpc, payer: relayerSigner, stealthSigner, scanSeed: input.keys.scanSeed, vault };
    const readBalance = () =>
      confidential.fetchStealthWrappedBalance(rpc, { scanSeed: input.keys.scanSeed, stealthAddress: payment.stealthAddress, vault });

    if (payment.amount > 0n) {
      progress("sweep");
      const instructions = await getSweepToVaultInstructions({
        stealthSigner,
        vault,
        amount: payment.amount,
        rentRecipient: relayerSigner.address,
        accountPayer: relayerSigner,
      });
      await sendPlanViaRelayer({ rpc, relayer, plan: sequentialInstructionPlan(instructions) });
      await waitFor(readBalance, (b) => b.exists, "the vault deposit");
    }

    let balance = await readBalance();
    if (!balance.exists) continue;

    if (balance.available > 0n) {
      progress("unshield");
      await sendPlanViaRelayer({ rpc, relayer, plan: await confidential.getUnshieldInstructionPlan(ctInput) });
      balance = await waitFor(readBalance, (b) => b.available === 0n, "the unshielded balance");
    }

    if (balance.publicAmount > 0n) {
      progress("send");
      const amount = balance.publicAmount;
      const instructions = await getCashOutInstructions({ owner: stealthSigner, vault, amount, recipient: input.recipient, accountPayer: relayerSigner });
      await sendPlanViaRelayer({ rpc, relayer, plan: sequentialInstructionPlan(instructions) });
      balance = await waitFor(readBalance, (b) => b.publicAmount === 0n, "the withdrawal");
      sent += amount;
    }

    if (balance.total === 0n) {
      // Housekeeping after the money has arrived: it returns the account's rent to the relayer.
      // A failure here must not be reported as a failed cash out.
      try {
        progress("close");
        const plan = await confidential.getCloseStealthAccountInstructionPlan({ ...ctInput, rentRecipient: relayerSigner.address });
        await sendPlanViaRelayer({ rpc, relayer, plan });
      } catch {
        /* the emptied account stays open; nothing of the recipient's is in it */
      }
    }
  }
  return Number(sent) / 10 ** vault.decimals;
}
