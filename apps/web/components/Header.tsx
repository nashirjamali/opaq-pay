"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const { isDemo, handle, openAuth } = useSession();
  return (
    <header className="top">
      <Link href="/overview" aria-label="Opaq, go to overview">
        <Logo />
      </Link>
      <span className="grow" />
      <ThemeToggle />
      {isDemo ? (
        <button type="button" className="btn btn-primary hide-sm" onClick={() => openAuth("create")}>
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
