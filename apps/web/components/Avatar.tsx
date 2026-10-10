import { IconCashOut } from "./icons";

/** Initial-based tile. Payers are anonymous addresses, so there is no photo to show. */
export function Avatar({ label, out = false }: { label: string; out?: boolean }) {
  if (out) {
    return (
      <span className="tile tile-out" aria-hidden="true">
        <IconCashOut size={20} />
      </span>
    );
  }
  return (
    <span className="tile" aria-hidden="true">
      {label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2)}
    </span>
  );
}
