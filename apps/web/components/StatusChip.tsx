import type { PaymentStatus } from "@/lib/sample";
import { GlyphLock, GlyphOut, GlyphPending, Icon } from "./Icon";

const LABEL = {
  waiting: { text: "Not yet private", cls: "st", glyph: GlyphPending },
  private: { text: "Private", cls: "st st-private", glyph: GlyphLock },
  out: { text: "Cashed out", cls: "st st-out", glyph: GlyphOut },
} satisfies Record<PaymentStatus, { text: string; cls: string; glyph: typeof GlyphLock }>;

export function StatusChip({ status }: { status: PaymentStatus }) {
  const s = LABEL[status];
  return (
    <span className={s.cls}>
      <Icon as={s.glyph} size={13} />
      {s.text}
    </span>
  );
}
