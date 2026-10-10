"use client";

import type { Wallet } from "@wallet-standard/base";
import { useEffect, useState } from "react";
import { listSolanaWallets, onWalletsChange } from "./standard";

/** Installed Solana wallets, kept current as extensions register. Empty on the server and first render. */
export function useWallets(): Wallet[] {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  useEffect(() => {
    const update = () => setWallets(listSolanaWallets());
    update();
    return onWalletsChange(update);
  }, []);
  return wallets;
}
