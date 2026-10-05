"use client";

import { History, LineChart } from "lucide-react";
import { Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import { SrTable } from "@/components/overview/primitives";
import { TrendChart } from "@/components/overview/trend-chart";
import type { AiRun } from "@/data/ai-visibility/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { RunStatusBadge, shortProviderLabel } from "./status-badges";

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/** Completed runs with a score, oldest first — the only honest points a
 *  trend can plot. */
export function completedSeries(runs: AiRun[]) {
  return runs
    .filter((r) => r.status === "completed" && r.aiVisibilityScore !== null && r.completedAt)
    .map((r) => ({ t: new Date(r.completedAt!).getTime(), v: r.aiVisibilityScore!, run: r }))
    .sort((a, b) => a.t - b.t);
}

/**
 * "Am I trending up?" — every completed run at its real `completedAt` with
 * its stored score. One run is one marked point and an honest note; no
 * interpolated or projected history.
 */
export function ScoreTrendPanel({ runs, className }: { runs: AiRun[]; className?: string }) {
  const series = completedSeries(runs);
  const last = series[series.length - 1];
  return (
    <Section title="Score over time" description="Each completed run, at the score it was calculated at." className={className}>
      {series.length === 0 || !last ? (
        <EmptyState compact icon={<LineChart size={18} />} title="No completed runs yet" description="Your trend starts with the first completed run." />
      ) : (
        <div className="flex flex-col gap-2">
          <TrendChart
            points={series.map(({ t, v }) => ({ t, v }))}
            height={200}
            domain={[0, 100]}
            formatValue={(v) => v.toFixed(v % 1 === 0 ? 0 : 1)}
            ariaSummary={`AI Visibility Score across ${series.length} completed run${series.length === 1 ? "" : "s"}, latest ${last.v.toFixed(1)} on ${formatDate(last.run.completedAt!)}.`}
            tooltipDetail={(i) => (
              <p className="whitespace-nowrap text-[11px] text-muted-foreground">
                {series[i]!.run.totalJobs.toLocaleString("en-US")} answers · v{series[i]!.run.scoringFormulaVersion ?? "—"}
              </p>
            )}
          />
          {series.length === 1 && <p className="text-[12px] text-muted-foreground">One run so far — the line starts with the next completed run.</p>}
          <SrTable
            caption="AI Visibility Score by completed run"
            head={["Completed", "Score", "Answers"]}
            rows={series.map((s) => [formatDate(s.run.completedAt!), s.v.toFixed(1), s.run.totalJobs])}
          />
        </div>
      )}
    </Section>
  );
}

/**
 * Every run, newest first. A re-run is always a NEW row (history is never
 * overwritten), so any past run's evidence can be reopened here.
 */
export function AiRunHistoryTable({
  runs,
  viewingRunId,
  onView,
  className,
}: {
  runs: AiRun[];
  viewingRunId: string;
  onView: (runId: string) => void;
  className?: string;
}) {
  return (
    <Section title="Run history" description="Open any past run to see its evidence." icon={<History size={14} />} flush className={className}>
      <Table framed={false} containerClassName="max-h-[360px] overflow-y-auto" className="[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead>
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const isViewing = run.id === viewingRunId;
            const hasResults = run.status === "completed" || run.status === "failed";
            const duration = formatDuration(run.startedAt, run.completedAt);
            return (
              <TableRow key={run.id} className={cn(isViewing && "bg-accent-muted/40 hover:bg-accent-muted/50")} aria-current={isViewing ? "true" : undefined}>
                <TableCell>
                  <p className="whitespace-nowrap text-[13px] text-foreground">{formatDateTime(run.startedAt ?? run.createdAt)}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {run.providers.map(shortProviderLabel).join(", ")}
                    {duration ? ` · ${duration}` : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                <TableCell className="text-right">
                  <span className={cn(typography.numeric, "font-medium")}>{run.aiVisibilityScore !== null ? run.aiVisibilityScore.toFixed(1) : "—"}</span>
                </TableCell>
                <TableCell className="text-right">
                  {isViewing ? (
                    <span className="text-[12px] font-medium text-muted-foreground">Viewing</span>
                  ) : (
                    hasResults && (
                      <Button variant="ghost" size="sm" onClick={() => onView(run.id)} aria-label={`View run from ${formatDateTime(run.startedAt ?? run.createdAt)}`}>
                        View
                      </Button>
                    )
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Section>
  );
}
