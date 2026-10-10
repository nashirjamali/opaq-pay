"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { config } from "@/lib/opaq/env";
import { useSession } from "@/lib/session";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const TITLES: Record<string, string> = {
  "/overview": "Overview",
  "/receive": "Receive",
  "/activity": "Activity",
  "/cashout": "Cash out",
  "/reports": "Reports",
  "/settings": "Settings",
};

export function Header() {
  const title = TITLES[usePathname()] ?? "Opaq";
  const { isDemo, handle, address, openAuth } = useSession();
  return (
    <header className="top">
      <Link href="/overview" className="top-logo" aria-label="Opaq, go to overview">
        <Logo />
      </Link>
      <span className="top-title" aria-hidden="true">{title}</span>
      <span className="grow" />
      <span className="net mono" title="Network this app is connected to">
        <SolanaMark />
        Solana {config.cluster === "devnet" ? "Devnet" : "Local"}
      </span>
      {address && <span className="addr mono" title={address}>{address.slice(0, 4)}…{address.slice(-4)}</span>}
      <ThemeToggle />
      {isDemo ? (
        <button type="button" className="btn btn-primary btn-sm hide-sm" onClick={() => openAuth("create")}>
          Create account
        </button>
      ) : (
        <Link className="acct hide-sm" href="/settings">
          <span className="tile tile-sm" aria-hidden="true">{handle.slice(0, 1).toUpperCase()}</span>
          @{handle}
        </Link>
      )}
    </header>
  );
}

/** Solana's three-bar mark, drawn flat so it takes the surrounding text color. */
function SolanaMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" className="ic">
      <path fill="currentColor" d="M3 2.2h9.2l-1.4 2H1.6zM3 6h9.2l-1.4 2H1.6zM10.8 9.8H1.6l1.4 2h9.2z" />
    </svg>
  );
}
