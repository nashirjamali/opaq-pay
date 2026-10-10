"use client";

import { useState } from "react";
import { ErrorBanner, LoadingRows } from "@/components/DataStates";
import { CbCircle } from "@/components/CbIcon";
import { PaymentRow } from "@/components/PaymentRow";
import { PageHead } from "@/components/PageHead";
import type { PaymentStatus } from "@/lib/sample";
import { useSession } from "@/lib/session";

const FILTERS: { key: "all" | PaymentStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Not yet private" },
  { key: "private", label: "Private" },
  { key: "out", label: "Cashed out" },
];

export function ActivityView() {
  const { payments, dataState } = useSession();
  const [filter, setFilter] = useState<"all" | PaymentStatus>("all");
  const items = payments.filter((p) => filter === "all" || p.status === filter);

  return (
    <>
      <PageHead title="Activity">Every payment that reached you, and every cash out.</PageHead>
      <ErrorBanner />
      <div className="chips" role="group" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {dataState === "loading" ? (
        <LoadingRows count={4} />
      ) : dataState === "error" ? null : !payments.length ? (
        <div className="empty">
          <CbCircle name="wallet" size={64} />
          <h3>No payments yet</h3>
          <p>Send your payment link to whoever owes you. Their payment shows up here when it lands.</p>
        </div>
      ) : !items.length ? (
        <div className="empty">
          <h3>Nothing matches this filter</h3>
          <p>Try another filter to see the rest of your activity.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setFilter("all")}>Show all</button>
        </div>
      ) : (
        <ul className="list">
          {items.map((p, i) => {
            const group = p.daysAgo === 0 ? "Today" : p.daysAgo === 1 ? "Yesterday" : "Earlier this week";
            const prev = items[i - 1];
            const prevGroup = prev ? (prev.daysAgo === 0 ? "Today" : prev.daysAgo === 1 ? "Yesterday" : "Earlier this week") : null;
            return (
              <li key={p.id}>
                {group !== prevGroup && <h2 className="group-head">{group}</h2>}
                <PaymentRow p={p} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
