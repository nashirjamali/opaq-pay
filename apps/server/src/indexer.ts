/**
 * Copies `opaq_registry` announcements into Postgres so clients can catch up with one cursor
 * (`GET /v1/announcements`) instead of fetching every transaction themselves.
 *
 * Polls `getSignaturesForAddress` on the registry's event-authority PDA (touched by every
 * `announce`, nothing else), walks new signatures oldest first, and stores each batch together
 * with the cursor in one database transaction, so a crash never skips or duplicates work.
 * Ingestion is idempotent (`unique (signature, ix_index)`), so a webhook source can be added
 * next to polling later.
 */
import {
  extractAnnouncements,
  findEventAuthorityPda,
  type OpaqPrograms,
  type TransactionLike,
} from '@opaq/sdk';
import type { GetSignaturesForAddressApi, GetTransactionApi, Rpc, Signature } from '@solana/kit';
import type { Db } from './db.js';

const CURSOR = 'announcements';
const PAGE = 1000;

export type IndexerRpc = Rpc<GetSignaturesForAddressApi & GetTransactionApi>;

export type IndexerOptions = {
  rpc: IndexerRpc;
  db: Db;
  programs: OpaqPrograms;
  commitment: 'confirmed' | 'finalized';
  /** Parallel `getTransaction` calls per batch. */
  concurrency?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

type Entry = { signature: Signature; slot: bigint; blockTime: bigint | null; failed: boolean };

export function createIndexer(options: IndexerOptions) {
  const concurrency = options.concurrency ?? 8;
  const log = options.log ?? (() => {});

  async function cursor(): Promise<Signature | undefined> {
    const { rows } = await options.db.query<{ signature: string }>('select signature from indexer_cursors where name = $1', [CURSOR]);
    return rows[0]?.signature as Signature | undefined;
  }

  /** Every signature newer than the cursor, oldest first. */
  async function newSignatures(until: Signature | undefined): Promise<Entry[]> {
    const eventAuthority = await findEventAuthorityPda(options.programs.registry);
    const entries: Entry[] = [];
    let before: Signature | undefined;
    while (true) {
      const page = await options.rpc
        .getSignaturesForAddress(eventAuthority, {
          limit: PAGE,
          commitment: options.commitment,
          ...(until ? { until } : {}),
          ...(before ? { before } : {}),
        })
        .send();
      for (const item of page) {
        entries.push({
          signature: item.signature,
          slot: item.slot,
          blockTime: item.blockTime === null ? null : BigInt(item.blockTime),
          failed: item.err !== null,
        });
      }
      if (page.length < PAGE) break;
      before = page[page.length - 1]!.signature;
    }
    return entries.reverse();
  }

  async function fetchAnnouncements(entry: Entry) {
    if (entry.failed) return [];
    const transaction = await options.rpc
      .getTransaction(entry.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: options.commitment })
      .send();
    if (!transaction) throw new Error(`transaction ${entry.signature} not yet available`);
    return extractAnnouncements(transaction as unknown as TransactionLike, options.programs);
  }

  /** One pass: ingest everything new. Returns the number of announcements stored. */
  async function syncOnce(): Promise<number> {
    const entries = await newSignatures(await cursor());
    let stored = 0;
    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(fetchAnnouncements));
      const client = await options.db.connect();
      try {
        await client.query('begin');
        for (const [j, entry] of batch.entries()) {
          for (const [ixIndex, announcement] of results[j]!.entries()) {
            const inserted = await client.query(
              `insert into announcements (signature, ix_index, slot, block_time, ephemeral_pubkey, stealth_address, view_tag)
               values ($1, $2, $3, $4, $5, $6, $7) on conflict (signature, ix_index) do nothing`,
              [
                entry.signature,
                ixIndex,
                entry.slot.toString(),
                entry.blockTime?.toString() ?? null,
                Buffer.from(announcement.ephemeralPubkey),
                announcement.stealthAddress,
                announcement.viewTag,
              ],
            );
            stored += inserted.rowCount ?? 0;
          }
        }
        const last = batch[batch.length - 1]!;
        await client.query(
          `insert into indexer_cursors (name, signature, slot) values ($1, $2, $3)
           on conflict (name) do update set signature = excluded.signature, slot = excluded.slot, updated_at = now()`,
          [CURSOR, last.signature, last.slot.toString()],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
    if (stored) log('indexed announcements', { stored, signatures: entries.length });
    return stored;
  }

  /** Polls until `signal` aborts; backs off on errors (RPC hiccups, rate limits). */
  async function run(pollMs: number, signal: AbortSignal): Promise<void> {
    let delay = pollMs;
    while (!signal.aborted) {
      try {
        await syncOnce();
        delay = pollMs;
      } catch (error) {
        delay = Math.min(delay * 2, 60_000);
        log('indexer error', { error: String(error), retryInMs: delay });
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), { once: true });
      });
    }
  }

  async function status() {
    const { rows } = await options.db.query<{ slot: string; updated_at: Date }>(
      'select slot, updated_at from indexer_cursors where name = $1',
      [CURSOR],
    );
    return rows[0] ? { slot: rows[0].slot, updatedAt: rows[0].updated_at.toISOString() } : null;
  }

  return { syncOnce, run, status };
}

export type Indexer = ReturnType<typeof createIndexer>;
