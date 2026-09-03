import type { Metadata } from "next";
import { SnapshotReportPageView } from "@/components/snapshot/snapshot-report-page-view";

export const metadata: Metadata = { title: "Your Snapshot" };

/**
 * Epic 17 — `GET /snapshot/:token`'s public report page
 * (`docs/epics/17-free-snapshot.md`'s "UI surface": "renders the score +
 * gaps + recommendations"). Server-component wrapper that awaits the async
 * `params` (this Next.js version's contract) and hands the plain token
 * string to the client component that actually polls — same
 * server-page/client-view split `crm/leads/[id]/page.tsx` uses.
 */
export default async function SnapshotReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SnapshotReportPageView token={token} />;
}
