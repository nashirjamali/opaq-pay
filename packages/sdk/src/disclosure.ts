/**
 * Selective disclosure for accountants and auditors: hand over the payments of a time range
 * with each stealth account's own confidential keys, instead of the scan seed (which would
 * reveal every payment, past and future). Part of `@opaq/sdk/confidential`.
 *
 * A disclosure proves what it lists: the auditor checks each entry against chain data. It
 * cannot prove completeness; a recipient could leave payments out.
 */
import {
  getBase58Encoder,
  getBase58Decoder,
  type Address,
  type GetAccountInfoApi,
  type GetTransactionApi,
  type Rpc,
  type Signature,
} from '@solana/kit';
import type { VaultSettings } from './builders.js';
import { LOCALNET_PROGRAMS, type OpaqPrograms } from './config.js';
import {
  confidentialKeysFromSeeds,
  deriveStealthConfidentialKeySeeds,
  fetchStealthWrappedBalanceWithKeys,
} from './confidential.js';
import { extractAnnouncements, type TransactionLike } from './scanner.js';

export const DISCLOSURE_VERSION = 'opaq-disclosure-v1';

export type Disclosure = {
  version: typeof DISCLOSURE_VERSION;
  createdAt: string;
  /** Inclusive start, exclusive end (ISO 8601), by block time. */
  from: string;
  to: string;
  note?: string;
  payments: {
    signature: string;
    blockTime: number;
    stealthAddress: string;
    /** HKDF outputs from docs/stealth-ct-keys.md for this account only (base58). */
    elgamalSeed: string;
    aeSeed: string;
  }[];
};

export function createDisclosure(input: {
  scanSeed: Uint8Array;
  payments: readonly { signature: Signature; blockTime: number | null; stealthAddress: Address }[];
  from: Date;
  to: Date;
  note?: string;
}): Disclosure {
  if (!(input.from < input.to)) throw new Error('`from` must be before `to`');
  const start = Math.floor(input.from.getTime() / 1000);
  const end = Math.floor(input.to.getTime() / 1000);
  const base58 = getBase58Decoder();
  return {
    version: DISCLOSURE_VERSION,
    createdAt: new Date().toISOString(),
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    ...(input.note ? { note: input.note } : {}),
    payments: input.payments
      .filter((payment) => payment.blockTime !== null && payment.blockTime >= start && payment.blockTime < end)
      .map((payment) => {
        const seeds = deriveStealthConfidentialKeySeeds(input.scanSeed, payment.stealthAddress);
        return {
          signature: payment.signature,
          blockTime: payment.blockTime!,
          stealthAddress: payment.stealthAddress,
          elgamalSeed: base58.decode(seeds.elgamalSeed),
          aeSeed: base58.decode(seeds.aeSeed),
        };
      }),
  };
}

export type VerifiedDisclosureRow = {
  signature: string;
  blockTime: number;
  stealthAddress: string;
  /** False when the transaction does not announce this stealth address or failed. */
  valid: boolean;
  /** Underlying tokens the payer sent to the stealth address in that transaction (public). */
  paid: bigint;
  /** Where the funds are now, decrypted with the disclosed keys. */
  current: { exists: boolean; publicAmount: bigint; shielded: bigint };
};

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

/** Checks every entry against chain data and decrypts current balances with the disclosed keys. */
export async function verifyDisclosure(
  rpc: Rpc<GetTransactionApi & GetAccountInfoApi>,
  disclosure: Disclosure,
  options: { vault: Pick<VaultSettings, 'underlyingMint' | 'wrappedMint'>; programs?: OpaqPrograms },
): Promise<{ rows: VerifiedDisclosureRow[]; totalPaid: bigint }> {
  if (disclosure.version !== DISCLOSURE_VERSION) throw new Error(`Unsupported disclosure ${disclosure.version}`);
  const programs = options.programs ?? LOCALNET_PROGRAMS;
  const base58 = getBase58Encoder();
  const rows: VerifiedDisclosureRow[] = [];
  for (const entry of disclosure.payments) {
    const transaction = await rpc
      .getTransaction(entry.signature as Signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
      .send();
    const announced =
      transaction !== null &&
      (await extractAnnouncements(transaction as unknown as TransactionLike, programs)).some(
        (announcement) => announcement.stealthAddress === entry.stealthAddress,
      );

    let paid = 0n;
    if (transaction?.meta && announced) {
      const balances = (list: readonly TokenBalance[] | null | undefined) =>
        (list ?? [])
          .filter((b) => b.owner === entry.stealthAddress && b.mint === options.vault.underlyingMint)
          .reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
      const meta = transaction.meta as unknown as { preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] };
      paid = balances(meta.postTokenBalances) - balances(meta.preTokenBalances);
    }

    // Keys that do not decrypt the account make the entry invalid rather than failing the report.
    let current = { exists: false, publicAmount: 0n, shielded: 0n };
    let keysWork = true;
    try {
      const keys = confidentialKeysFromSeeds({
        elgamalSeed: new Uint8Array(base58.encode(entry.elgamalSeed)),
        aeSeed: new Uint8Array(base58.encode(entry.aeSeed)),
      });
      const balance = await fetchStealthWrappedBalanceWithKeys(rpc, {
        stealthAddress: entry.stealthAddress as Address,
        vault: options.vault,
        keys: () => keys,
      });
      current = { exists: balance.exists, publicAmount: balance.publicAmount, shielded: balance.available + balance.pending };
    } catch {
      keysWork = false;
    }
    rows.push({
      signature: entry.signature,
      blockTime: entry.blockTime,
      stealthAddress: entry.stealthAddress,
      valid: announced && keysWork,
      paid,
      current,
    });
  }
  return { rows, totalPaid: rows.filter((row) => row.valid).reduce((sum, row) => sum + row.paid, 0n) };
}
