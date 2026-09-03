"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton, SkeletonText } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { getReport } from "@/data/reporting/client";
import { REPORT_TYPE_BADGE_VARIANT, REPORT_TYPE_LABEL } from "@/data/reporting/labels";
import type { Report } from "@/data/reporting/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { CompetitorMovementList } from "./competitor-movement-list";
import { ReportOpportunitiesList } from "./report-opportunities-list";
import { ScoreDeltasList } from "./score-deltas-list";
import { ScoreDeltaSummary } from "./score-delta-summary";
import { ScoreSnapshotPanel } from "./score-snapshot-panel";

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <SkeletonText lines={4} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 min-w-[140px]">
      <p className="font-mono text-[24px] font-semibold text-foreground leading-none">{value}</p>
      <p className="text-[11.5px] text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

/**
 * `docs/09-ux/CUSTOMER_JOURNEY.md`'s Reports screen, detail half: "Can I
 * show this to my team/board?" Renders the ONE immutable `content`
 * snapshot `GET /reports/:id` returns — never a live re-query, this
 * epic's non-negotiable, verified server-side by `lib/reporting/
 * immutability.test.ts`. `Print` uses the browser's own print dialog
 * (`window.print()`, with the sidebar/topbar hidden via `data-print-hide`
 * — see `globals.css`) rather than a fabricated download link, since PDF
 * export is a documented backend gap (`pdfUrl` is always `null` today).
 */
export function ReportDetailView({ reportId }: { reportId: string }) {
  const { reload, ...state } = useAsyncData(() => getReport(reportId), [reportId]);

  return (
    <div className="flex flex-col gap-5">
      <div data-print-hide className="flex items-center justify-between gap-3">
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground w-fit">
          <ArrowLeft size={14} /> Reports
        </Link>
        {state.status === "success" && (
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer size={14} /> Print / Save as PDF
          </Button>
        )}
      </div>

      {state.status === "loading" && <DetailSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "success" && <ReportDetailContent report={state.data} />}
    </div>
  );
}

function ReportDetailContent({ report }: { report: Report }) {
  const { content } = report;

  return (
    <>
      <div className="flex flex-col gap-2 pb-5 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={REPORT_TYPE_BADGE_VARIANT[report.type]} size="sm">
            {REPORT_TYPE_LABEL[report.type]}
          </Badge>
          <p className="text-[12px] text-subtle-foreground">
            {formatDate(content.periodStart)} – {formatDate(content.periodEnd)}
          </p>
        </div>
        <h1 className="font-display text-[24px] font-semibold text-foreground tracking-[-0.015em]">{report.name}</h1>
        <p className="text-[12.5px] text-muted-foreground">
          Generated {formatDateTime(report.generatedAt)} — this snapshot is frozen and will not change even if the underlying data does.
        </p>
      </div>

      {content.reportType === "baseline_comparison" ? (
        <div className="flex flex-col gap-5">
          <ScoreDeltaSummary scoreDelta={content.scoreDelta} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ScoreSnapshotPanel label="Baseline" snapshot={content.baseline} />
            <ScoreSnapshotPanel label="Current" snapshot={content.current} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Competitor movement</CardTitle>
            </CardHeader>
            <CardContent>
              <CompetitorMovementList movements={content.competitorMovements} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New opportunities</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportOpportunitiesList opportunities={content.newOpportunities} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-3">
            <StatTile label="Actions measured" value={content.summary.measurementCount} />
            <StatTile label="New opportunities" value={content.summary.newOpportunityCount} />
            <StatTile label="Competitors moved" value={content.summary.competitorsMoved} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Score deltas</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreDeltasList measurements={content.scoreDeltas} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Competitor movement</CardTitle>
            </CardHeader>
            <CardContent>
              <CompetitorMovementList movements={content.competitorMovements} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New opportunities</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportOpportunitiesList opportunities={content.newOpportunities} />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
