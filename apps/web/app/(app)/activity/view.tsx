"use client";

import { useState } from "react";
import { MarkArt } from "@/components/MarkArt";
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
  const { payments } = useSession();
  const [filter, setFilter] = useState<"all" | PaymentStatus>("all");
  const items = payments.filter((p) => filter === "all" || p.status === filter);

  return (
    <>
      <PageHead title="Activity">Every payment that reached you, and every cash out.</PageHead>
      <div className="chips" role="group" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {!payments.length ? (
        <div className="list empty">
          <MarkArt className="empty-art" />
          <h3>No payments yet</h3>
          <p>Send your payment link to whoever owes you. Their payment shows up here when it lands.</p>
        </div>
      ) : !items.length ? (
        <div className="list empty">
          <h3>Nothing matches this filter</h3>
          <p>Try another filter to see the rest of your activity.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setFilter("all")}>Show all</button>
        </div>
      ) : (
        <ul className="list">
          {items.map((p) => (
            <li key={p.id}>
              <PaymentRow p={p} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
