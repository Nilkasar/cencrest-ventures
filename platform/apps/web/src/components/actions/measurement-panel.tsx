"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronUp, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Skeleton } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { getActionMeasurement } from "@/data/measurement/client";
import { ATTRIBUTION_CONFIDENCE_BADGE_VARIANT, ATTRIBUTION_CONFIDENCE_LABEL } from "@/data/measurement/labels";
import type { GeoScoreComponent, Measurement, ScoreDeltaBasis, ScoreSnapshot, SeoScoreComponent } from "@/data/measurement/types";
import type { ActionWithContext } from "@/data/actions/types";
import { formatDate, formatDateTime } from "@/lib/format";

/** The backend's own 4-week trigger (`schedule-remeasurement.ts`'s
 *  `FOUR_WEEKS_MS`) — used here only to give the "not measured yet" state a
 *  real, honest ETA, never to predict the actual measurement itself. */
const REMEASUREMENT_WINDOW_DAYS = 28;

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Which component `computeScoreDelta` (`apps/api/src/lib/measurement/
 * scoring.ts`) actually compared — GEO preferred over SEO when both sides
 * have a GEO component, SEO as the fallback, `"none"` otherwise. The API
 * response carries the resulting `scoreDelta` number but not this label, so
 * it's re-derived here from the same before/after snapshot using the
 * identical preference order the backend's own pure function documents —
 * if that preference order ever changes, this must change with it.
 */
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

/**
 * The before/after delta and attribution estimate for one completed (or
 * rolled-back) action — Epic 14's UI surface, per its own spec: "surface
 * the before/after delta directly on the action it measures, with the
 * attribution confidence visibly labeled, never presented as more certain
 * than it is." Self-fetches `GET /actions/:id/measurement`, same
 * per-row-self-fetch convention `keyword-group-card.tsx` (Epic 4) already
 * establishes, rather than the parent list view bulk-loading every action's
 * measurement up front.
 */
export function MeasurementPanel({ action }: { action: ActionWithContext }) {
  const { reload, ...state } = useAsyncData(() => getActionMeasurement(action.id), [action.id]);

  if (state.status === "loading") {
    return (
      <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-6 w-36" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <ErrorPanel compact title="Couldn't load the outcome measurement" message={state.error.message} onRetry={reload} />
      </div>
    );
  }

  if (!state.data.measured) {
    const { executedAt, beforeScoreCapturedAt } = state.data.action;
    const eta = executedAt ? addDays(executedAt, REMEASUREMENT_WINDOW_DAYS) : null;
    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">Did it work?</p>
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">
          {beforeScoreCapturedAt
            ? `A baseline score was captured before this action ran. We automatically re-measure ~4 weeks after execution to see what changed${eta ? ` — around ${formatDate(eta)}` : ""}, and it'll show up here once it does.`
            : "No baseline score was available to compare against when this action was approved, so its effect can't be measured against a before/after."}
        </p>
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
  const directionColor =
    direction === "up" ? "text-success" : direction === "down" ? "text-danger" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">Did it work?</p>
          <div className="flex items-baseline gap-2">
            <DirectionIcon size={16} className={`${directionColor} shrink-0`} aria-hidden="true" />
            {delta !== null ? (
              <p className={`font-mono text-[22px] font-semibold leading-none ${directionColor}`}>
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)} <span className="text-[13px] font-normal text-muted-foreground">pts</span>
              </p>
            ) : (
              <p className="font-mono text-[16px] font-medium text-muted-foreground leading-none">Not enough data</p>
            )}
          </div>
          {basis !== "none" && before !== null && after !== null && (
            <p className="text-[11.5px] text-muted-foreground mt-1">
              {basisLabel(basis)}: {before.toFixed(1)} → {after.toFixed(1)}
            </p>
          )}
        </div>
        <Badge variant={ATTRIBUTION_CONFIDENCE_BADGE_VARIANT[measurement.attributionConfidence]} size="sm">
          {ATTRIBUTION_CONFIDENCE_LABEL[measurement.attributionConfidence]}
        </Badge>
      </div>

      <p className="text-[12px] text-muted-foreground leading-relaxed">{measurement.attributionNotes}</p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {expanded ? (
            <>
              Hide score breakdown <ChevronUp size={12} />
            </>
          ) : (
            <>
              Show score breakdown <ChevronDown size={12} />
            </>
          )}
        </button>
        {measurement.afterAiRunId && (
          <Link
            href="/ai-visibility"
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
          >
            View raw AI responses in AI Visibility <ArrowRight size={11} />
          </Link>
        )}
        <span className="text-[11px] text-subtle-foreground">Measured {formatDateTime(measurement.measuredAt)}</span>
      </div>

      {expanded && (
        <div className="rounded-lg border border-border/70 bg-background p-3 flex flex-col gap-3">
          <ComponentBreakdown label="Baseline (before)" snapshot={measurement.beforeScore} capturedAt={measurement.beforeScoreCapturedAt} />
          <ComponentBreakdown label="Re-measured (after)" snapshot={measurement.afterScore} capturedAt={measurement.afterScore.capturedAt} />
        </div>
      )}
    </div>
  );
}

function ComponentBreakdown({ label, snapshot, capturedAt }: { label: string; snapshot: ScoreSnapshot; capturedAt: string }) {
  return (
    <div>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1.5">
        {label} · captured {formatDate(capturedAt)}
      </p>
      {!snapshot.geo && !snapshot.seo && <p className="text-[12px] text-subtle-foreground">No comparable score data for this snapshot.</p>}
      {snapshot.geo && <GeoRow component={snapshot.geo} />}
      {snapshot.seo && <SeoRow component={snapshot.seo} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-subtle-foreground">{label}</p>
      <p className="font-mono text-[13px] text-foreground">{value}</p>
    </div>
  );
}

function GeoRow({ component }: { component: GeoScoreComponent }) {
  return (
    <div className="flex flex-col gap-1.5 mb-2 last:mb-0">
      <p className="text-[11.5px] font-medium text-foreground">
        AI Visibility Score — {component.aiVisibilityScore.toFixed(1)}{" "}
        <span className="font-mono text-[10px] text-subtle-foreground font-normal">formula v{component.formulaVersion}</span>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
    <div className="flex flex-col gap-1.5">
      <p className="text-[11.5px] font-medium text-foreground">
        SEO Health Score — {component.overallScore.toFixed(1)}{" "}
        <span className="font-mono text-[10px] text-subtle-foreground font-normal">
          formula v{component.formulaVersion} · {component.pagesAnalyzed} page{component.pagesAnalyzed === 1 ? "" : "s"} analyzed
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Technical" value={component.technicalScore !== null ? component.technicalScore.toFixed(1) : "—"} />
        <Stat label="Content" value={component.contentScore !== null ? component.contentScore.toFixed(1) : "—"} />
      </div>
    </div>
  );
}
