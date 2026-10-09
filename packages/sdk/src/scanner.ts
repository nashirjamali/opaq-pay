/**
 * Recipient-side scanning: pull `opaq_registry` announcements from chain, keep the ones
 * addressed to this recipient, and look up what is waiting at each one-time address.
 *
 * Everything read from chain is untrusted. A match only means the announcement was derived
 * from our scan key; the amount comes from the stealth token account's actual balance.
 */
import { findAssociatedTokenPda, getTokenDecoder } from '@solana-program/token';
import {
  fetchEncodedAccount,
  fetchEncodedAccounts,
  getBase58Encoder,
  type Address,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type GetSignaturesForAddressApi,
  type GetTransactionApi,
  type Rpc,
  type Signature,
} from '@solana/kit';
import {
  decodeAnnouncementEventCpi,
  findEventAuthorityPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  type OwnPayment,
  type VaultSettings,
} from './builders.js';
import { LOCALNET_PROGRAMS, type OpaqPrograms } from './config.js';
import { scanAnnouncement, type Announcement } from './stealth.js';
import type { MaybeEncodedAccount } from '@solana/kit';

export type ScanRpc = Rpc<GetSignaturesForAddressApi & GetTransactionApi & GetAccountInfoApi & GetMultipleAccountsApi>;

export type ScannedAnnouncement = Announcement & {
  signature: Signature;
  slot: bigint;
  blockTime: number | null;
};

/** The parts of a `getTransaction` (encoding `json`) response this module reads. */
export type TransactionLike = {
  transaction: { message: { accountKeys: readonly string[] } };
  meta: {
    err: unknown;
    loadedAddresses?: { writable: readonly string[]; readonly: readonly string[] };
    innerInstructions?: readonly {
      instructions: readonly { programIdIndex: number; accounts: readonly number[]; data: string }[];
    }[];
  } | null;
};

/**
 * Announcements emitted by `opaq_registry` in one transaction. Only inner instructions that
 * the registry invoked on itself with its event-authority PDA are accepted, so look-alike
 * data from other programs is ignored. Failed transactions yield nothing.
 */
export async function extractAnnouncements(
  transaction: TransactionLike,
  programs: OpaqPrograms = LOCALNET_PROGRAMS,
): Promise<Announcement[]> {
  const meta = transaction.meta;
  if (!meta || meta.err) return [];
  const keys = [
    ...transaction.transaction.message.accountKeys,
    ...(meta.loadedAddresses?.writable ?? []),
    ...(meta.loadedAddresses?.readonly ?? []),
  ];
  const eventAuthority = await findEventAuthorityPda(programs.registry);
  const base58 = getBase58Encoder();

  const found: Announcement[] = [];
  for (const inner of meta.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      if (keys[ix.programIdIndex] !== programs.registry) continue;
      if (ix.accounts.length !== 1 || keys[ix.accounts[0]!] !== eventAuthority) continue;
      let data: Uint8Array;
      try {
        data = new Uint8Array(base58.encode(ix.data));
      } catch {
        continue;
      }
      const decoded = decodeAnnouncementEventCpi(data);
      if (decoded) found.push(decoded);
    }
  }
  return found;
}

export type FetchAnnouncementsOptions = {
  programs?: OpaqPrograms;
  /** Start before this signature (paging backwards through history). */
  before?: Signature;
  /** Stop at this signature, exclusive: the newest one handled by the previous run. */
  until?: Signature;
  /** Signatures to look at, 1-1000. Default 100. */
  limit?: number;
  commitment?: 'confirmed' | 'finalized';
  /** Parallel `getTransaction` calls. Default 8. */
  concurrency?: number;
};

export type FetchAnnouncementsResult = {
  /** Oldest first. */
  items: ScannedAnnouncement[];
  /** Newest signature looked at, failed or not. Use as `until` on the next run. */
  newestSignature: Signature | null;
  /** Oldest signature looked at. Use as `before` to continue into older history. */
  oldestSignature: Signature | null;
  /** Signatures looked at, failed ones included. */
  signaturesExamined: number;
  /** True when `limit` signatures came back, so older ones may remain. */
  mayHaveMore: boolean;
};

/**
 * One page of announcements, found through the registry's event-authority account, which
 * every `announce` transaction touches (so `register_handle` traffic is not scanned).
 */
export async function fetchAnnouncements(
  rpc: ScanRpc,
  options: FetchAnnouncementsOptions = {},
): Promise<FetchAnnouncementsResult> {
  const programs = options.programs ?? LOCALNET_PROGRAMS;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const commitment = options.commitment ?? 'confirmed';
  const concurrency = Math.max(options.concurrency ?? 8, 1);

  const eventAuthority = await findEventAuthorityPda(programs.registry);
  const signatures = await rpc
    .getSignaturesForAddress(eventAuthority, {
      limit,
      commitment,
      ...(options.before ? { before: options.before } : {}),
      ...(options.until ? { until: options.until } : {}),
    })
    .send();

  const succeeded = signatures.filter((entry) => entry.err === null);
  const items: ScannedAnnouncement[] = [];
  for (let i = 0; i < succeeded.length; i += concurrency) {
    const batch = succeeded.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (entry) => {
        const transaction = await rpc
          .getTransaction(entry.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment })
          .send();
        if (!transaction) return [];
        const announcements = await extractAnnouncements(transaction as unknown as TransactionLike, programs);
        return announcements.map(
          (announcement): ScannedAnnouncement => ({
            ...announcement,
            signature: entry.signature,
            slot: entry.slot,
            blockTime: entry.blockTime === null ? null : Number(entry.blockTime),
          }),
        );
      }),
    );
    for (const found of results) items.push(...found);
  }

  return {
    items: items.reverse(), // RPC returns newest first
    newestSignature: signatures[0]?.signature ?? null,
    oldestSignature: signatures[signatures.length - 1]?.signature ?? null,
    signaturesExamined: signatures.length,
    mayHaveMore: signatures.length === limit,
  };
}

/**
 * The stealth address's associated token account for `mint`: whether it exists and its public
 * (non-confidential) amount. Works for Token and Token-2022 accounts; confidential balances
 * need the keys in `@opaq/sdk/confidential`.
 */
export async function getStealthTokenBalance(
  rpc: Rpc<GetAccountInfoApi>,
  stealthAddress: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<{ tokenAccount: Address; exists: boolean; amount: bigint }> {
  const [tokenAccount] = await findAssociatedTokenPda({ owner: stealthAddress, mint, tokenProgram });
  const missing = { tokenAccount, exists: false, amount: 0n };
  const account = await fetchEncodedAccount(rpc, tokenAccount);
  if (!account.exists || account.programAddress !== tokenProgram) return missing;
  try {
    // The base layout is shared by both token programs; Token-2022 extensions follow it.
    const token = getTokenDecoder().decode(account.data);
    // The address is derived from owner + mint, but never trust account contents blindly.
    if (token.owner !== stealthAddress || token.mint !== mint) return missing;
    return { tokenAccount, exists: true, amount: token.amount };
  } catch {
    return missing;
  }
}

export type DetectedPayment = OwnPayment & {
  signature: Signature;
  slot: bigint;
  blockTime: number | null;
  /** Stealth USDC account the payer paid into. */
  tokenAccount: Address;
  /** USDC waiting to be swept right now; 0n once swept. */
  amount: bigint;
  /** The stealth address's own wrapper-token account, where sweeps go by default. */
  wrappedTokenAccount: Address;
  wrappedAccountExists: boolean;
  /** Public wrapper balance; a shielded balance shows up as 0 here (decrypt it with the confidential helpers). */
  wrappedPublicAmount: bigint;
};

/** Keeps the announcements derived from this recipient's scan key, with their tweaks. */
export function matchAnnouncements<T extends Announcement>(
  scanSeed: Uint8Array,
  spendPubkey: Uint8Array,
  announcements: readonly T[],
): (T & { tweak: bigint })[] {
  const matched: (T & { tweak: bigint })[] = [];
  for (const announcement of announcements) {
    // Announcements are untrusted: keep only those derived from our scan key.
    const match = scanAnnouncement(scanSeed, spendPubkey, announcement);
    if (match) matched.push({ ...announcement, tweak: match.tweak });
  }
  return matched;
}

const MAX_ACCOUNTS_PER_CALL = 100; // getMultipleAccounts limit

function decodeOwnedTokenAccount(account: MaybeEncodedAccount, owner: Address, mint: Address, tokenProgram: Address) {
  if (!account.exists || account.programAddress !== tokenProgram) return { exists: false, amount: 0n };
  try {
    const token = getTokenDecoder().decode(account.data);
    if (token.owner !== owner || token.mint !== mint) return { exists: false, amount: 0n };
    return { exists: true, amount: token.amount };
  } catch {
    return { exists: false, amount: 0n };
  }
}

/**
 * Looks up where each matched payment's funds are, two accounts per payment, batched into
 * `getMultipleAccounts` calls of 100.
 */
export async function resolvePayments(
  rpc: Rpc<GetMultipleAccountsApi>,
  matched: readonly (ScannedAnnouncement & { tweak: bigint })[],
  vault: Pick<VaultSettings, 'underlyingMint' | 'underlyingTokenProgram' | 'wrappedMint'>,
  options: { includeSwept?: boolean } = {},
): Promise<DetectedPayment[]> {
  const addresses: Address[] = [];
  for (const payment of matched) {
    const [usdc] = await findAssociatedTokenPda({
      owner: payment.stealthAddress,
      mint: vault.underlyingMint,
      tokenProgram: vault.underlyingTokenProgram,
    });
    const [wrapped] = await findAssociatedTokenPda({
      owner: payment.stealthAddress,
      mint: vault.wrappedMint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    addresses.push(usdc, wrapped);
  }
  const accounts: MaybeEncodedAccount[] = [];
  for (let i = 0; i < addresses.length; i += MAX_ACCOUNTS_PER_CALL) {
    accounts.push(...(await fetchEncodedAccounts(rpc, addresses.slice(i, i + MAX_ACCOUNTS_PER_CALL))));
  }

  const payments: DetectedPayment[] = [];
  matched.forEach((payment, i) => {
    const usdc = decodeOwnedTokenAccount(accounts[2 * i]!, payment.stealthAddress, vault.underlyingMint, vault.underlyingTokenProgram);
    const wrapped = decodeOwnedTokenAccount(accounts[2 * i + 1]!, payment.stealthAddress, vault.wrappedMint, TOKEN_2022_PROGRAM_ADDRESS);
    if (usdc.amount === 0n && !wrapped.exists && !options.includeSwept) return;
    payments.push({
      ...payment,
      tokenAccount: addresses[2 * i]!,
      amount: usdc.amount,
      wrappedTokenAccount: addresses[2 * i + 1]!,
      wrappedAccountExists: wrapped.exists,
      wrappedPublicAmount: wrapped.amount,
    });
  });
  return payments;
}

export type ScanForPaymentsInput = {
  scanSeed: Uint8Array;
  spendPubkey: Uint8Array;
  vault: Pick<VaultSettings, 'underlyingMint' | 'underlyingTokenProgram' | 'wrappedMint'>;
  programs?: OpaqPrograms;
  /** Newest signature handled by the previous run. */
  until?: Signature;
  /** Resume an incomplete run (see `complete`) from this signature. */
  before?: Signature;
  /** Upper bound on signatures examined per call. Default 5000. */
  maxSignatures?: number;
  /**
   * Keep payments with nothing left at the stealth address: no USDC to sweep and no wrapper
   * account (it was closed after cashing out). Default false.
   */
  includeSwept?: boolean;
  commitment?: 'confirmed' | 'finalized';
};

export type ScanForPaymentsResult = {
  /** Oldest first. */
  payments: DetectedPayment[];
  /** Pass as `until` next time, but only once a run came back `complete`. */
  newestSignature: Signature | null;
  /** When `complete` is false: call again with this as `before`, keeping the same `until`. */
  resumeBefore: Signature | null;
  complete: boolean;
};

/**
 * Finds the recipient's payments since `until`. Needs only the scan seed and the public
 * spend key, so a merchant server can run it without spend authority.
 */
export async function scanForPayments(rpc: ScanRpc, input: ScanForPaymentsInput): Promise<ScanForPaymentsResult> {
  const maxSignatures = input.maxSignatures ?? 5000;
  const pageSize = Math.min(maxSignatures, 1000);

  const pages: DetectedPayment[][] = []; // newest page first
  let newestSignature: Signature | null = null;
  let before = input.before;
  let examined = 0;
  let complete = true;
  let resumeBefore: Signature | null = null;

  while (true) {
    const page = await fetchAnnouncements(rpc, {
      ...(input.programs ? { programs: input.programs } : {}),
      ...(before ? { before } : {}),
      ...(input.until ? { until: input.until } : {}),
      limit: Math.min(pageSize, maxSignatures - examined),
      ...(input.commitment ? { commitment: input.commitment } : {}),
    });
    newestSignature ??= page.newestSignature;
    examined += page.signaturesExamined;

    const matched = matchAnnouncements(input.scanSeed, input.spendPubkey, page.items);
    const found = await resolvePayments(rpc, matched, input.vault, { includeSwept: input.includeSwept ?? false });
    pages.push(found);

    if (!page.mayHaveMore || !page.oldestSignature) break;
    before = page.oldestSignature;
    if (examined >= maxSignatures) {
      complete = false;
      resumeBefore = page.oldestSignature;
      break;
    }
  }

  return { payments: pages.reverse().flat(), newestSignature, resumeBefore, complete };
}
