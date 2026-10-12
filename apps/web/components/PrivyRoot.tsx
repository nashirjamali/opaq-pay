"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useEffect, useMemo, type ReactNode } from "react";
import { RPC_URL } from "@/lib/opaq/env";
import { PRIVY_APP_ID, setPrivyState } from "@/lib/privy/store";
import { createPrivyWallet } from "@/lib/privy/wallet";

// Privy needs an RPC for the chain it signs on. It only signs here (the app sends), and it knows no
// local chain, so the local network is signed as "solana:devnet" against the same RPC.
const SOLANA_RPCS = {
  "solana:devnet": {
    rpc: createSolanaRpc(RPC_URL),
    rpcSubscriptions: createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws")),
  },
};

/** Wraps the app in Privy when an app id is configured; otherwise renders the children unchanged. */
export function PrivyRoot({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["google"],
        // The embedded wallet is the account: its signature derives the private payment keys.
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
        solana: { rpcs: SOLANA_RPCS },
        appearance: { walletChainType: "solana-only", theme: "light" },
      }}
    >
      <Bridge />
      {children}
    </PrivyProvider>
  );
}

/** Copies Privy's session into the store the sign-in dialog reads, since hooks only work in here. */
function Bridge() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const embedded = authenticated ? wallets[0] : undefined;

  const wallet = useMemo(
    () =>
      embedded
        ? createPrivyWallet({
            address: embedded.address,
            signMessage: async (message) =>
              (await signMessage({ message, wallet: embedded, options: { uiOptions: { showWalletUIs: false } } })).signature,
            signTransaction: async (transaction, chain) =>
              (await signTransaction({
                transaction,
                wallet: embedded,
                chain: privyChain(chain),
                // The person already confirmed in our own dialog, which would cover Privy's.
                options: { uiOptions: { showWalletUIs: false } },
              })).signedTransaction,
          })
        : null,
    [embedded, signMessage, signTransaction],
  );

  const label = user?.google?.email ?? user?.email?.address ?? null;
  useEffect(() => {
    setPrivyState({ ready, wallet, label, login: () => login({ loginMethods: ["google"] }), logout });
  }, [ready, wallet, label, login, logout]);
  return null;
}

function privyChain(chain: string): "solana:mainnet" | "solana:devnet" | "solana:testnet" {
  return chain === "solana:mainnet" || chain === "solana:testnet" ? chain : "solana:devnet";
}
