"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { config } from "@/lib/opaq/env";
import { useNavDrawer } from "@/lib/navDrawer";
import { useSession } from "@/lib/session";
import { Logo } from "./Logo";
import { SolanaMark } from "./TokenMarks";

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
  const { open, setOpen } = useNavDrawer();
  return (
    <header className="top">
      <button type="button" className="menu-btn" aria-label="Open menu" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M2.5 5H17.5M2.5 10H17.5M2.5 15H17.5" /></svg>
      </button>
      <Link href="/overview" className="top-logo" aria-label="Opaq, go to overview">
        <Logo />
      </Link>
      <span className="top-title" aria-hidden="true">{title}</span>
      <span className="grow" />
      <span className="net mono" title="Network this app is connected to">
        <SolanaMark size={16} />
        Solana {config.cluster === "devnet" ? "Devnet" : "Local"}
      </span>
      {address && <span className="addr mono" title={address}>{address.slice(0, 4)}…{address.slice(-4)}</span>}
      {isDemo ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openAuth("create")}>
          Create account
        </button>
      ) : (
        <Link className="acct" href="/settings">
          <span className="tile tile-sm" aria-hidden="true">{handle.slice(0, 1).toUpperCase()}</span>
          @{handle}
        </Link>
      )}
    </header>
  );
}
