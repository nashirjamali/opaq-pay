import { CHAINS, type ChainId } from "@opaq/sdk";

/** Display names for the SDK's chain ids. The SDK decides which chains exist and their status; the app decides what it can pay from. */
export const CHAIN_NAMES: Record<ChainId, string> = {
  solana: "Solana",
  arc: "Arc Testnet",
  base: "Base",
  arbitrum: "Arbitrum",
};

/** The only source chain the payer page can pay from today. CCTP payments from the others are in the SDK but not wired into this app yet. */
export const PAYABLE_CHAIN: ChainId = "solana";

/** Chains the SDK knows about that this app cannot pay from yet, for the disabled "More chains" choice. */
export const NEXT_CHAINS = (Object.keys(CHAINS) as ChainId[]).filter((id) => id !== PAYABLE_CHAIN);

export const NEXT_CHAINS_LABEL = NEXT_CHAINS.map((id) => CHAIN_NAMES[id]).join(", ");
