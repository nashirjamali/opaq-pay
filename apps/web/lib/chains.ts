import { CHAINS, getCctpSourceChain, type CctpSourceChain, type ChainId } from "@opaq/sdk";
import { config, relayer } from "./opaq/env";

/** Display names for the SDK's chain ids. The SDK decides which chains exist and their status; the app decides what it can pay from. */
export const CHAIN_NAMES: Record<ChainId, string> = {
  solana: "Solana",
  arc: "Arc Testnet",
  base: "Base",
  arbitrum: "Arbitrum",
};

function evmSource(id: ChainId): CctpSourceChain | null {
  try {
    return getCctpSourceChain(config, id);
  } catch {
    return null; // Solana itself, a chain that is not switched on, or a cluster without CCTP
  }
}

/**
 * Other chains the payer page can pay from: switched on for this deployment
 * (`NEXT_PUBLIC_OPAQ_ENABLED_CHAINS`) and wired for CCTP. They need the relayer, which does the
 * Solana side for a payer who has no Solana wallet.
 */
export const EVM_SOURCES: CctpSourceChain[] = relayer
  ? config.enabledChains.flatMap((id) => {
      const source = evmSource(id);
      return source ? [source] : [];
    })
  : [];

/** Chains the SDK knows about that this deployment cannot pay from yet, for the disabled "More chains" choice. */
export const NEXT_CHAINS = (Object.keys(CHAINS) as ChainId[]).filter(
  (id) => id !== "solana" && !EVM_SOURCES.some((source) => source.chain === id),
);

export const NEXT_CHAINS_LABEL = NEXT_CHAINS.map((id) => CHAIN_NAMES[id]).join(", ");
