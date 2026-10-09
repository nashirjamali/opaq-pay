/**
 * HTTP API.
 *
 *   GET  /health                 liveness + indexer cursor
 *   GET  /v1/announcements       ?after=<cursor>&limit=<1..1000>, every announcement (clients match locally)
 *   GET  /v1/relayer             { address } to use as fee payer
 *   POST /v1/relay               { transaction: base64 } → { signature }
 *
 * Full announcement pages never change, so they are served as immutable for CDN caching.
 */
import type { AnnouncementJson } from '@opaq/sdk';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Db } from './db.js';
import type { Indexer } from './indexer.js';
import { RelayError, type Relayer } from './relayer.js';

export type AppDeps = {
  db: Db;
  indexer?: Indexer;
  relayer?: Relayer;
  trustProxy: boolean;
};

const MAX_PAGE = 1000;

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use('*', cors());

  app.get('/health', async (c) => {
    await deps.db.query('select 1');
    return c.json({ ok: true, indexer: deps.indexer ? await deps.indexer.status() : null, relayer: deps.relayer?.address ?? null });
  });

  app.get('/v1/announcements', async (c) => {
    const afterParam = c.req.query('after') ?? '0';
    const limitParam = c.req.query('limit') ?? String(MAX_PAGE);
    if (!/^\d{1,19}$/.test(afterParam) || !/^\d{1,4}$/.test(limitParam)) return c.json({ error: 'bad query' }, 400);
    const limit = Math.min(Math.max(Number(limitParam), 1), MAX_PAGE);
    const { rows } = await deps.db.query<{
      id: string;
      signature: string;
      slot: string;
      block_time: string | null;
      ephemeral_pubkey: Buffer;
      stealth_address: string;
      view_tag: number;
    }>(
      `select id::text, signature, slot::text, block_time::text, ephemeral_pubkey, stealth_address, view_tag
       from announcements where id > $1 order by id limit $2`,
      [afterParam, limit + 1],
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items: AnnouncementJson[] = page.map((row) => ({
      signature: row.signature,
      slot: row.slot,
      blockTime: row.block_time === null ? null : Number(row.block_time),
      ephemeralPubkey: row.ephemeral_pubkey.toString('base64'),
      stealthAddress: row.stealth_address,
      viewTag: row.view_tag,
    }));
    c.header('cache-control', hasMore ? 'public, max-age=31536000, immutable' : 'public, max-age=2');
    return c.json({ items, next: page.at(-1)?.id ?? (afterParam === '0' ? null : afterParam), hasMore });
  });

  app.get('/v1/relayer', (c) => {
    if (!deps.relayer) return c.json({ error: 'relayer disabled' }, 404);
    return c.json({ address: deps.relayer.address });
  });

  app.post('/v1/relay', bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    if (!deps.relayer) return c.json({ error: 'relayer disabled' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.transaction !== 'string') return c.json({ error: 'expected { transaction: base64 }' }, 400);
    const forwarded = deps.trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
    const client = forwarded || (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress || 'unknown';
    try {
      return c.json({ signature: await deps.relayer.relay(body.transaction, client) });
    } catch (error) {
      if (error instanceof RelayError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}
