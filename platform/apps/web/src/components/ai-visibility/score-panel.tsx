"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { Badge, Skeleton, cn, easings } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import { AnimatedNumber, SrTable } from "@/components/overview/primitives";
import type { AiRun, AiRunScore, ScoreComponentKey } from "@/data/ai-visibility/types";
import { SCORE_COMPONENT_DESCRIPTION, SCORE_COMPONENT_LABEL } from "@/data/ai-visibility/labels";
import { formatDate, formatDelta, formatNumber } from "@/lib/format";
import type { ResponseFilter } from "./response-filter";
import { shortProviderLabel } from "./status-badges";

const COMPONENT_ORDER: ScoreComponentKey[] = ["mentionScore", "recommendationScore", "positionScore", "coverageScore"];

/** Which raw-observation facet each formula component is drawn from — the
 *  hop from "formula component" to "the answers behind it". Position and
 *  coverage are both only defined for a mention, so both route to the
 *  `mentioned` facet: an honest mapping, not four invented slices. */
const COMPONENT_DRILL: Record<ScoreComponentKey, ResponseFilter> = {
  mentionScore: { mentioned: true },
  recommendationScore: { recommended: true },
  positionScore: { mentioned: true },
  coverageScore: { mentioned: true },
};

export interface PreviousScore {
  score: number;
  completedAt: string;
}

/**
 * The headline: score → formula → evidence, on one surface. Left is the
 * number (a dial out of 100, with the change since the previous completed
 * run when one exists); right is the formula's four weighted components,
 * each a button that narrows the Responses explorer to the answers behind
 * it. A bare number is never shown on its own.
 */
export function ScoreHero({
  run,
  score,
  previous,
  responseCount,
  subject,
  actions,
  onDrill,
}: {
  run: AiRun;
  score: AiRunScore;
  previous: PreviousScore | null;
  responseCount: number;
  /** "you" or the competitor's name — used in copy. */
  subject: string;
  actions?: ReactNode;
  onDrill: (filter: ResponseFilter) => void;
}) {
  const value = score.computed ? score.aiVisibilityScore : null;
  const delta = value !== null && previous ? value - previous.score : null;

  return (
    <Section
      title="AI Visibility Score"
      description={`How often, how early and how strongly AI assistants mention and recommend ${subject}.`}
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col items-center gap-3 lg:items-start">
          <ScoreDial value={value} progressPct={run.progressPct} />
          <div className="flex flex-col items-center gap-1 text-center lg:items-start lg:text-left">
            {delta !== null && previous ? (
              <p className="text-[12.5px] text-muted-foreground">
                <span className={cn("font-mono font-medium tabular-nums", delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-foreground")}>
                  {formatDelta(delta, 1, " pts")}
                </span>{" "}
                since {formatDate(previous.completedAt)}
              </p>
            ) : value !== null ? (
              <p className="text-[12.5px] text-muted-foreground">First completed run — the next one shows the change.</p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Calculated when every answer is in — {formatNumber(run.completedJobs + run.failedJobs)} of {formatNumber(run.totalJobs)} so far.
              </p>
            )}
            <p className={typography.meta}>
              {formatNumber(responseCount)} answers · {run.providers.map(shortProviderLabel).join(", ")}
              {run.completedAt ? ` · ${formatDate(run.completedAt)}` : ""}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className={typography.eyebrow}>How it&apos;s calculated</p>
            {score.scoringFormulaVersion && (
              <Badge variant="outline" size="sm">
                Formula v{score.scoringFormulaVersion}
              </Badge>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {COMPONENT_ORDER.map((key, i) => {
              const component = score.breakdown[key];
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onDrill(COMPONENT_DRILL[key])}
                    className="group -mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">{SCORE_COMPONENT_LABEL[key]}</span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-subtle-foreground">×{Math.round(component.weight * 100)}%</span>
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-[13px] font-medium tabular-nums text-foreground">
                        {component.value !== null ? component.value.toFixed(1) : "—"}
                      </span>
                      <span className="hidden font-mono text-[11.5px] tabular-nums text-muted-foreground sm:inline">
                        {component.weightedContribution !== null ? `= ${component.weightedContribution.toFixed(1)} pts` : ""}
                      </span>
                      <ChevronRight size={13} className="self-center text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
                    </span>
                    <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface group-hover:bg-surface-raised" aria-hidden="true">
                      <motion.span
                        className="block h-full w-full origin-left rounded-full bg-accent"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: (component.value ?? 0) / 100 }}
                        transition={{ duration: 0.9, delay: 0.15 + i * 0.07, ease: easings.emphasized }}
                      />
                    </span>
                    <span className="col-span-2 text-[12px] leading-snug text-muted-foreground">{SCORE_COMPONENT_DESCRIPTION[key]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border pt-3 font-mono text-[11px] leading-relaxed text-subtle-foreground">{score.formula}</p>
          <p className="-mt-1 text-[12px] text-muted-foreground">
            {score.computed && value !== null
              ? `The weighted contributions sum to ${value.toFixed(1)}. Select a component to read the answers behind it.`
              : "Select a component to read the answers gathered so far."}
          </p>
          <SrTable
            caption="AI Visibility Score formula components"
            head={["Component", "Value", "Weight", "Contribution (pts)"]}
            rows={COMPONENT_ORDER.map((key) => {
              const c = score.breakdown[key];
              return [
                SCORE_COMPONENT_LABEL[key],
                c.value !== null ? c.value.toFixed(1) : "—",
                `${Math.round(c.weight * 100)}%`,
                c.weightedContribution !== null ? c.weightedContribution.toFixed(1) : "—",
              ];
            })}
          />
        </div>
      </div>
    </Section>
  );
}

const R = 78;
const STROKE = 10;

/** Score out of 100 as a ring. Before the score exists, the ring shows the
 *  run's real job progress instead (dashed track), labelled "Pending". */
function ScoreDial({ value, progressPct }: { value: number | null; progressPct: number }) {
  const fraction = value !== null ? value / 100 : progressPct / 100;
  return (
    <div className="relative size-[176px]">
      <svg viewBox="0 0 180 180" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="90" cy="90" r={R} fill="none" strokeWidth={STROKE} className="stroke-surface" strokeDasharray={value === null ? "2 4" : undefined} />
        <motion.circle
          cx="90"
          cy="90"
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className={value === null ? "stroke-border-strong" : "stroke-accent"}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.max(0.001, Math.min(1, fraction)) }}
          transition={{ duration: 1.2, ease: easings.emphasized }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {value !== null ? (
          <>
            <AnimatedNumber value={value} format={(v) => v.toFixed(1)} className="font-display text-[40px] font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums" />
            <span className="mt-1 font-mono text-[11px] text-subtle-foreground">/ 100</span>
          </>
        ) : (
          <>
            <span className="font-display text-[22px] font-semibold text-muted-foreground">Pending</span>
            <span className="mt-1 font-mono text-[11px] tabular-nums text-subtle-foreground">{Math.round(progressPct)}% gathered</span>
          </>
        )}
      </div>
    </div>
  );
}

export function ScoreHeroSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-5" aria-busy="true">
      <span className="sr-only">Loading score…</span>
      <div aria-hidden="true" className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col items-center gap-3 lg:items-start">
          <Skeleton className="size-[176px] rounded-full" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-3 w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
