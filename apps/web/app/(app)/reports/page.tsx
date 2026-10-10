import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHead title="Reports">Give an accountant or auditor read-only access, or export your payments.</PageHead>
      <ComingSoon badge="trading" title="Read-only access and CSV export" points={[
        { icon: "company", text: "Share a date range with your accountant. They can read it and cannot spend." },
        { icon: "pie-chart", text: "Export what you received and cashed out as a CSV file." },
      ]}>
        Neither is available yet.
      </ComingSoon>
    </>
  );
}
