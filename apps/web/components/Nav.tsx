"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CbIcon, type CbIconName } from "./CbIcon";
import { Logo } from "./Logo";

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
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/overview" className="nav-brand" aria-label="Opaq, go to overview">
        <Logo full />
      </Link>
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
    </nav>
  );
}
