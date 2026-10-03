import type { Metadata } from "next";
import { OrgDetailView } from "@/components/platform/org-detail-view";

export const metadata: Metadata = { title: "Organization · Platform" };

export default async function PlatformOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrgDetailView orgId={id} />;
}
