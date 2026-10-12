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
  /**
   * Gives a brand-new wallet (a Google sign-up has no SOL) enough SOL to register its handle, once.
   * Its own key, never the relayer's: the relayer's history must not touch recipient wallets. Test
   * networks only.
   */
  sponsor: {
    enabled: boolean;
    secretKey?: Uint8Array;
    lamportsPerWallet: bigint;
    dailyLamportBudget: bigint;
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

function readSecretKey(env: Record<string, string | undefined>, prefix = 'RELAYER'): Uint8Array | undefined {
  const path = env[`${prefix}_KEYPAIR_PATH`];
  const raw = env[`${prefix}_SECRET_KEY`] ?? (path ? readFileSync(path, 'utf8') : undefined);
  if (!raw) return undefined;
  const bytes = new Uint8Array(JSON.parse(raw));
  if (bytes.length !== 64) throw new Error(`${prefix.toLowerCase()} key must be a 64-byte Solana keypair`);
  return bytes;
}

export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const rpcUrl = env.RPC_URL ?? 'https://api.devnet.solana.com';
  const relayerEnabled = bool(env.RELAYER_ENABLED, true);
  const secretKey = readSecretKey(env);
  if (relayerEnabled && !secretKey) throw new Error('Set RELAYER_SECRET_KEY or RELAYER_KEYPAIR_PATH, or RELAYER_ENABLED=false');
  const opaq = configFromEnv(env);
  const sponsorKey = readSecretKey(env, 'SPONSOR');
  if (sponsorKey && opaq.cluster !== 'devnet' && opaq.cluster !== 'localnet') throw new Error('The wallet sponsor is for test networks only');
  return {
    port: positiveInt('PORT', env.PORT, 8787),
    databaseUrl,
    rpcUrl,
    wsUrl: env.WS_URL ?? rpcUrl.replace(/^http/, 'ws'),
    opaq,
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
    sponsor: {
      enabled: sponsorKey !== undefined,
      ...(sponsorKey ? { secretKey: sponsorKey } : {}),
      lamportsPerWallet: lamports('SPONSOR_LAMPORTS_PER_WALLET', env.SPONSOR_LAMPORTS_PER_WALLET, 5_000_000n),
      dailyLamportBudget: lamports('SPONSOR_DAILY_LAMPORT_BUDGET', env.SPONSOR_DAILY_LAMPORT_BUDGET, 500_000_000n),
      requestsPerMinute: positiveInt('SPONSOR_REQUESTS_PER_MINUTE', env.SPONSOR_REQUESTS_PER_MINUTE, 5),
    },
    trustProxy: bool(env.TRUST_PROXY, false),
  };
}
