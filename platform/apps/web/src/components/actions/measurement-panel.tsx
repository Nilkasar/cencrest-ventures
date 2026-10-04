"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Skeleton, cn } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { getActionMeasurement } from "@/data/measurement/client";
import { ATTRIBUTION_CONFIDENCE_BADGE_VARIANT, ATTRIBUTION_CONFIDENCE_LABEL } from "@/data/measurement/labels";
import type { GeoScoreComponent, Measurement, ScoreDeltaBasis, ScoreSnapshot, SeoScoreComponent } from "@/data/measurement/types";
import type { ActionWithContext } from "@/data/actions/types";
import { formatDate, formatDateTime, formatDelta } from "@/lib/format";
import { DisclosureButton } from "@/components/recommendations/level-meter";
import { ScoreShift } from "@/components/reports/score-shift";

/** The backend's own 4-week trigger (`schedule-remeasurement.ts`'s
 *  `FOUR_WEEKS_MS`) — used only to give the "not measured yet" state an
 *  honest ETA, never to predict the measurement itself. */
const REMEASUREMENT_WINDOW_DAYS = 28;

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Which component `computeScoreDelta` (`apps/api/src/lib/measurement/
 *  scoring.ts`) compared — GEO preferred over SEO when both sides have it.
 *  Re-derived here with the identical preference order; if the backend's
 *  order changes, this must change with it. */
function pickDeltaBasis(before: ScoreSnapshot, after: ScoreSnapshot): ScoreDeltaBasis {
  if (before.geo && after.geo) return "geo";
  if (before.seo && after.seo) return "seo";
  return "none";
}

function basisScore(snapshot: ScoreSnapshot, basis: "geo" | "seo"): number | null {
  if (basis === "geo") return snapshot.geo?.aiVisibilityScore ?? null;
  return snapshot.seo?.overallScore ?? null;
}

function basisLabel(basis: ScoreDeltaBasis): string {
  if (basis === "geo") return "AI Visibility Score";
  if (basis === "seo") return "SEO Health Score";
  return "score";
}

const shell = "rounded-lg border border-border bg-surface/60 px-3.5 py-3";
const eyebrow = "font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground";

/**
 * "Did it work?" for one completed (or rolled-back) action — Epic 14's
 * before/after delta with attribution confidence visibly labeled, never
 * presented as more certain than it is. Self-fetches `GET
 * /actions/:id/measurement`.
 */
export function MeasurementPanel({ action }: { action: ActionWithContext }) {
  const { reload, ...state } = useAsyncData(() => getActionMeasurement(action.id), [action.id]);

  if (state.status === "loading") {
    return (
      <div className={cn(shell, "flex flex-col gap-2")} aria-busy="true">
        <span className="sr-only">Loading outcome…</span>
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-2 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return <ErrorPanel compact title="Couldn't load the outcome measurement" message={state.error.message} onRetry={reload} />;
  }

  if (!state.data.measured) {
    const { executedAt, beforeScoreCapturedAt } = state.data.action;
    const eta = executedAt ? addDays(executedAt, REMEASUREMENT_WINDOW_DAYS) : null;
    return (
      <div className={cn(shell, "flex items-start gap-3")}>
        <CalendarClock size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className={eyebrow}>Did it work?</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {beforeScoreCapturedAt
              ? `A baseline was captured before this ran. We re-measure about 4 weeks after execution${eta ? ` — around ${formatDate(eta)}` : ""} and the result appears here.`
              : "No baseline score existed when this was approved, so its effect can't be measured as a before/after."}
          </p>
        </div>
      </div>
    );
  }

  return <MeasuredOutcome measurement={state.data.measurement} />;
}

function MeasuredOutcome({ measurement }: { measurement: Measurement }) {
  const [expanded, setExpanded] = useState(false);
  const basis = pickDeltaBasis(measurement.beforeScore, measurement.afterScore);
  const delta = measurement.scoreDelta;
  const before = basis === "none" ? null : basisScore(measurement.beforeScore, basis);
  const after = basis === "none" ? null : basisScore(measurement.afterScore, basis);

  const direction = delta === null ? "none" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const DirectionIcon = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const directionColor = direction === "up" ? "text-success" : direction === "down" ? "text-danger" : "text-muted-foreground";

  return (
    <div className={cn(shell, "flex flex-col gap-3")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={eyebrow}>Did it work?</p>
          <div className="mt-1 flex items-baseline gap-2">
            <DirectionIcon size={16} className={cn("shrink-0 self-center", directionColor)} aria-hidden="true" />
            {delta !== null ? (
              <p className={cn("text-[22px] font-semibold leading-none tabular-nums", directionColor)}>
                {formatDelta(delta, 1)} <span className="text-[13px] font-normal text-muted-foreground">pts</span>
              </p>
            ) : (
              <p className="text-[15px] font-medium leading-none text-muted-foreground">Not enough data</p>
            )}
          </div>
          {before !== null && after !== null && (
            <p className="mt-1.5 font-mono text-[12px] tabular-nums text-muted-foreground">
              {basisLabel(basis)}: {before.toFixed(1)} → {after.toFixed(1)}
            </p>
          )}
        </div>
        <Badge variant={ATTRIBUTION_CONFIDENCE_BADGE_VARIANT[measurement.attributionConfidence]} size="sm" className="self-start">
          {ATTRIBUTION_CONFIDENCE_LABEL[measurement.attributionConfidence]}
        </Badge>
      </div>

      {before !== null && after !== null && <ScoreShift before={before} after={after} beforeLabel="Before" afterLabel="After" />}

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{measurement.attributionNotes}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DisclosureButton expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          Score breakdown
        </DisclosureButton>
        {measurement.afterAiRunId && (
          <Link
            href="/ai-visibility"
            className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Raw AI responses <ArrowRight size={12} aria-hidden="true" />
          </Link>
        )}
        <span className="ml-auto text-[12px] text-subtle-foreground">Measured {formatDateTime(measurement.measuredAt)}</span>
      </div>

      {expanded && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentBreakdown label="Before" snapshot={measurement.beforeScore} capturedAt={measurement.beforeScoreCapturedAt} />
          <ComponentBreakdown label="After" snapshot={measurement.afterScore} capturedAt={measurement.afterScore.capturedAt} />
        </div>
      )}
    </div>
  );
}

function ComponentBreakdown({ label, snapshot, capturedAt }: { label: string; snapshot: ScoreSnapshot; capturedAt: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <p className={cn(eyebrow, "mb-2")}>
        {label} · {formatDate(capturedAt)}
      </p>
      {!snapshot.geo && !snapshot.seo && <p className="text-[12.5px] text-muted-foreground">No comparable score data for this snapshot.</p>}
      {snapshot.geo && <GeoRow component={snapshot.geo} />}
      {snapshot.seo && <SeoRow component={snapshot.seo} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-[13px] tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function GeoRow({ component }: { component: GeoScoreComponent }) {
  return (
    <div className="mb-3 flex flex-col gap-2 last:mb-0">
      <p className="text-[12.5px] font-medium text-foreground">
        AI Visibility {component.aiVisibilityScore.toFixed(1)}{" "}
        <span className="font-mono text-[10.5px] font-normal text-subtle-foreground">formula v{component.formulaVersion}</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Mention" value={component.mentionScore.toFixed(1)} />
        <Stat label="Recommendation" value={component.recommendationScore.toFixed(1)} />
        <Stat label="Position" value={component.positionScore.toFixed(1)} />
        <Stat label="Coverage" value={component.coverageScore.toFixed(1)} />
      </div>
    </div>
  );
}

function SeoRow({ component }: { component: SeoScoreComponent }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] font-medium text-foreground">
        SEO Health {component.overallScore.toFixed(1)}{" "}
        <span className="font-mono text-[10.5px] font-normal text-subtle-foreground">
          v{component.formulaVersion} · {component.pagesAnalyzed} page{component.pagesAnalyzed === 1 ? "" : "s"}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Technical" value={component.technicalScore !== null ? component.technicalScore.toFixed(1) : "—"} />
        <Stat label="Content" value={component.contentScore !== null ? component.contentScore.toFixed(1) : "—"} />
      </div>
    </div>
  );
}
