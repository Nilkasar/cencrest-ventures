import { UserPlus } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        description="Everyone who's requested a free AI + SEO snapshot, plus anyone founder-led outreach has touched, in one pipeline."
      />
      <ComingSoon
        icon={<UserPlus size={20} />}
        eyebrow="Leads"
        title="No leads yet"
        description="Leads arrive two ways: someone requests a Free Snapshot (website + email + company), or your team adds one directly. Epic 1 builds the pipeline view, scoring, and CRM data model this page will use."
        epic={1}
        action={
          <StubActionButton
            label="Add a lead"
            message="Lead creation is part of Epic 1 (CRM) — Leads, Contacts, Accounts, Deals, Activities."
            variant="primary"
          />
        }
      />
    </>
  );
}
