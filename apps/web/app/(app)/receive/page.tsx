import type { Metadata } from "next";
import { ReceiveView } from "./view";

export const metadata: Metadata = { title: "Receive" };

export default function ReceivePage() {
  return <ReceiveView />;
}
