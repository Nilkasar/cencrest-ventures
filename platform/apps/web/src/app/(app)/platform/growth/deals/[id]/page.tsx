import type { Metadata } from "next";
import { DealDetailView } from "@/components/crm/deal-detail-view";

export const metadata: Metadata = { title: "Deal · Growth" };

export default async function GrowthDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealDetailView dealId={id} />;
}
