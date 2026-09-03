import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { AgencyClientsView } from "@/components/agency/agency-clients-view";

export const metadata: Metadata = { title: "Agency" };

export default function AgencyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Agency"
        title="Client organizations"
        description="Manage which client organizations you have access to, and which agencies have access to you — every link is an explicit, audited grant, never a bare claim on an org id."
      />
      <AgencyClientsView />
    </>
  );
}
