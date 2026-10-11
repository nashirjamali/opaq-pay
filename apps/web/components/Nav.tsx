"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CbIcon, type CbIconName } from "./CbIcon";
import { useNavDrawer } from "@/lib/navDrawer";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const ITEMS: { href: string; label: string; icon: CbIconName }[] = [
  { href: "/overview", label: "Overview", icon: "dashboard" },
  { href: "/receive", label: "Receive", icon: "arrow-down" },
  { href: "/activity", label: "Activity", icon: "portfolio" },
  { href: "/cashout", label: "Cash out", icon: "withdraw" },
  { href: "/reports", label: "Reports", icon: "pie-chart" },
];
const SETTINGS = { href: "/settings", label: "Settings", icon: "settings" as CbIconName };

export function Nav() {
  const path = usePathname();
  const { open, setOpen } = useNavDrawer();
  const closeRef = useRef<HTMLButtonElement>(null);
  // On phones the menu is a dialog-like drawer: move focus into it when it opens (the close button is hidden on desktop, so this is a no-op there).
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  return (
    <>
    <div className="nav-scrim" data-open={open} onClick={() => setOpen(false)} aria-hidden="true" />
    <nav className="nav" id="main-nav" aria-label="Main" data-open={open}>
      <div className="nav-head">
        <Link href="/overview" className="nav-brand" aria-label="Opaq, go to overview">
          <Logo full />
        </Link>
        <button type="button" className="nav-close" ref={closeRef} aria-label="Close menu" onClick={() => setOpen(false)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M3 3L17 17M17 3L3 17" /></svg>
        </button>
      </div>
      {ITEMS.map(({ href, label, icon }) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          <CbIcon name={icon} />
          <span>{label}</span>
        </Link>
      ))}
      <aside className="nav-note" aria-label="What is public">
        <strong><CbIcon name="eye" size={16} /> What is public</strong>
        <p>Anyone can see who paid you and how much. They can&apos;t see which wallet is yours or what your balance is.</p>
      </aside>
      <Link className="nav-end" href={SETTINGS.href} aria-current={path === SETTINGS.href ? "page" : undefined}>
        <CbIcon name={SETTINGS.icon} />
        <span>{SETTINGS.label}</span>
      </Link>
      <ThemeToggle variant="nav" />
    </nav>
    </>
  );
}
