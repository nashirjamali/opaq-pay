"use client";

import { formatUsdc } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";
import { useSession } from "@/lib/session";

/** The big balance. Cents are set smaller so the whole-dollar figure leads. */
export function BalanceFigure({ value }: { value: number }) {
  const { revealed } = useSession();
  const shown = useCountUp(value);
  if (!revealed) return <span className="mask mask-xl" role="img" aria-label="Balance hidden" />;
  const text = formatUsdc(shown);
  const dot = text.lastIndexOf(".");
  return (
    <span aria-label={`${formatUsdc(value)} USDC`}>
      <span aria-hidden="true">
        {text.slice(0, dot)}
        <span className="cents">{text.slice(dot)}</span>
      </span>
    </span>
  );
}
