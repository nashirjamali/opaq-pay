"use client";

import { useEffect, useState } from "react";

/** The part of an EIP-1193 provider this app uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface EvmWallet {
  id: string;
  name: string;
  /** Data URI from the wallet's own announcement, or null for the legacy fallback. */
  icon: string | null;
  provider: Eip1193Provider;
}

interface AnnounceDetail {
  info?: { uuid?: unknown; name?: unknown; icon?: unknown };
  provider?: Eip1193Provider;
}

/**
 * EVM wallets in this browser, found with EIP-6963 (each wallet announces itself, so several can
 * coexist). A lone legacy `window.ethereum` is offered when nothing announces.
 */
export function useEvmWallets(): EvmWallet[] {
  const [wallets, setWallets] = useState<EvmWallet[]>([]);

  useEffect(() => {
    const found = new Map<string, EvmWallet>();
    const publish = () => setWallets([...found.values()]);

    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as CustomEvent<AnnounceDetail>).detail ?? {};
      if (!provider || typeof info?.uuid !== "string" || typeof info.name !== "string") return;
      // The icon is wallet-supplied: only an inline image is ever put into an <img>.
      const icon = typeof info.icon === "string" && info.icon.startsWith("data:image/") ? info.icon : null;
      found.set(info.uuid, { id: info.uuid, name: info.name, icon, provider });
      publish();
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const legacy = setTimeout(() => {
      const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
      if (found.size === 0 && injected) {
        found.set("injected", { id: "injected", name: "Browser wallet", icon: null, provider: injected });
        publish();
      }
    }, 300);

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(legacy);
    };
  }, []);

  return wallets;
}
