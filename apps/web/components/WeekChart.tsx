"use client";

import { formatUsdc } from "@/lib/format";
import type { Payment } from "@/lib/sample";
import { useSession } from "@/lib/session";
import { Amount } from "./Amount";

const DAYS = [6, 5, 4, 3, 2, 1, 0];

/** Answers one question: how much came in each day this week. Today's bar is lime, the rest Primary. */
export function WeekChart({ payments }: { payments: Payment[] }) {
  const { revealed } = useSession();
  const perDay = DAYS.map((d) =>
    payments.filter((p) => p.daysAgo === d && p.amount > 0).reduce((a, p) => a + p.amount, 0),
  );
  const total = perDay.reduce((a, n) => a + n, 0);
  const max = Math.max(...perDay, 1);
  const summary = revealed
    ? `Received per day over the last 7 days: ${perDay.map((n, i) => `${DAYS[i] === 0 ? "today" : `${DAYS[i]} days ago`} ${formatUsdc(n)}`).join(", ")}.`
    : "Amounts hidden.";

  return (
    <figure className="card chart">
      <figcaption>
        <h2>Received in the last 7 days</h2>
        <p className="chart-total num"><Amount value={total} /> <span className="muted">USDC</span></p>
      </figcaption>
      <div className="bars" role="img" aria-label={summary}>
        {perDay.map((n, i) => (
          <div className="bar-col" key={DAYS[i]}>
            <div
              className={`${n > 0 || !revealed ? "bar" : "bar bar-empty"}${DAYS[i] === 0 && n > 0 && revealed ? " bar-today" : ""}`}
              style={{ height: revealed ? `${Math.max(n / max, n > 0 ? 0.08 : 0) * 92}%` : "45%", opacity: revealed ? 1 : 0.35 }}
            />
          </div>
        ))}
      </div>
      <div className="bar-labels" aria-hidden="true">
        {perDay.map((_, i) => (
          <span className="bar-label" key={DAYS[i]}>{DAYS[i] === 0 ? "Today" : `${DAYS[i]}d`}</span>
        ))}
      </div>
      {total === 0 && revealed && <p className="muted">Nothing came in this week.</p>}
    </figure>
  );
}
