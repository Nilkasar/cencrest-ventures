import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Reports"
        description="Can I show this to my team or board? Weekly digests, monthly performance reports, custom reports, and the quarterly baseline comparison."
      />
      <ComingSoon
        icon={<BarChart3 size={20} />}
        eyebrow="Reports"
        title="Nothing to report yet"
        description="Reports summarize measured change, so the first one appears after your baseline plus one full measurement cycle. A free snapshot report can be generated earlier from a website URL alone."
        epic={15}
        action={
          <StubActionButton
            label="Generate a free snapshot"
            message="The public Free Snapshot flow ships with Epic 17, feeding leads straight into the Epic 1 CRM."
            variant="primary"
          />
        }
      />
    </>
  );
}
