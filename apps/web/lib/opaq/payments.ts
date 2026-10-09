import { scanForPayments, scanIndexerForPayments, type DetectedPayment, type MetaKeys } from "@opaq/sdk";
import type { Payment } from "../sample";
import { describeWhen } from "../time";
import { getVault, rpc } from "./chain";
import { config, indexer } from "./env";

export interface LoadedPayments {
  payments: Payment[];
  /** Sum of amounts that are in the private balance and publicly readable. Shielded amounts need decrypting (not built yet). */
  balance: number;
}

/**
 * Finds this recipient's payments. Matching happens here with the scan key; the chain (or the
 * indexer) only ever sees public data. Uses the indexer when configured, otherwise RPC.
 */
export async function loadPayments(keys: MetaKeys): Promise<LoadedPayments> {
  const vault = await getVault();
  const base = { scanSeed: keys.scanSeed, spendPubkey: keys.spendPubkey, vault, includeSwept: true };
  const detected: DetectedPayment[] = indexer
    ? (await scanIndexerForPayments(rpc, indexer, base)).payments
    : (await scanForPayments(rpc, { ...base, programs: config.programs })).payments;

  const unit = 10 ** vault.decimals;
  const payments: Payment[] = detected
    .map((p): Payment => {
      const waiting = p.amount > 0n;
      const known = waiting || p.wrappedPublicAmount > 0n;
      return {
        id: p.signature,
        ...describeWhen(p.blockTime),
        counterparty: null,
        amount: Number(waiting ? p.amount : p.wrappedPublicAmount) / unit,
        amountKnown: known,
        status: waiting ? "waiting" : "private",
      };
    })
    .reverse(); // the SDK returns oldest first

  const balance = payments.filter((p) => p.status === "private" && p.amountKnown).reduce((sum, p) => sum + p.amount, 0);
  return { payments, balance };
}
