"use client";

import Link from "next/link";
import { useState } from "react";
import { BarChart3, ChevronRight, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { generateReport, listReports, NoBrandProfileError } from "@/data/reporting/client";
import { REPORT_TYPE_BADGE_VARIANT, REPORT_TYPE_LABEL } from "@/data/reporting/labels";
import type { GenerateReportInput, ReportSummary, ReportType } from "@/data/reporting/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { GenerateReportDialog } from "./generate-report-dialog";

const TYPE_FILTERS: Array<ReportType | "all"> = ["all", "weekly", "monthly", "custom", "baseline_comparison"];

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

function ReportRow({ report }: { report: ReportSummary }) {
  return (
    <Link
      href={`/reports/${report.id}`}
      className="group flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={REPORT_TYPE_BADGE_VARIANT[report.type]} size="sm">
            {REPORT_TYPE_LABEL[report.type]}
          </Badge>
          <p className="text-[13px] font-medium text-foreground truncate">{report.name}</p>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1">
          {formatDate(report.periodStart)} – {formatDate(report.periodEnd)} · generated {formatDateTime(report.generatedAt)}
        </p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-subtle-foreground group-hover:text-accent transition-colors" />
    </Link>
  );
}

/**
 * Epic 15 (Reporting & Notifications)'s Reports screen
 * (`docs/09-ux/CUSTOMER_JOURNEY.md`: "Can I show this to my team/board?").
 * Calls `platform/apps/api`'s real, tested routes from the first line, no
 * fixture layer: `data/reporting/client.ts`'s `listReports`/
 * `generateReport`. Filtering by `type` is a real server-side query param
 * (`GET /brands/me/reports`), same convention `OpportunitiesView` sets.
 */
export function ReportsView() {
  const [typeFilter, setTypeFilter] = useState<ReportType | "all">("all");
  const { reload, ...state } = useAsyncData(
    () => listReports({ type: typeFilter === "all" ? undefined : typeFilter, limit: 50 }),
    [typeFilter],
  );

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
      toast({ title: "Report generated", description: `"${report.name}" is ready.` });
      reload();
    } catch (err) {
      setGenerateError(
        err instanceof NoBrandProfileError ? err.message : err instanceof Error ? err.message : "Something went wrong — try again.",
      );
    } finally {
      setGenerating(false);
    }
  }

  const generateButton = (
    <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
      <Plus size={14} /> Generate report
    </Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Reports"
        description="Can I show this to my team or board? Weekly digests, monthly performance, custom ranges, and the baseline comparison — each one an immutable, board-ready snapshot."
        actions={generateButton}
      />

      <Card>
        <CardContent className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display text-[16px] font-semibold text-foreground">All reports</h2>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Sorted by most recently generated{state.status === "success" ? ` — ${state.data.total} total` : ""}.
              </p>
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ReportType | "all")}>
              <SelectTrigger className="w-44 h-8 text-[12.5px]" aria-label="Filter by report type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "all" ? "All types" : REPORT_TYPE_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {state.status === "loading" && <ListSkeleton />}

          {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

          {state.status === "success" && state.data.items.length === 0 && (
            <EmptyState
              compact
              icon={<BarChart3 size={18} />}
              title={typeFilter === "all" ? "No reports yet" : `No ${REPORT_TYPE_LABEL[typeFilter as ReportType].toLowerCase()} reports yet`}
              description="Reports summarize measured change, so the first one is most useful after your baseline plus at least one measurement cycle. You can generate one on demand any time — including a baseline comparison as soon as your first AI run completes."
              action={generateButton}
            />
          )}

          {state.status === "success" && state.data.items.length > 0 && (
            <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
              {state.data.items.map((report) => (
                <ReportRow key={report.id} report={report} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
    </>
  );
}
