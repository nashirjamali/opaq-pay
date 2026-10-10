import type { Metadata } from "next";
import { PayView } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  return { title: `Pay @${handle}` };
}

export default async function PayPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <PayView handle={handle.toLowerCase()} />;
}
