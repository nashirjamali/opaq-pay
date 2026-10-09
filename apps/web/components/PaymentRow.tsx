"use client";

import type { Payment } from "@/lib/sample";
import { Amount } from "./Amount";
import { Avatar } from "./Avatar";
import { StatusChip } from "./StatusChip";

export function PaymentRow({ p }: { p: Payment }) {
  const out = p.status === "out";
  return (
    <div className="row">
      <Avatar label={p.counterparty ?? "In"} out={out} />
      <span className="who">
        {out ? "Cash out" : p.counterparty ? `From ${p.counterparty}` : "Payment received"}
        <small>{out ? `${p.when} to ${p.counterparty}` : p.when}</small>
      </span>
      <span className="c-status"><StatusChip status={p.status} /></span>
      <span className="amt num"><Amount value={p.amount} signed hidden={!p.amountKnown} /></span>
    </div>
  );
}
