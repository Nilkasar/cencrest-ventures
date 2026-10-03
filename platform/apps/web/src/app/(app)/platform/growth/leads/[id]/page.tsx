import type { Metadata } from "next";
import { LeadDetailView } from "@/components/crm/lead-detail-view";

export const metadata: Metadata = { title: "Lead · Growth" };

export default async function GrowthLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailView leadId={id} />;
}
