"use client";

import { useRouter } from "next/navigation";
import { FileBarChart2, FileQuestion, GitCompareArrows, Gauge, Printer, Target, TrendingUp } from "lucide-react";
import { Badge, Button, EmptyState } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DetailHeader } from "@/components/patterns/page-header";
import { PageStack } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { DetailSkeleton } from "@/components/patterns/states";
import { useAsyncData } from "@/lib/use-async-data";
import { ReportNotFoundError, getReport } from "@/data/reporting/client";
import { REPORT_TYPE_LABEL } from "@/data/reporting/labels";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { CompetitorMovementList } from "./competitor-movement-list";
import { ReportOpportunitiesList } from "./report-opportunities-list";
import { ScoreDeltasList } from "./score-deltas-list";
import { ScoreDeltaSummary } from "./score-delta-summary";
import { ScoreComparison } from "./score-snapshot-panel";

/** Keeps a block whole on paper. */
const PRINT_BLOCK = "print:break-inside-avoid";

/**
 * The Reports screen's detail half — "Can I show this to my team/board?"
 * Renders the ONE immutable `content` snapshot `GET /reports/:id` returns,
 * never a live re-query. Laid out as a document (880px reading measure),
 * printable via the browser's own dialog — the app chrome and the header
 * actions carry `data-print-hide` (see `globals.css`); PDF export is a
 * documented backend gap (`pdfUrl` is always `null`).
 */
export function ReportDetailView({ reportId }: { reportId: string }) {
  const router = useRouter();
  const { reload, ...state } = useAsyncData(() => getReport(reportId), [reportId]);

  if (state.status === "loading") return <DetailSkeleton withLeading={false} label="Loading report…" />;

  if (state.status === "error") {
    if (state.error instanceof ReportNotFoundError) {
      return (
        <EmptyState
          icon={<FileQuestion size={20} />}
          title="Report not found"
          description="This report may have been removed, or the link is out of date."
          action={
            <Button variant="secondary" size="sm" onClick={() => router.push("/reports")}>
              Back to reports
            </Button>
          }
        />
      );
    }
    return (
      <>
        <DetailHeader backHref="/reports" backLabel="Reports" title="Report" />
        <ErrorPanel title="This report didn't load" message={state.error.message} onRetry={reload} />
      </>
    );
  }

  const report = state.data;
  const { content } = report;

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <DetailHeader
        backHref="/reports"
        backLabel="Reports"
        leading={
          <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground print:hidden" aria-hidden="true">
            {report.type === "baseline_comparison" ? <GitCompareArrows size={20} /> : <FileBarChart2 size={20} />}
          </span>
        }
        title={report.name}
        badges={<Badge variant="outline">{REPORT_TYPE_LABEL[report.type]}</Badge>}
        subtitle="A frozen snapshot — it won't change even if the underlying data does."
        meta={[
          { label: "Period", value: `${formatDate(content.periodStart)} – ${formatDate(content.periodEnd)}` },
          { label: "Generated", value: formatDateTime(report.generatedAt) },
          { label: "Type", value: REPORT_TYPE_LABEL[report.type] },
        ]}
        actions={
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={14} aria-hidden="true" /> Print / Save as PDF
          </Button>
        }
      />

      <PageStack>
        {content.reportType === "baseline_comparison" ? (
          <>
            <Section title="Where you stand vs. your baseline" className={PRINT_BLOCK}>
              <ScoreDeltaSummary scoreDelta={content.scoreDelta} baseline={content.baseline} current={content.current} />
            </Section>
            <Section title="What moved" description="Every component of the score, baseline against now." className={PRINT_BLOCK}>
              <ScoreComparison baseline={content.baseline} current={content.current} />
            </Section>
            <Section
              flush
              title="Competitor movement"
              description="Their AI visibility, previous run to latest. A competitor gaining is shown as a loss for you."
              className={PRINT_BLOCK}
            >
              <CompetitorMovementList movements={content.competitorMovements} />
            </Section>
            <Section flush title="New opportunities" description={`${formatNumber(content.newOpportunities.length)} surfaced in this period.`}>
              <ReportOpportunitiesList opportunities={content.newOpportunities} />
            </Section>
          </>
        ) : (
          <>
            <StatGrid columns={3} className={PRINT_BLOCK}>
              <StatTile label="Actions measured" icon={<Gauge size={13} />} value={formatNumber(content.summary.measurementCount)} hint="Re-measured in this period" />
              <StatTile label="New opportunities" icon={<Target size={13} />} value={formatNumber(content.summary.newOpportunityCount)} hint="From the SEO + GEO merge" />
              <StatTile label="Competitors moved" icon={<TrendingUp size={13} />} value={formatNumber(content.summary.competitorsMoved)} hint="AI visibility changed" />
            </StatGrid>
            <Section
              flush
              title="Score deltas"
              description="Each measured action's before → after, with how confident the attribution is."
              className={PRINT_BLOCK}
            >
              <ScoreDeltasList measurements={content.scoreDeltas} />
            </Section>
            <Section
              flush
              title="Competitor movement"
              description="Their AI visibility, previous run to latest. A competitor gaining is shown as a loss for you."
              className={PRINT_BLOCK}
            >
              <CompetitorMovementList movements={content.competitorMovements} />
            </Section>
            <Section flush title="New opportunities" description={`${formatNumber(content.newOpportunities.length)} surfaced in this period.`}>
              <ReportOpportunitiesList opportunities={content.newOpportunities} />
            </Section>
          </>
        )}
      </PageStack>
    </div>
  );
}

