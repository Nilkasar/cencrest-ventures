"use client";

import { ChevronRight } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bebest/ui";
import type { AiRun, AiRunResponse, AiRunScore, ScoreComponentKey } from "@/data/ai-visibility/types";
import { SCORE_COMPONENT_DESCRIPTION, SCORE_COMPONENT_LABEL, providerLabel } from "@/data/ai-visibility/labels";
import { computeProviderBreakdown } from "@/data/ai-visibility/analysis";
import type { ResponseFilter } from "./response-filter";

const COMPONENT_ORDER: ScoreComponentKey[] = ["mentionScore", "recommendationScore", "positionScore", "coverageScore"];

/** Which raw-observation facet each formula component's number is drawn
 *  from — the second click of "number -> formula -> observations." Position
 *  and coverage are both only defined for a mention in the first place
 *  (`brand_first_position` is null unless `brand_mentioned`, and
 *  "coverage" counts distinct queries with a mention), so both route to
 *  the same `mentioned: true` facet — an honest reflection of what feeds
 *  each number, not four independent slices. */
const COMPONENT_DRILL: Record<ScoreComponentKey, ResponseFilter> = {
  mentionScore: { mentioned: true },
  recommendationScore: { recommended: true },
  positionScore: { mentioned: true },
  coverageScore: { mentioned: true },
};

/**
 * The headline number, per the epic's non-negotiable requirement: "the
 * score display must let a user drill from the number down to the formula
 * components down to the specific observation down to the actual raw AI
 * response — a bare number is a failed implementation of this screen."
 * This panel is the first two hops (number -> formula component); clicking
 * a component card hands the caller a `ResponseFilter` that lands on the
 * exact observations backing that component, in the Responses tab (the
 * third and fourth hops).
 *
 * Also renders the per-model breakdown ("score with model breakdown," the
 * other half of the UI-surface requirement) — computed client-side from
 * the run's responses (see `analysis.ts`'s doc comment for why: the AVS
 * formula itself is only ever computed in aggregate, never per-provider,
 * so this is real observed metrics per provider, not a re-derivation of
 * the formula per model).
 */
export function ScorePanel({
  run,
  score,
  responses,
  onDrill,
}: {
  run: AiRun;
  score: AiRunScore;
  responses: AiRunResponse[];
  onDrill: (filter: ResponseFilter) => void;
}) {
  const providerStats = computeProviderBreakdown(responses, run.providers);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="p-6 flex flex-col gap-6">
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">AI Visibility Score</p>
              {score.computed && score.aiVisibilityScore !== null ? (
                <p className="font-mono text-[44px] font-semibold text-foreground leading-none mt-1">
                  {score.aiVisibilityScore.toFixed(1)}
                  <span className="text-[18px] text-muted-foreground font-normal">/100</span>
                </p>
              ) : (
                <p className="font-mono text-[28px] font-semibold text-muted-foreground leading-none mt-1">Pending</p>
              )}
            </div>
            {score.scoringFormulaVersion && (
              <Badge variant="outline" size="sm">
                Formula v{score.scoringFormulaVersion}
              </Badge>
            )}
          </div>

          {!score.computed && (
            <p className="text-[12.5px] text-muted-foreground -mt-3">
              Computed once every job in this run has finished — {run.completedJobs + run.failedJobs} of {run.totalJobs} done
              so far.
            </p>
          )}

          <div>
            <p className="text-[11px] font-mono text-subtle-foreground mb-3">{score.formula}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {COMPONENT_ORDER.map((key) => {
                const component = score.breakdown[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onDrill(COMPONENT_DRILL[key])}
                    className="group text-left rounded-lg border border-border p-4 transition-colors hover:border-accent hover:bg-accent-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] font-medium text-foreground">{SCORE_COMPONENT_LABEL[key]}</p>
                      <ChevronRight size={14} className="text-subtle-foreground group-hover:text-accent transition-colors" />
                    </div>
                    <p className="font-mono text-[24px] font-semibold text-foreground mt-1.5">
                      {component.value !== null ? component.value.toFixed(1) : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {(component.weight * 100).toFixed(0)}% weight
                      {component.weightedContribution !== null ? ` -> ${component.weightedContribution.toFixed(1)} pts` : ""}
                    </p>
                    <p className="text-[11px] text-subtle-foreground mt-2 leading-relaxed">{SCORE_COMPONENT_DESCRIPTION[key]}</p>
                  </button>
                );
              })}
            </div>
            {score.computed && (
              <p className="text-[11px] text-subtle-foreground mt-3">
                The four weighted contributions above sum to exactly {score.aiVisibilityScore?.toFixed(1)} — click any
                component to see the responses behind it.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="border-0 rounded-none">
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead>Mentioned</TableHead>
                <TableHead>Recommended</TableHead>
                <TableHead>Avg. position</TableHead>
                <TableHead>Avg. latency</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {providerStats.map((stats) => (
                <TableRow key={stats.provider} className="cursor-pointer" onClick={() => onDrill({ provider: stats.provider })}>
                  <TableCell className="whitespace-nowrap">{providerLabel(stats.provider)}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{stats.totalJobs}</TableCell>
                  <TableCell className="font-mono">
                    {stats.mentionRatePct !== null ? `${stats.mentionRatePct}%` : "—"}
                    <span className="text-subtle-foreground"> ({stats.mentioned})</span>
                  </TableCell>
                  <TableCell className="font-mono">
                    {stats.recommendationRatePct !== null ? `${stats.recommendationRatePct}%` : "—"}
                    <span className="text-subtle-foreground"> ({stats.recommended})</span>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {stats.avgFirstPosition !== null ? `${Math.round(stats.avgFirstPosition * 100)}%` : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {stats.avgLatencyMs !== null ? `${stats.avgLatencyMs.toLocaleString()}ms` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight size={14} className="text-subtle-foreground inline-block" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ScorePanelSkeleton() {
  return (
    <Card>
      <CardContent className="p-6 flex flex-col gap-4">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-11 w-32" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
