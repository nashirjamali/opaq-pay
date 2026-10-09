import { configFromEnv, createIndexerClient, createRelayerClient, type OpaqConfig } from "@opaq/sdk";

// Next only inlines NEXT_PUBLIC_* values it can see statically, so each one is read by name.
export const config: OpaqConfig = configFromEnv({
  OPAQ_CLUSTER: process.env.NEXT_PUBLIC_OPAQ_CLUSTER,
  OPAQ_REGISTRY_PROGRAM_ID: process.env.NEXT_PUBLIC_OPAQ_REGISTRY_PROGRAM_ID,
  OPAQ_VAULT_PROGRAM_ID: process.env.NEXT_PUBLIC_OPAQ_VAULT_PROGRAM_ID,
  OPAQ_ENABLED_CHAINS: process.env.NEXT_PUBLIC_OPAQ_ENABLED_CHAINS,
});

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://api.devnet.solana.com";

/** Optional Opaq server (indexer + relayer). Without it the app scans over RPC. */
export const SERVER_URL = process.env.NEXT_PUBLIC_OPAQ_SERVER_URL?.trim() || null;

/** Wallet Standard chain id for the configured cluster. */
export const WALLET_CHAIN = config.cluster === "devnet" ? "solana:devnet" : "solana:localnet";

export const indexer = SERVER_URL ? createIndexerClient({ url: SERVER_URL }) : null;
export const relayer = SERVER_URL ? createRelayerClient({ url: SERVER_URL }) : null;
