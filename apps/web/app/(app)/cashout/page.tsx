import type { Metadata } from "next";
import { CashOutView } from "./view";

export const metadata: Metadata = { title: "Cash out" };

export default function CashOutPage() {
  return <CashOutView />;
}
