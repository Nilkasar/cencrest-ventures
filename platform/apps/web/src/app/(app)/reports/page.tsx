import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Board-ready snapshots of score change, new opportunities and competitor movement — each frozen at the moment it was generated."
      />
      <ReportsView />
    </>
  );
}
