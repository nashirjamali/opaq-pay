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
  getBase58Encoder,
  type Address,
  type GetAccountInfoApi,
  type GetSignaturesForAddressApi,
  type GetTransactionApi,
  type Rpc,
  type Signature,
} from '@solana/kit';
import {
  decodeAnnouncementEventCpi,
  findEventAuthorityPda,
  type OwnPayment,
  type VaultSettings,
} from './builders.js';
import { LOCALNET_PROGRAMS, type OpaqPrograms } from './config.js';
import { scanAnnouncement, type Announcement } from './stealth.js';

export type ScanRpc = Rpc<GetSignaturesForAddressApi & GetTransactionApi & GetAccountInfoApi>;

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

/** Balance of the stealth address's token account for `mint`; 0n when it does not exist. */
export async function getStealthTokenBalance(
  rpc: Rpc<GetAccountInfoApi>,
  stealthAddress: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<{ tokenAccount: Address; amount: bigint }> {
  const [tokenAccount] = await findAssociatedTokenPda({ owner: stealthAddress, mint, tokenProgram });
  const account = await fetchEncodedAccount(rpc, tokenAccount);
  if (!account.exists || account.programAddress !== tokenProgram) return { tokenAccount, amount: 0n };
  try {
    const token = getTokenDecoder().decode(account.data);
    // The address is derived from owner + mint, but never trust account contents blindly.
    if (token.owner !== stealthAddress || token.mint !== mint) return { tokenAccount, amount: 0n };
    return { tokenAccount, amount: token.amount };
  } catch {
    return { tokenAccount, amount: 0n };
  }
}

export type DetectedPayment = OwnPayment & {
  signature: Signature;
  slot: bigint;
  blockTime: number | null;
  /** Stealth token account that holds (or held) the funds. */
  tokenAccount: Address;
  /** Balance waiting to be swept right now; 0n once swept. */
  amount: bigint;
};

export type ScanForPaymentsInput = {
  scanSeed: Uint8Array;
  spendPubkey: Uint8Array;
  vault: Pick<VaultSettings, 'underlyingMint' | 'underlyingTokenProgram'>;
  programs?: OpaqPrograms;
  /** Newest signature handled by the previous run. */
  until?: Signature;
  /** Resume an incomplete run (see `complete`) from this signature. */
  before?: Signature;
  /** Upper bound on signatures examined per call. Default 5000. */
  maxSignatures?: number;
  /** Keep payments whose token account is already empty. Default false. */
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

    const found: DetectedPayment[] = [];
    for (const item of page.items) {
      // Announcements are untrusted: keep only those derived from our scan key.
      const match = scanAnnouncement(input.scanSeed, input.spendPubkey, item);
      if (!match) continue;
      const { tokenAccount, amount } = await getStealthTokenBalance(
        rpc,
        item.stealthAddress,
        input.vault.underlyingMint,
        input.vault.underlyingTokenProgram,
      );
      if (amount === 0n && !input.includeSwept) continue;
      found.push({ ...item, tweak: match.tweak, tokenAccount, amount });
    }
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
