"use client";

import { useSession } from "@/lib/session";

export function DemoBanner() {
  const { isDemo, openAuth } = useSession();
  if (!isDemo) return null;
  return (
    <div className="banner">
      <p>
        <strong>This is a demo with sample data.</strong> Create an account to get your own link and see your own
        payments here.
      </p>
      <button type="button" className="btn btn-primary" onClick={() => openAuth("create")}>
        Create account
      </button>
    </div>
  );
}
