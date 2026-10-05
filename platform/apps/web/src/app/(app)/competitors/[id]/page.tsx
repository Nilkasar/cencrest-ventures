import type { Metadata } from "next";
import { CompetitorDetailView } from "@/components/competitors/competitor-detail-view";

export const metadata: Metadata = { title: "Competitor" };

export default async function CompetitorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompetitorDetailView competitorId={id} />;
}
