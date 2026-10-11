import type { CctpSourceChain } from "@opaq/sdk";
import { defineChain, type Chain } from "viem";

/** The viem chain for a CCTP source chain: what a wallet is asked to switch to, or to add. */
export function evmChain(source: CctpSourceChain): Chain {
  return defineChain({
    id: source.evmChainId,
    name: source.name,
    nativeCurrency: source.nativeCurrency,
    rpcUrls: { default: { http: [source.rpcUrl] } },
    blockExplorers: { default: { name: `${source.name} explorer`, url: source.explorerUrl } },
  });
}
