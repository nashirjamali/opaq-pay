import { readFileSync } from 'node:fs';
import { configFromEnv, type OpaqConfig } from '@opaq/sdk';

export type ServerConfig = {
  port: number;
  databaseUrl: string;
  rpcUrl: string;
  wsUrl: string;
  opaq: OpaqConfig;
  indexer: {
    enabled: boolean;
    /** Delay between polls when caught up. */
    pollMs: number;
    /** `finalized` in production so rows never need to be rolled back. */
    commitment: 'confirmed' | 'finalized';
  };
  relayer: {
    enabled: boolean;
    /** 64-byte secret key (Solana CLI JSON array). Holds SOL only, never tokens. */
    secretKey?: Uint8Array;
    /** Most lamports one relayed transaction may cost the relayer (fees + rent it fronts). */
    maxLamportsPerTransaction: bigint;
    /** Net lamports the relayer may spend per rolling 24 hours, all clients together. */
    dailyLamportBudget: bigint;
    /** Relay requests per client (IP) per minute. */
    requestsPerMinute: number;
  };
  /** Trust `x-forwarded-for` (only behind a proxy that sets it). */
  trustProxy: boolean;
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function lamports(name: string, value: string | undefined, fallback: bigint): bigint {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number of lamports`);
  return BigInt(value);
}

function readSecretKey(env: Record<string, string | undefined>): Uint8Array | undefined {
  const raw = env.RELAYER_SECRET_KEY ?? (env.RELAYER_KEYPAIR_PATH ? readFileSync(env.RELAYER_KEYPAIR_PATH, 'utf8') : undefined);
  if (!raw) return undefined;
  const bytes = new Uint8Array(JSON.parse(raw));
  if (bytes.length !== 64) throw new Error('Relayer key must be a 64-byte Solana keypair');
  return bytes;
}

export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const rpcUrl = env.RPC_URL ?? 'https://api.devnet.solana.com';
  const relayerEnabled = bool(env.RELAYER_ENABLED, true);
  const secretKey = readSecretKey(env);
  if (relayerEnabled && !secretKey) throw new Error('Set RELAYER_SECRET_KEY or RELAYER_KEYPAIR_PATH, or RELAYER_ENABLED=false');
  return {
    port: positiveInt('PORT', env.PORT, 8787),
    databaseUrl,
    rpcUrl,
    wsUrl: env.WS_URL ?? rpcUrl.replace(/^http/, 'ws'),
    opaq: configFromEnv(env),
    indexer: {
      enabled: bool(env.INDEXER_ENABLED, true),
      pollMs: positiveInt('INDEXER_POLL_MS', env.INDEXER_POLL_MS, 2000),
      commitment: env.INDEXER_COMMITMENT === 'confirmed' ? 'confirmed' : 'finalized',
    },
    relayer: {
      enabled: relayerEnabled,
      ...(secretKey ? { secretKey } : {}),
      maxLamportsPerTransaction: lamports('RELAYER_MAX_LAMPORTS_PER_TX', env.RELAYER_MAX_LAMPORTS_PER_TX, 20_000_000n),
      dailyLamportBudget: lamports('RELAYER_DAILY_LAMPORT_BUDGET', env.RELAYER_DAILY_LAMPORT_BUDGET, 2_000_000_000n),
      requestsPerMinute: positiveInt('RELAYER_REQUESTS_PER_MINUTE', env.RELAYER_REQUESTS_PER_MINUTE, 60),
    },
    trustProxy: bool(env.TRUST_PROXY, false),
  };
}
