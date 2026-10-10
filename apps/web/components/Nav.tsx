"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { GlyphEye, Icon } from "./Icon";
import { IconActivity, IconCashOut, IconOverview, IconReceive, IconReports, IconSettings } from "./icons";

const ITEMS: { href: string; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { href: "/overview", label: "Overview", Icon: IconOverview },
  { href: "/receive", label: "Receive", Icon: IconReceive },
  { href: "/activity", label: "Activity", Icon: IconActivity },
  { href: "/cashout", label: "Cash out", Icon: IconCashOut },
  { href: "/reports", label: "Reports", Icon: IconReports },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          <Icon size={20} />
          <span>{label}</span>
        </Link>
      ))}
      <aside className="nav-note" aria-label="What is public">
        <strong><Icon as={GlyphEye} size={16} /> What is public</strong>
        <p>Anyone can see who paid you and how much. They can&apos;t see which wallet is yours or what your balance is.</p>
      </aside>
    </nav>
  );
}
