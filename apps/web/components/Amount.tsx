"use client";

import { formatUsdc } from "@/lib/format";
import { useSession } from "@/lib/session";

export function Amount({ value, signed = false }: { value: number; signed?: boolean }) {
  const { revealed } = useSession();
  if (!revealed) return <span className="mask" role="img" aria-label="Amount hidden" />;
  return <>{(signed && value > 0 ? "+" : "") + formatUsdc(value)}</>;
}
