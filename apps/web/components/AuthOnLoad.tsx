"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/session";

/** The home page's "Create account" links to /overview?signin=1: open the account dialog once, then clean the URL. */
export function AuthOnLoad() {
  const { openAuth, isDemo } = useSession();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("signin") !== "1") return;
    url.searchParams.delete("signin");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (isDemo) openAuth("create");
    // Run once on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
