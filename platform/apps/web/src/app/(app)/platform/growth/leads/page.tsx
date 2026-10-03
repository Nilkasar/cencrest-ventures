import type { Metadata } from "next";
import { LeadsView } from "@/components/crm/leads-view";

export const metadata: Metadata = { title: "Leads · Growth" };

export default function GrowthLeadsPage() {
  return <LeadsView />;
}
