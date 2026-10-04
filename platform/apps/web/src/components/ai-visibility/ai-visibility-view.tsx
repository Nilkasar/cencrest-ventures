"use client";

import { useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@bebest/ui";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAiRun } from "@/hooks/use-ai-run";
import { useAsyncData } from "@/lib/use-async-data";
import { listAiRuns } from "@/data/ai-visibility/client";
import { formatDateTime } from "@/lib/format";
import { AiRunEmptyState, StartErrorAlert, describeStartError } from "./ai-run-empty-state";
import { AiRunProgressPanel } from "./ai-run-progress-panel";
import { AiRunFailedPanel } from "./ai-run-failed-panel";
import { AiRunHistoryTable, ScoreTrendPanel, completedSeries } from "./ai-run-history";
import { AiRunDetail } from "./ai-run-detail";
import { ScoreHeroSkeleton, type PreviousScore } from "./score-panel";

/**
 * AI Visibility — "What do AI assistants say about me?" A dashboard (no
 * visible page header; the breadcrumb names it): the score hero first, the
 * four numbers behind it, the breakdowns, then every raw answer — then how
 * it's moved over time and every past run.
 *
 * `useAiRun` polls the latest run while it's in flight; past runs are
 * terminal, so their row from the history list is exactly as fresh.
 */
export function AiVisibilityView() {
  const { state, starting, startError, start, reload } = useAiRun();
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  const historyDep = state.status === "ready" ? `${state.run.id}:${state.run.status}` : state.status;
  const history = useAsyncData(() => listAiRuns(), [historyDep]);
  const brandRuns = history.status === "success" ? history.data.filter((r) => r.competitorId === null) : [];

  async function handleStart() {
    setViewingRunId(null);
    await start();
  }

  const latestRun = state.status === "ready" ? state.run : null;
  const latestInFlight = latestRun !== null && (latestRun.status === "queued" || latestRun.status === "running");
  const canRerun = latestRun !== null && !latestInFlight;

  const effectiveRunId = viewingRunId ?? latestRun?.id ?? null;
  const viewingLatest = effectiveRunId === latestRun?.id;
  const displayedRun = viewingLatest ? latestRun : (brandRuns.find((r) => r.id === effectiveRunId) ?? null);

  // The completed run immediately before the one on screen — the hero's
  // "change since" line compares two real stored scores, never a synthesized delta.
  const series = completedSeries(brandRuns);
  const displayedIndex = displayedRun ? series.findIndex((s) => s.run.id === displayedRun.id) : -1;
  const prev = displayedIndex > 0 ? series[displayedIndex - 1] : displayedIndex === -1 ? series[series.length - 1] : undefined;
  const previous: PreviousScore | null = prev && prev.run.id !== displayedRun?.id ? { score: prev.v, completedAt: prev.run.completedAt! } : null;

  const startErrorInfo = state.status === "ready" ? describeStartError(startError) : null;

  const heroActions = (
    <>
      {!viewingLatest && (
        <Button variant="ghost" size="sm" onClick={() => setViewingRunId(null)}>
          <ArrowLeft size={14} aria-hidden="true" /> Latest run
        </Button>
      )}
      {canRerun && viewingLatest && (
        <Button variant="outline" size="sm" loading={starting} onClick={handleStart}>
          <RefreshCw size={14} aria-hidden="true" /> Run again
        </Button>
      )}
    </>
  );

  return (
    <>
      <h1 className="sr-only">AI Visibility</h1>

      {state.status === "loading" && (
        <PageStack>
          <Reveal>
            <ScoreHeroSkeleton />
          </Reveal>
          <StatGrid>
            {["Mention rate", "Recommended", "Sources cited", "Answers"].map((label) => (
              <StatTile key={label} label={label} value="—" loading />
            ))}
          </StatGrid>
        </PageStack>
      )}

      {state.status === "error" && <ErrorPanel title="AI Visibility didn't load" message={state.error.message} onRetry={reload} />}

      {state.status === "empty" && <AiRunEmptyState starting={starting} startError={startError} onStart={handleStart} />}

      {state.status === "ready" && (
        <PageStack>
          {startErrorInfo && (
            <Reveal>
              <StartErrorAlert {...startErrorInfo} />
            </Reveal>
          )}

          {latestRun && latestInFlight && viewingLatest && <AiRunProgressPanel run={latestRun} />}

          {latestRun && latestRun.status === "failed" && viewingLatest && (
            <Reveal>
              <AiRunFailedPanel run={latestRun} retrying={starting} onRetry={handleStart} />
            </Reveal>
          )}

          {!viewingLatest && displayedRun && (
            <Reveal>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5" role="status">
                <p className="text-[12.5px] text-muted-foreground">
                  Viewing the run from{" "}
                  <span className="font-medium text-foreground">{formatDateTime(displayedRun.startedAt ?? displayedRun.createdAt)}</span>, not your latest.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setViewingRunId(null)}>
                  Back to latest
                </Button>
              </div>
            </Reveal>
          )}

          {displayedRun ? (
            <AiRunDetail key={displayedRun.id} run={displayedRun} previous={previous} subject="you" heroActions={heroActions} />
          ) : (
            effectiveRunId && (
              <Reveal>
                <ErrorPanel compact title="Run not found" message="That run is no longer in your history." onRetry={() => setViewingRunId(null)} />
              </Reveal>
            )
          )}

          {history.status === "error" && (
            <Reveal>
              <ErrorPanel compact title="Run history didn't load" message={history.error.message} onRetry={history.reload} />
            </Reveal>
          )}

          {brandRuns.length > 0 && (
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
              <ScoreTrendPanel runs={brandRuns} className="lg:col-span-7" />
              <AiRunHistoryTable runs={brandRuns} viewingRunId={effectiveRunId ?? ""} onView={(id) => setViewingRunId(id)} className="lg:col-span-5" />
            </div>
          )}
        </PageStack>
      )}
    </>
  );
}
