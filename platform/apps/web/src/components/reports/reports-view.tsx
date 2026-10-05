"use client";

import { useState } from "react";
import { BarChart3, CalendarClock, FileBarChart2, GitCompareArrows, Plus } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Pagination,
  RefreshOverlay,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ClearFiltersButton, FilterSelect, ResultCount, Toolbar } from "@/components/patterns/toolbar";
import { CellLink, ClickableRow, TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { NoResults } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { useAsyncData } from "@/lib/use-async-data";
import { generateReport, listReports } from "@/data/reporting/client";
import { REPORT_TYPE_LABEL } from "@/data/reporting/labels";
import type { GenerateReportInput, ReportType } from "@/data/reporting/types";
import { formatDate, formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import { GenerateReportDialog } from "./generate-report-dialog";

const TYPE_OPTIONS: { value: ReportType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  ...(["weekly", "monthly", "custom", "baseline_comparison"] as const).map((t) => ({ value: t, label: REPORT_TYPE_LABEL[t] })),
];
const PAGE_SIZE = 25;

const COLUMNS: SkeletonColumn[] = [
  { header: "Report", cell: "entity" },
  { header: "Type", cell: "badge" },
  { header: "Period", cell: "text" },
  { header: "Generated", cell: "meta" },
];

/** Whole-library facts for the stat row, independent of the type filter:
 *  the server's totals plus the newest report of each kind. */
async function loadSummary() {
  const [all, baseline] = await Promise.all([listReports({ limit: 1 }), listReports({ type: "baseline_comparison", limit: 1 })]);
  return { total: all.total, latest: all.items[0] ?? null, baselineTotal: baseline.total, latestBaseline: baseline.items[0] ?? null };
}

/**
 * Epic 15's Reports screen — "Can I show this to my team/board?" Real
 * `listReports` (type filter is a server-side param) and `generateReport`.
 * Every row opens the immutable snapshot at `/reports/:id`.
 */
export function ReportsView() {
  const [typeFilter, setTypeFilter] = useState<ReportType | "all">("all");
  const [page, setPage] = useState(1);
  const { reload, ...state } = useAsyncData(
    () => listReports({ type: typeFilter === "all" ? undefined : typeFilter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    [typeFilter, page],
  );
  const { reload: reloadSummary, ...summaryState } = useAsyncData(loadSummary, []);

  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>();

  async function handleGenerate(input: GenerateReportInput) {
    setGenerating(true);
    setGenerateError(undefined);
    try {
      const report = await generateReport(input);
      setDialogOpen(false);
      toast({ title: "Report generated", description: `“${report.name}” is ready.` });
      reload();
      reloadSummary();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setGenerating(false);
    }
  }

  const generateButton = (
    <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)} className="h-9">
      <Plus size={14} aria-hidden="true" /> Generate report
    </Button>
  );

  const hasFilters = typeFilter !== "all";
  function clearFilters() {
    setTypeFilter("all");
    setPage(1);
  }

  const data = state.status === "success" ? state.data : null;
  const summary = summaryState.status === "success" ? summaryState.data : null;
  const firstRun = data !== null && data.total === 0 && !hasFilters;

  return (
    <PageStack>
      {!firstRun && state.status !== "error" && (
        <StatGrid columns={3}>
          <StatTile
            label="Reports"
            icon={<FileBarChart2 size={13} />}
            loading={!summary}
            value={summary ? formatNumber(summary.total) : "—"}
            hint="Frozen snapshots, newest first"
          />
          <StatTile
            label="Latest"
            icon={<CalendarClock size={13} />}
            loading={!summary}
            value={summary?.latest ? formatRelativeTime(summary.latest.generatedAt) : "—"}
            muted={!summary?.latest}
            hint={summary?.latest ? summary.latest.name : "Nothing generated yet"}
            href={summary?.latest ? `/reports/${summary.latest.id}` : undefined}
          />
          <StatTile
            label="Baseline comparisons"
            icon={<GitCompareArrows size={13} />}
            loading={!summary}
            value={summary ? formatNumber(summary.baselineTotal) : "—"}
            hint={summary?.latestBaseline ? `Latest ${formatDate(summary.latestBaseline.generatedAt)}` : "Where you started vs. today"}
            href={summary?.latestBaseline ? `/reports/${summary.latestBaseline.id}` : undefined}
          />
        </StatGrid>
      )}

      {!firstRun && (
        <Toolbar
          end={
            <>
              {data && <ResultCount count={data.total} noun="report" />}
              {generateButton}
            </>
          }
        >
          <FilterSelect
            value={typeFilter}
            onValueChange={(value) => {
              setTypeFilter(value);
              setPage(1);
            }}
            options={TYPE_OPTIONS}
            label="Filter by report type"
            className="sm:w-48"
          />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>
      )}

      <Reveal>
        {state.status === "loading" && <TableSkeleton columns={COLUMNS} rows={5} label="Loading reports…" />}

        {state.status === "error" && <ErrorPanel title="Reports didn't load" message={state.error.message} onRetry={reload} />}

        {firstRun && (
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No reports yet"
            description="A baseline comparison is available as soon as your first AI run completes; weekly and monthly reports become useful after a measurement cycle. Generate one any time."
            action={generateButton}
          />
        )}

        {data && data.items.length === 0 && hasFilters && (
          <NoResults noun="reports" onClear={clearFilters} hint={`No ${REPORT_TYPE_LABEL[typeFilter as ReportType].toLowerCase()} reports yet.`} />
        )}

        {data && data.items.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Generated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((report) => (
                  <ClickableRow key={report.id} href={`/reports/${report.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground" aria-hidden="true">
                          {report.type === "baseline_comparison" ? <GitCompareArrows size={13} /> : <FileBarChart2 size={13} />}
                        </span>
                        <CellLink href={`/reports/${report.id}`} className="block min-w-0 truncate text-[13px]">
                          {report.name}
                        </CellLink>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" size="sm">
                        {REPORT_TYPE_LABEL[report.type]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap text-[13px] text-muted-foreground">
                        {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={typography.meta} title={formatDateTime(report.generatedAt)}>
                        {formatRelativeTime(report.generatedAt)}
                      </span>
                    </TableCell>
                  </ClickableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="reports" />
          </RefreshOverlay>
        )}
      </Reveal>

      <GenerateReportDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setGenerateError(undefined);
        }}
        onSubmit={handleGenerate}
        submitError={generateError}
        submitting={generating}
      />
    </PageStack>
  );
}
