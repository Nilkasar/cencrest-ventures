import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { LeadsView } from "@/components/crm/leads-view";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        description="Everyone who's requested a free AI + SEO snapshot, plus anyone founder-led outreach has touched, in one pipeline."
      />
      <LeadsView />
    </>
  );
}
