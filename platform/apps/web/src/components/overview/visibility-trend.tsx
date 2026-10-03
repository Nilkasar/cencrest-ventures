"use client";

import { LineChart } from "lucide-react";
import type { AsyncState } from "@/lib/use-async-data";
import type { AiRun } from "@/data/ai-visibility/types";
import { formatDate } from "@/lib/format";
import { SHORT_DATE } from "./chart-math";
import { Panel, PanelEmpty, PanelError, PanelSkeleton, SrTable } from "./primitives";
import { TrendChart } from "./trend-chart";

/**
 * "Am I trending up?" — every COMPLETED brand AI Visibility run, plotted at
 * its real `completedAt` with its real stored score. No interpolation to a
 * daily series, no projected tail: a brand with two runs gets a two-point
 * line, a brand with one gets a single marked point and an honest note that
 * the line starts with the next run.
 */
export function VisibilityTrend({ runs, className }: { runs: AsyncState<AiRun[]> & { reload: () => void }; className?: string }) {
  return (
    <Panel eyebrow="AI Visibility" title="Score over time" icon={<LineChart size={14} />} href="/ai-visibility" hrefLabel="Runs" className={className}>
      <Body runs={runs} />
    </Panel>
  );
}

function Body({ runs }: { runs: AsyncState<AiRun[]> & { reload: () => void } }) {
  if (runs.status === "loading") return <PanelSkeleton height={250} />;
  if (runs.status === "error") return <PanelError onRetry={runs.reload} height={250} />;

  const series = runs.data
    .filter((r) => r.competitorId === null && r.status === "completed" && r.aiVisibilityScore !== null && r.completedAt)
    .map((r) => ({ t: new Date(r.completedAt!).getTime(), v: r.aiVisibilityScore!, run: r }))
    .sort((a, b) => a.t - b.t);

  if (series.length === 0) {
    return (
      <PanelEmpty
        icon={<LineChart size={16} />}
        height={250}
        title="No score history yet"
        body="Each completed visibility run adds a point here. Run your baseline to plot the first one."
        action={{ href: "/ai-visibility", label: "Go to AI Visibility" }}
      />
    );
  }

  const first = series[0]!;
  const last = series[series.length - 1]!;
  const change = last.v - first.v;
  const best = series.reduce((a, b) => (b.v > a.v ? b : a));

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Runs" value={String(series.length)} />
        <Stat label="Best" value={best.v.toFixed(1)} />
        <Stat
          label={series.length > 1 ? `Since ${SHORT_DATE.format(first.t)}` : "Change"}
          value={series.length > 1 ? `${change > 0 ? "+" : ""}${change.toFixed(1)}` : "—"}
          tone={series.length > 1 ? (change > 0 ? "up" : change < 0 ? "down" : undefined) : undefined}
        />
      </dl>
      <TrendChart
        points={series.map(({ t, v }) => ({ t, v }))}
        height={210}
        formatValue={(v) => v.toFixed(v % 1 === 0 ? 0 : 1)}
        ariaSummary={`AI Visibility Score across ${series.length} completed run${series.length === 1 ? "" : "s"}, latest ${last.v.toFixed(1)} on ${formatDate(new Date(last.t).toISOString())}.`}
        tooltipDetail={(i) => (
          <p className="text-[11px] text-muted-foreground whitespace-nowrap">
            {series[i]!.run.totalJobs.toLocaleString("en-US")} answers · v{series[i]!.run.scoringFormulaVersion ?? "—"}
          </p>
        )}
      />
      {series.length === 1 && (
        <p className="text-[11.5px] text-subtle-foreground">One run so far — your trend line starts with the next completed run.</p>
      )}
      <SrTable
        caption="AI Visibility Score by completed run"
        head={["Completed", "Score", "Answers"]}
        rows={series.map((s) => [formatDate(new Date(s.t).toISOString()), s.v.toFixed(1), s.run.totalJobs])}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2 min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground truncate">{label}</dt>
      <dd className={`mt-0.5 text-[16px] font-semibold ${tone === "up" ? "text-success" : tone === "down" ? "text-danger" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}
