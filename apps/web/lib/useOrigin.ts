"use client";

import { useEffect, useState } from "react";

/** The page origin, empty until mounted so server and client render the same markup. */
export function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** `localhost:3000/pay/raka` style text for showing a link without its protocol. */
export function payLink(origin: string, handle: string): { href: string; label: string } {
  const href = `${origin}/pay/${handle}`;
  return { href, label: href.replace(/^https?:\/\//, "") };
}
