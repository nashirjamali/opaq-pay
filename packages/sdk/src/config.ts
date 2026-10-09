/**
 * Deployment configuration: which program IDs to talk to and which chains are switched on.
 *
 * The Codama clients default to the program IDs of the local build (`LOCALNET_PROGRAMS`), so
 * existing tests keep working. Anything that targets devnet or a custom deployment passes an
 * `OpaqConfig.programs` object through the builders instead.
 */
import { address, type Address } from '@solana/kit';
import { OPAQ_REGISTRY_PROGRAM_ADDRESS } from './generated/registry/index.js';
import { OPAQ_VAULT_PROGRAM_ADDRESS } from './generated/vault/index.js';

export type OpaqPrograms = {
  registry: Address;
  vault: Address;
};

/** IDs compiled into the generated clients (the local `anchor build` keypairs). */
export const LOCALNET_PROGRAMS: OpaqPrograms = {
  registry: OPAQ_REGISTRY_PROGRAM_ADDRESS,
  vault: OPAQ_VAULT_PROGRAM_ADDRESS,
};

export const DEVNET_PROGRAMS: OpaqPrograms = {
  registry: address('6xaXX6KSFxkNohbanstr2Sqpk3teRUExuLQ1u1ndcEyE'),
  vault: address('JHC14FJWJWAkLNj4aDe1EPr65ideg4tSoZmrdXuZtPA'),
};

export type OpaqCluster = 'localnet' | 'devnet';

/**
 * Chains a payment can originate from. `available` chains work today; `planned` ones are
 * known names that are rejected until their integration (Circle CCTP) lands, so a typo and
 * an unfinished chain both fail loudly instead of half working.
 */
export const CHAINS = {
  solana: { status: 'available' },
  base: { status: 'planned' },
  arbitrum: { status: 'planned' },
} as const;

export type ChainId = keyof typeof CHAINS;

export const DEFAULT_ENABLED_CHAINS: readonly ChainId[] = ['solana'];

export class OpaqConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpaqConfigError';
  }
}

export type OpaqConfig = {
  cluster: OpaqCluster;
  programs: OpaqPrograms;
  enabledChains: readonly ChainId[];
};

function isChainId(value: string): value is ChainId {
  return Object.hasOwn(CHAINS, value);
}

/** Parses a comma-separated chain list such as `solana,base`. Empty or missing → Solana only. */
export function parseEnabledChains(value: string | undefined): ChainId[] {
  const names = (value ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return [...DEFAULT_ENABLED_CHAINS];

  const chains: ChainId[] = [];
  for (const name of names) {
    if (!isChainId(name)) {
      throw new OpaqConfigError(`Unknown chain "${name}". Known chains: ${Object.keys(CHAINS).join(', ')}`);
    }
    if (CHAINS[name].status !== 'available') {
      throw new OpaqConfigError(`Chain "${name}" is not available yet`);
    }
    if (!chains.includes(name)) chains.push(name);
  }
  if (!chains.includes('solana')) {
    throw new OpaqConfigError('"solana" must stay enabled: payments always settle on Solana');
  }
  return chains;
}

function parseProgramId(name: string, value: string): Address {
  try {
    return address(value);
  } catch {
    throw new OpaqConfigError(`${name} is not a valid Solana address`);
  }
}

export type OpaqConfigInput = {
  cluster?: OpaqCluster;
  /** Overrides individual program IDs of the chosen cluster. */
  programs?: Partial<OpaqPrograms>;
  enabledChains?: readonly ChainId[];
};

export function createConfig(input: OpaqConfigInput = {}): OpaqConfig {
  const cluster = input.cluster ?? 'devnet';
  const base = cluster === 'devnet' ? DEVNET_PROGRAMS : LOCALNET_PROGRAMS;
  return {
    cluster,
    programs: { ...base, ...input.programs },
    enabledChains: input.enabledChains ?? DEFAULT_ENABLED_CHAINS,
  };
}

/**
 * Reads the configuration from an env-like record, so it works on the server
 * (`process.env`) and in Next.js (pass the `NEXT_PUBLIC_*` values you inlined).
 *
 * - `OPAQ_CLUSTER`: `devnet` (default) or `localnet`
 * - `OPAQ_REGISTRY_PROGRAM_ID`, `OPAQ_VAULT_PROGRAM_ID`: optional overrides
 * - `OPAQ_ENABLED_CHAINS`: comma-separated source chains, default `solana`
 */
export function configFromEnv(env: Record<string, string | undefined>): OpaqConfig {
  const cluster = (env.OPAQ_CLUSTER?.trim() || 'devnet').toLowerCase();
  if (cluster !== 'devnet' && cluster !== 'localnet') {
    throw new OpaqConfigError(`OPAQ_CLUSTER must be "devnet" or "localnet", got "${cluster}"`);
  }
  const registry = env.OPAQ_REGISTRY_PROGRAM_ID?.trim();
  const vault = env.OPAQ_VAULT_PROGRAM_ID?.trim();
  return createConfig({
    cluster,
    programs: {
      ...(registry ? { registry: parseProgramId('OPAQ_REGISTRY_PROGRAM_ID', registry) } : {}),
      ...(vault ? { vault: parseProgramId('OPAQ_VAULT_PROGRAM_ID', vault) } : {}),
    },
    enabledChains: parseEnabledChains(env.OPAQ_ENABLED_CHAINS),
  });
}

export function isChainEnabled(config: OpaqConfig, chain: ChainId): boolean {
  return config.enabledChains.includes(chain);
}

export function assertChainEnabled(config: OpaqConfig, chain: ChainId): void {
  if (!isChainEnabled(config, chain)) throw new OpaqConfigError(`Chain "${chain}" is not enabled`);
}
