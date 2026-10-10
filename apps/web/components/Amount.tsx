"use client";

import { formatUsdc } from "@/lib/format";
import { useSession } from "@/lib/session";

export function Amount({ value, signed = false, hidden = false }: { value: number; signed?: boolean; hidden?: boolean }) {
  const { revealed } = useSession();
  if (!revealed || hidden) return <span className="mask" role="img" aria-label="Amount hidden" />;
  return <>{(signed && value > 0 ? "+" : "") + formatUsdc(value)}</>;
}
