import type { Metadata } from "next";
import { ReportDetailView } from "@/components/reports/report-detail-view";

export const metadata: Metadata = { title: "Report" };

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportDetailView reportId={id} />;
}
