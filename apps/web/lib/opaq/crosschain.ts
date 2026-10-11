import {
  CCTP_ERC20_ABI,
  CCTP_TOKEN_MESSENGER_ABI,
  createThrowawaySigner,
  decodeCctpBurnMessage,
  fetchCctpTransferQuote,
  getCctpAnnounceInstruction,
  getCctpDepositForBurnArgs,
  getCctpReceiveMessageInstruction,
  getPrepareCctpPaymentInstructions,
  getRelayerSigner,
  isCctpMessageReceived,
  sendPlanViaRelayer,
  waitForCctpAttestation,
  type CctpSourceChain,
  type ChainId,
  type HexString,
  type MetaAddress,
  type VaultSettings,
} from "@opaq/sdk";
import { sequentialInstructionPlan } from "@solana/kit";
import { parseAbi, type Account, type Chain, type PublicClient, type Transport, type WalletClient } from "viem";
import { rpc } from "./chain";
import { config, relayer } from "./env";

export type CrossChainPhase = "prepare" | "approve" | "burn" | "attest" | "mint";

export const CROSS_CHAIN_PHASE_LABEL: Record<CrossChainPhase, string> = {
  prepare: "Preparing a one-time address on Solana",
  approve: "Approve the USDC in your wallet",
  burn: "Confirm the payment in your wallet",
  attest: "Waiting for Circle to confirm the transfer",
  mint: "Delivering the USDC on Solana",
};

/**
 * A payment that left the source chain and has not been delivered on Solana yet. Everything in
 * it is public chain data, so it can be kept in the browser to finish the payment after a reload.
 */
export interface PendingCrossChainPayment {
  chain: ChainId;
  handle: string;
  /** USDC base units burned on the source chain. */
  amount: string;
  stealthTokenAccount: string;
  burnTx: HexString;
}

export interface CrossChainResult {
  burnTx: HexString;
  /** Null when somebody else had already delivered the message. */
  mintSignature: string | null;
  /** USDC base units that reached the recipient (the burned amount minus Circle's fee). */
  received: bigint;
}

const erc20 = parseAbi(CCTP_ERC20_ABI);
const tokenMessenger = parseAbi(CCTP_TOKEN_MESSENGER_ABI);

function requireRelayer() {
  if (!relayer) throw new Error("Paying from another chain needs the Opaq relayer, which is not configured.");
  return relayer;
}

/**
 * Pays from an EVM chain: the relayer creates the one-time address's USDC account on Solana and
 * relays its announcement, the payer's wallet approves and burns the USDC, and the payment is
 * then finished with `finishCrossChainPayment`.
 *
 * The announcement goes first on purpose. Once it is on chain the recipient can find the
 * one-time address whatever happens to this browser, so a burn can no longer end up somewhere
 * nobody knows about. `onPending` fires as soon as the burn is sent: keep what it gives you.
 */
export async function payFromEvm(input: {
  source: CctpSourceChain;
  handle: string;
  meta: MetaAddress;
  vault: VaultSettings;
  amount: bigint;
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient;
  onProgress: (phase: CrossChainPhase) => void;
  onPending: (pending: PendingCrossChainPayment) => void;
}): Promise<CrossChainResult> {
  const { source, vault, amount, walletClient, publicClient } = input;
  const relayerClient = requireRelayer();
  const payer = walletClient.account.address;

  const [balance, allowance] = await Promise.all([
    publicClient.readContract({ address: source.usdc, abi: erc20, functionName: "balanceOf", args: [payer] }),
    publicClient.readContract({ address: source.usdc, abi: erc20, functionName: "allowance", args: [payer, source.tokenMessenger] }),
  ]);
  if (balance < amount) throw new Error(`This wallet does not have enough USDC on ${source.name} for that amount.`);
  const quote = await fetchCctpTransferQuote(source, amount);

  input.onProgress("prepare");
  const relayerSigner = await getRelayerSigner(relayerClient);
  const prepared = await getPrepareCctpPaymentInstructions({
    accountPayer: relayerSigner,
    meta: input.meta,
    mint: vault.underlyingMint,
    tokenProgram: vault.underlyingTokenProgram,
  });
  const announce = await getCctpAnnounceInstruction({ announcer: createThrowawaySigner(), payment: prepared.payment, programs: config.programs });
  await sendPlanViaRelayer({ rpc, relayer: relayerClient, plan: sequentialInstructionPlan([...prepared.instructions, announce]) });

  if (allowance < amount) {
    input.onProgress("approve");
    const approveTx = await walletClient.writeContract({ address: source.usdc, abi: erc20, functionName: "approve", args: [source.tokenMessenger, amount] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    if (receipt.status !== "success") throw new Error("The approval did not go through. Nothing was sent.");
  }

  input.onProgress("burn");
  const burnTx = await walletClient.writeContract({
    address: source.tokenMessenger,
    abi: tokenMessenger,
    functionName: "depositForBurn",
    args: getCctpDepositForBurnArgs({ source, amount, mintRecipient: prepared.mintRecipient, quote }),
  });
  const pending: PendingCrossChainPayment = {
    chain: source.chain,
    handle: input.handle,
    amount: amount.toString(),
    stealthTokenAccount: prepared.stealthTokenAccount,
    burnTx,
  };
  input.onPending(pending);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: burnTx });
  if (receipt.status !== "success") throw new Error(`The payment failed on ${source.name}. Nothing was sent.`);

  return finishCrossChainPayment({ source, vault, pending, onProgress: input.onProgress });
}

/**
 * Finishes a payment whose burn is already on the source chain: waits for Circle's attestation
 * and has the relayer deliver it, which mints the USDC into the one-time address. It needs no
 * wallet, so it also runs after a reload. Safe to repeat: a delivered message is not sent again.
 */
export async function finishCrossChainPayment(input: {
  source: CctpSourceChain;
  vault: VaultSettings;
  pending: PendingCrossChainPayment;
  onProgress: (phase: CrossChainPhase) => void;
  timeoutMs?: number;
}): Promise<CrossChainResult> {
  const { source, pending } = input;
  const relayerClient = requireRelayer();

  input.onProgress("attest");
  const attested = await waitForCctpAttestation(source, pending.burnTx, { timeoutMs: input.timeoutMs });
  // The attestation API is untrusted: only deliver the message this payment is waiting for.
  const decoded = decodeCctpBurnMessage(attested.message);
  if (decoded.sourceDomain !== source.domain || decoded.mintRecipient !== pending.stealthTokenAccount) {
    throw new Error("The transfer Circle reported does not match this payment.");
  }
  const result = (mintSignature: string | null): CrossChainResult => ({
    burnTx: pending.burnTx,
    mintSignature,
    received: decoded.amount - decoded.feeExecuted,
  });

  input.onProgress("mint");
  if (await isCctpMessageReceived(rpc, attested.message)) return result(null);
  const instruction = await getCctpReceiveMessageInstruction(rpc, {
    payer: await getRelayerSigner(relayerClient),
    ...attested,
    mint: input.vault.underlyingMint,
  });
  try {
    const [signature] = await sendPlanViaRelayer({ rpc, relayer: relayerClient, plan: sequentialInstructionPlan([instruction]) });
    return result(signature ?? null);
  } catch (error) {
    // Anyone may deliver an attested message; if someone did in the meantime, the payment is done.
    if (await isCctpMessageReceived(rpc, attested.message)) return result(null);
    throw error;
  }
}

// A pending payment is public chain data, so the browser may keep it. It lets a reload finish a
// payment whose USDC has already left the source chain.
const pendingKey = (handle: string) => `opaq:xpay:${handle}`;

export function recallPendingPayment(handle: string): PendingCrossChainPayment | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pendingKey(handle)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const p = value as Record<string, unknown>;
    const ok =
      p.handle === handle &&
      typeof p.chain === "string" &&
      typeof p.amount === "string" &&
      /^\d+$/.test(p.amount) &&
      typeof p.stealthTokenAccount === "string" &&
      typeof p.burnTx === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(p.burnTx);
    return ok ? (value as PendingCrossChainPayment) : null;
  } catch {
    return null;
  }
}

export function rememberPendingPayment(pending: PendingCrossChainPayment): void {
  try {
    localStorage.setItem(pendingKey(pending.handle), JSON.stringify(pending));
  } catch {
    /* storage can be blocked; the payment still finishes if this tab stays open */
  }
}

export function forgetPendingPayment(handle: string): void {
  try {
    localStorage.removeItem(pendingKey(handle));
  } catch {
    /* nothing to forget */
  }
}
