import type { PaymentStatus } from "@/lib/sample";

const LABEL: Record<PaymentStatus, { text: string; cls: string }> = {
  waiting: { text: "Not yet private", cls: "st" },
  private: { text: "Private", cls: "st st-private" },
  out: { text: "Cashed out", cls: "st st-out" },
};

export function StatusChip({ status }: { status: PaymentStatus }) {
  const s = LABEL[status];
  return <span className={s.cls}>{s.text}</span>;
}
