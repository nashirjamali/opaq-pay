import { CbIcon } from "./CbIcon";

/** Direction tile: a lime arrow-down for money received, a black arrow-up for money sent out. Payers are anonymous addresses, so there is no photo. */
export function Avatar({ out = false }: { label?: string; out?: boolean }) {
  return (
    <span className={out ? "tile tile-out" : "tile tile-in"} aria-hidden="true">
      <CbIcon name={out ? "arrow-up" : "arrow-down"} size={20} />
    </span>
  );
}
