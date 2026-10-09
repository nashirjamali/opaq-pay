/**
 * Client for an Opaq indexer (`apps/server`): announcements in the order the indexer learned
 * them, so a recipient catches up with one cursor instead of one `getTransaction` per payment.
 *
 * The indexer returns every announcement and the client matches locally, so the server never
 * learns which payments are whose. It can still withhold announcements; cross-check with
 * `scanForPayments` over RPC now and then if that matters.
 */
import { isAddress, type Address, type GetMultipleAccountsApi, type Rpc, type Signature } from '@solana/kit';
import type { VaultSettings } from './builders.js';
import { matchAnnouncements, resolvePayments, type DetectedPayment, type ScannedAnnouncement } from './scanner.js';

export type AnnouncementFeedPage = {
  /** In indexer order (oldest learned first). */
  items: ScannedAnnouncement[];
  /** Pass as `after` to continue; null when the feed is empty. */
  next: string | null;
  hasMore: boolean;
};

export type IndexerClient = {
  fetchAnnouncements(options?: { after?: string | null; limit?: number }): Promise<AnnouncementFeedPage>;
};

/** Wire format of one announcement, as served by `GET /v1/announcements`. */
export type AnnouncementJson = {
  signature: string;
  slot: string;
  blockTime: number | null;
  ephemeralPubkey: string; // base64, 32 bytes
  stealthAddress: string;
  viewTag: number;
};

function parseItem(item: AnnouncementJson): ScannedAnnouncement | null {
  if (typeof item !== 'object' || item === null) return null;
  if (typeof item.signature !== 'string' || item.signature.length < 64 || item.signature.length > 88) return null;
  if (typeof item.stealthAddress !== 'string' || !isAddress(item.stealthAddress)) return null;
  if (!Number.isInteger(item.viewTag) || item.viewTag < 0 || item.viewTag > 255) return null;
  if (typeof item.slot !== 'string' || !/^\d+$/.test(item.slot)) return null;
  if (item.blockTime !== null && !Number.isInteger(item.blockTime)) return null;
  const ephemeralPubkey = Uint8Array.from(atob(String(item.ephemeralPubkey)), (c) => c.charCodeAt(0));
  if (ephemeralPubkey.length !== 32) return null;
  return {
    signature: item.signature as Signature,
    slot: BigInt(item.slot),
    blockTime: item.blockTime,
    ephemeralPubkey,
    stealthAddress: item.stealthAddress as Address,
    viewTag: item.viewTag,
  };
}

export function createIndexerClient(options: { url: string; fetch?: typeof fetch }): IndexerClient {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    async fetchAnnouncements({ after = null, limit = 1000 } = {}) {
      const query = new URLSearchParams({ limit: String(limit) });
      if (after) query.set('after', after);
      const response = await doFetch(`${base}/v1/announcements?${query}`);
      if (!response.ok) throw new Error(`Indexer error ${response.status}`);
      const body = (await response.json()) as { items?: unknown; next?: unknown; hasMore?: unknown };
      if (!Array.isArray(body.items)) throw new Error('Malformed indexer response');
      // Server data is untrusted: drop anything malformed rather than failing the whole page.
      const items = body.items.map((item) => parseItem(item as AnnouncementJson)).filter((item) => item !== null);
      return {
        items,
        next: typeof body.next === 'string' ? body.next : null,
        hasMore: body.hasMore === true,
      };
    },
  };
}

export type ScanIndexerInput = {
  scanSeed: Uint8Array;
  spendPubkey: Uint8Array;
  vault: Pick<VaultSettings, 'underlyingMint' | 'underlyingTokenProgram' | 'wrappedMint'>;
  /** Cursor returned by the previous run. */
  after?: string | null;
  /** Stop after this many announcements; call again with the returned cursor. Default 50 000. */
  maxAnnouncements?: number;
  pageSize?: number;
  includeSwept?: boolean;
};

/**
 * Finds the recipient's payments from an indexer feed. Matching is local (scan key never
 * leaves); balances come from the recipient's own RPC in batches.
 */
export async function scanIndexerForPayments(
  rpc: Rpc<GetMultipleAccountsApi>,
  indexer: IndexerClient,
  input: ScanIndexerInput,
): Promise<{ payments: DetectedPayment[]; cursor: string | null; complete: boolean }> {
  const max = input.maxAnnouncements ?? 50_000;
  let cursor = input.after ?? null;
  let seen = 0;
  const payments: DetectedPayment[] = [];
  while (true) {
    const page = await indexer.fetchAnnouncements({ after: cursor, limit: Math.min(input.pageSize ?? 1000, max - seen) });
    seen += page.items.length;
    const matched = matchAnnouncements(input.scanSeed, input.spendPubkey, page.items);
    payments.push(...(await resolvePayments(rpc, matched, input.vault, { includeSwept: input.includeSwept ?? false })));
    if (page.next) cursor = page.next;
    if (!page.hasMore || page.items.length === 0) return { payments, cursor, complete: true };
    if (seen >= max) return { payments, cursor, complete: false };
  }
}
