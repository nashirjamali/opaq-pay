import {
  createStealthSigner,
  deriveStealthScalar,
  getSweepToVaultInstructions,
  sendPlanViaRelayer,
  getRelayerSigner,
  type DetectedPayment,
  type MetaKeys,
} from "@opaq/sdk";
import { sequentialInstructionPlan, type InstructionPlan } from "@solana/kit";
import { getVault, rpc } from "./chain";
import { loadConfidential } from "./confidential";
import { relayer } from "./env";

export type MovePhase = "sweep" | "prepare" | "shield";

export interface MoveProgress {
  /** 1-based index of the payment being moved. */
  current: number;
  total: number;
  phase: MovePhase;
}

export const MOVE_PHASE_LABEL: Record<MovePhase, string> = {
  sweep: "Moving the USDC into the vault",
  prepare: "Preparing your private account",
  shield: "Making the balance private",
};

/** Polls until the chain shows a step's result. Reads default to finalized commitment, so a fresh write can lag. */
async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}. Try again in a moment.`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const single = (plan: InstructionPlan) => plan;

/**
 * Moves payments into the private balance, one at a time: sweep the USDC into the vault, set up
 * the stealth wrapper account for confidential transfers, then shield it. Every step is signed by
 * the one-time stealth key (derived here, never sent anywhere) and paid for by the relayer, so no
 * wallet prompt is needed and nothing links the payment to the recipient's wallet.
 *
 * It reads where each payment stands first, so running it again after a failure resumes instead
 * of repeating work.
 */
export async function movePaymentsToPrivate(input: {
  keys: MetaKeys;
  payments: DetectedPayment[];
  onProgress: (progress: MoveProgress) => void;
}): Promise<void> {
  if (!relayer) throw new Error("Moving payments needs the Opaq relayer, which is not configured.");
  const vault = await getVault();
  const confidential = await loadConfidential();
  const relayerSigner = await getRelayerSigner(relayer);
  const total = input.payments.length;

  for (const [index, payment] of input.payments.entries()) {
    const progress = (phase: MovePhase) => input.onProgress({ current: index + 1, total, phase });
    const stealthSigner = createStealthSigner(deriveStealthScalar(input.keys.spendSeed, payment.tweak));
    const ctInput = { rpc, stealthSigner, scanSeed: input.keys.scanSeed, vault };
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
      await sendPlanViaRelayer({ rpc, relayer, plan: single(sequentialInstructionPlan(instructions)) });
      await waitFor(readBalance, (b) => b.exists, "the vault deposit");
    }

    let balance = await readBalance();
    if (!balance.exists) continue;
    if (!balance.confidential) {
      progress("prepare");
      const plan = await confidential.getConfigureStealthAccountInstructionPlan({ ...ctInput, payer: relayerSigner });
      await sendPlanViaRelayer({ rpc, relayer, plan });
      balance = await waitFor(readBalance, (b) => b.confidential, "the private account");
    }

    if (balance.publicAmount > 0n) {
      progress("shield");
      const instructions = await confidential.getShieldInstructions(ctInput);
      if (instructions.length > 0) {
        await sendPlanViaRelayer({ rpc, relayer, plan: single(sequentialInstructionPlan(instructions)) });
        await waitFor(readBalance, (b) => b.publicAmount === 0n, "the shielded balance");
      }
    }
  }
}
