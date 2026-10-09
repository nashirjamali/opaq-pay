"use client";

import { useSession } from "@/lib/session";
import { GlyphInfo, GlyphUserPlus, Icon } from "./Icon";

export function DemoBanner() {
  const { isDemo, openAuth } = useSession();
  if (!isDemo) return null;
  return (
    <div className="banner">
      <p className="banner-text">
        <Icon as={GlyphInfo} size={20} />
        <span><strong>This is a demo with sample data.</strong> Create an account to get your own link and see your own
        payments here.</span>
      </p>
      <button type="button" className="btn btn-primary" onClick={() => openAuth("create")}>
        <Icon as={GlyphUserPlus} />
        Create account
      </button>
    </div>
  );
}
