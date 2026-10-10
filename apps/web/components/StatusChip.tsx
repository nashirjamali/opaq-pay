import type { PaymentStatus } from "@/lib/sample";

const LABEL = {
  waiting: { text: "Not yet private", cls: "st st-wait" },
  private: { text: "Private", cls: "st st-private" },
  out: { text: "Cashed out", cls: "st st-out" },
} satisfies Record<PaymentStatus, { text: string; cls: string }>;

export function StatusChip({ status }: { status: PaymentStatus }) {
  const s = LABEL[status];
  return <span className={s.cls}>{s.text}</span>;
}
