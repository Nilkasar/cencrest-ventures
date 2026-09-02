"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAiRun } from "@/hooks/use-ai-run";
import { useAsyncData } from "@/lib/use-async-data";
import { listAiRuns } from "@/data/ai-visibility/client";
import { AiRunEmptyState } from "./ai-run-empty-state";
import { AiRunProgressPanel } from "./ai-run-progress-panel";
import { AiRunFailedPanel } from "./ai-run-failed-panel";
import { AiRunHistoryTable } from "./ai-run-history";
import { AiRunDetail } from "./ai-run-detail";

function OverviewSkeleton() {
  return (
    <Card>
      <CardContent className="p-6 flex flex-col gap-4">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-48" />
        <div className="flex flex-col gap-3 mt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Epic 7 — AI Visibility Engine. Calls `platform/apps/api`'s real routes
 * from the first line via `data/ai-visibility/client.ts` (no fixture
 * layer, per the standing rule) — `useAiRun` polls the latest run exactly
 * like `useCrawlJob` (Epic 3) polls a crawl, and `AiRunDetail` renders the
 * full drill-down surface (score -> formula -> observation -> raw
 * response) the epic's UI-surface requirement demands.
 */
export function AiVisibilityView() {
  const { state, starting, startError, start, reload } = useAiRun();
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  const historyDep = state.status === "ready" ? state.run.status : state.status;
  const history = useAsyncData(() => listAiRuns(), [historyDep]);

  async function handleStart() {
    setViewingRunId(null);
    await start();
  }

  const latestRun = state.status === "ready" ? state.run : null;
  const latestInFlight = latestRun !== null && (latestRun.status === "queued" || latestRun.status === "running");
  const canRerun = latestRun !== null && !latestInFlight;

  const effectiveRunId = viewingRunId ?? latestRun?.id ?? null;
  const viewingLatest = effectiveRunId === latestRun?.id;
  // While viewing the latest run, use the live-polled object (so the
  // detail tabs re-fetch as job counts tick up); a past run is terminal,
  // so the static row from the history list is exactly as fresh.
  const displayedRun = viewingLatest ? latestRun : (history.status === "success" ? history.data.find((r) => r.id === effectiveRunId) : undefined) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="AI Visibility"
        description="What do AI assistants say about you? Your AI Visibility Score, broken down by model and by intent, every raw response, and where each model's answer is sourced from."
        actions={
          canRerun ? (
            <Button variant="outline" size="sm" loading={starting} onClick={handleStart}>
              <RefreshCw size={14} /> Run again
            </Button>
          ) : undefined
        }
      />

      {state.status === "loading" && <OverviewSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "empty" && <AiRunEmptyState starting={starting} startError={startError} onStart={handleStart} />}

      {state.status === "ready" && (
        <div className="flex flex-col gap-6">
          {latestRun && (latestRun.status === "queued" || latestRun.status === "running") && viewingLatest && (
            <AiRunProgressPanel run={latestRun} />
          )}

          {latestRun && latestRun.status === "failed" && viewingLatest && (
            <AiRunFailedPanel run={latestRun} retrying={starting} onRetry={handleStart} />
          )}

          {!viewingLatest && effectiveRunId && (
            <p className="text-[12.5px] text-muted-foreground">
              Viewing a previous run.{" "}
              <button
                type="button"
                className="text-accent underline-offset-4 hover:underline"
                onClick={() => setViewingRunId(null)}
              >
                Back to latest
              </button>
            </p>
          )}

          {displayedRun ? (
            <AiRunDetail run={displayedRun} />
          ) : (
            effectiveRunId && <ErrorPanel message="Couldn't find that run." onRetry={() => setViewingRunId(null)} compact />
          )}

          {history.status === "success" && history.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Run history</CardTitle>
              </CardHeader>
              <CardContent>
                <AiRunHistoryTable runs={history.data} viewingRunId={effectiveRunId ?? ""} onView={(id) => setViewingRunId(id)} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
