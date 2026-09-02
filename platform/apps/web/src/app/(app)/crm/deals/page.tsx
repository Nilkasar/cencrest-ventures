import { Handshake } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";

export const metadata: Metadata = { title: "Deals" };

export default function DealsPage() {
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Deals"
        description="Diagnostic, Full Rebuild, and Continuous engagements moving through the pipeline, from qualified lead to signed contract."
      />
      <ComingSoon
        icon={<Handshake size={20} />}
        eyebrow="Deals"
        title="No deals yet"
        description="Deals track an engagement (Diagnostic, Full Rebuild, or Continuous) against an account, through stage, value, and close date. Epic 1 builds the pipeline board this page becomes."
        epic={1}
        action={
          <StubActionButton
            label="Add a deal"
            message="Deals ship with Epic 1 (CRM)."
            variant="primary"
          />
        }
      />
    </>
  );
}
