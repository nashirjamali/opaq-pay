import { scanForPayments, scanIndexerForPayments, type DetectedPayment, type MetaKeys } from "@opaq/sdk";
import type { Payment } from "../sample";
import { describeWhen } from "../time";
import { getVault, rpc } from "./chain";
import { loadConfidential } from "./confidential";
import { config, indexer } from "./env";

export interface LoadedPayments {
  payments: Payment[];
  /** Decrypted sum of what sits in the private balance. */
  balance: number;
  /** Payments whose funds are not yet private: USDC at the stealth address, or swept but not shielded. */
  movable: DetectedPayment[];
  /** USDC held by `movable` payments, in whole units. */
  movableTotal: number;
  /** The part of `movableTotal` still at the stealth address, which the protocol fee applies to. */
  unsweptTotal: number;
  /** Protocol fee in basis points, taken when USDC moves into the vault. */
  feeBps: number;
}

/**
 * Finds this recipient's payments and works out where each one stands. Matching happens here
 * with the scan key; the chain (or the indexer) only ever sees public data. Shielded amounts
 * are decrypted locally with keys derived from the scan seed.
 */
export async function loadPayments(keys: MetaKeys): Promise<LoadedPayments> {
  const vault = await getVault();
  const base = { scanSeed: keys.scanSeed, spendPubkey: keys.spendPubkey, vault, includeSwept: true };
  const detected: DetectedPayment[] = indexer
    ? (await scanIndexerForPayments(rpc, indexer, base)).payments
    : (await scanForPayments(rpc, { ...base, programs: config.programs })).payments;

  const unit = 10 ** vault.decimals;
  const payments: Payment[] = [];
  const movable: DetectedPayment[] = [];
  let balance = 0;
  let movableTotal = 0;
  let unsweptTotal = 0;
  // Only loaded when some payment has a wrapper account to read.
  const confidential = detected.some((p) => p.amount === 0n && p.wrappedAccountExists) ? await loadConfidential() : null;

  for (const p of detected) {
    const row = { id: p.signature, ...describeWhen(p.blockTime), counterparty: null };

    if (p.amount > 0n) {
      const amount = Number(p.amount) / unit;
      movable.push(p);
      movableTotal += amount;
      unsweptTotal += amount;
      payments.push({ ...row, amount, amountKnown: true, status: "waiting" });
      continue;
    }
    if (!p.wrappedAccountExists || !confidential) {
      // Nothing left at the stealth address: it was cashed out and closed.
      payments.push({ ...row, amount: 0, amountKnown: false, status: "out" });
      continue;
    }

    try {
      const bal = await confidential.fetchStealthWrappedBalance(rpc, {
        scanSeed: keys.scanSeed,
        stealthAddress: p.stealthAddress,
        vault,
      });
      const amount = Number(bal.total) / unit;
      if (bal.total === 0n) {
        payments.push({ ...row, amount: 0, amountKnown: false, status: "out" });
      } else if (bal.confidential && bal.publicAmount === 0n) {
        balance += amount;
        payments.push({ ...row, amount, amountKnown: true, status: "private" });
      } else {
        // Swept into the vault but still a public balance: it needs shielding.
        movable.push(p);
        movableTotal += amount;
        payments.push({ ...row, amount, amountKnown: true, status: "waiting" });
      }
    } catch {
      // A balance that cannot be decrypted is shown hidden rather than guessed.
      payments.push({ ...row, amount: 0, amountKnown: false, status: "private" });
    }
  }

  return { payments: payments.reverse(), balance, movable, movableTotal, unsweptTotal, feeBps: vault.feeBps }; // the SDK returns oldest first
}
