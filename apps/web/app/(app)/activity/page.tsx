import type { Metadata } from "next";
import { ActivityView } from "./view";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <ActivityView />;
}
