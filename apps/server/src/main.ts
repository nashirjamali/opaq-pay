/**
 * Entry point: migrate, start the indexer loop and the HTTP API.
 *   pnpm --filter @opaq/sdk build && pnpm --filter @opaq/server start
 * Configuration: see `src/config.ts` and `.env.example` at the repo root.
 */
import { serve } from '@hono/node-server';
import { createKeyPairSignerFromBytes, createSolanaRpc } from '@solana/kit';
import { createApp } from './app.js';
import { loadServerConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { createIndexer } from './indexer.js';
import { createRelayer } from './relayer.js';

const log = (message: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...extra }));

const config = loadServerConfig();
const db = createDb(config.databaseUrl);
await migrate(db);
const rpc = createSolanaRpc(config.rpcUrl);

const indexer = createIndexer({ rpc, db, programs: config.opaq.programs, commitment: config.indexer.commitment, log });
const relayer =
  config.relayer.enabled && config.relayer.secretKey
    ? createRelayer({
        rpc,
        db,
        signer: await createKeyPairSignerFromBytes(config.relayer.secretKey),
        programs: config.opaq.programs,
        maxLamportsPerTransaction: config.relayer.maxLamportsPerTransaction,
        dailyLamportBudget: config.relayer.dailyLamportBudget,
        requestsPerMinute: config.relayer.requestsPerMinute,
        log,
      })
    : undefined;

const controller = new AbortController();
const indexing = config.indexer.enabled ? indexer.run(config.indexer.pollMs, controller.signal) : Promise.resolve();
const server = serve({ fetch: createApp({ db, indexer, ...(relayer ? { relayer } : {}), trustProxy: config.trustProxy }).fetch, port: config.port });
log('listening', { port: config.port, cluster: config.opaq.cluster, relayer: relayer?.address ?? null, indexer: config.indexer.enabled });

async function shutdown() {
  log('shutting down');
  controller.abort();
  server.close();
  await indexing;
  await db.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
