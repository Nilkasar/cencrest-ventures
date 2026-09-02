import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { DealsBoardView } from "@/components/crm/deals-board-view";

export const metadata: Metadata = { title: "Deals" };

export default function DealsPage() {
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Deals"
        description="Diagnostic, Full Rebuild, and Continuous engagements moving through the pipeline, from qualified lead to signed contract."
      />
      <DealsBoardView />
    </>
  );
}
