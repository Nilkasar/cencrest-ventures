import type { Metadata } from "next";
import { AgencyClientsView } from "@/components/platform/agencies-view";

export const metadata: Metadata = { title: "Agency clients · Platform" };

export default async function PlatformAgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgencyClientsView agencyId={id} />;
}
