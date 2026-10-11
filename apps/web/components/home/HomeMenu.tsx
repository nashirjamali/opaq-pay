"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#public", label: "What is public" },
  { href: "#next", label: "What is next" },
  { href: "#platforms", label: "Platforms" },
];

/** Section links for tablet and phone, where the inline links do not fit. Hidden on wide screens by CSS. */
export function HomeMenu() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="hp-menu">
      <button ref={btn} type="button" className="hp-menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="hp-menu-panel" onClick={() => setOpen((o) => !o)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
          {open ? <path d="M3 3L17 17M17 3L3 17" /> : <path d="M2.5 5H17.5M2.5 10H17.5M2.5 15H17.5" />}
        </svg>
      </button>
      <nav id="hp-menu-panel" className="hp-menu-panel" aria-label="Sections" hidden={!open}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
        ))}
        <Link href="/overview" className="btn hp-btn-plain hp-menu-demo" onClick={() => setOpen(false)}>Try the demo</Link>
      </nav>
    </div>
  );
}
