"use client";

import { useSession } from "@/lib/session";
import { CbIcon } from "./CbIcon";

export function DemoBanner() {
  const { isDemo, openAuth } = useSession();
  if (!isDemo) return null;
  return (
    <div className="banner">
      <p className="banner-text">
        <CbIcon name="info" size={20} />
        <span><strong>This is a demo with sample data.</strong> Create an account to get your own link and see your own
        payments here.</span>
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => openAuth("create")}>
        Create account
      </button>
    </div>
  );
}
