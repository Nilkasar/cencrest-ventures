"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bebest/ui";
import { useAsyncData } from "@/lib/use-async-data";
import { getAiRunResponses, getAiRunScore, getAllAiRunResponses, getQuerySetQueries } from "@/data/ai-visibility/client";
import type { AiRun, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { ScorePanel, ScorePanelSkeleton } from "./score-panel";
import { IntentBreakdownPanel } from "./intent-breakdown-panel";
import { ResponsesExplorer } from "./responses-explorer";
import { CitationSentimentPanel } from "./citation-sentiment-panel";
import { EMPTY_FILTER, type ResponseFilter } from "./response-filter";

type Tab = "score" | "intent" | "responses" | "citations";

/**
 * One `ai_runs` row's full detail — the tabbed surface that implements the
 * epic's five UI-surface requirements (score + model breakdown, score by
 * intent, raw response explorer, citation source map, sentiment analysis)
 * as one connected drill-down instead of five independent widgets: a
 * single `ResponseFilter` (`response-filter.ts`) is lifted here and handed
 * to every tab, so clicking a formula component, a model row, an intent
 * row, a cited domain, or a sentiment bucket all do the same thing —
 * narrow the Responses tab to the exact observations behind that number —
 * and clicking a row there opens the exact raw AI response text. That's
 * the epic's non-negotiable "number -> formula -> observation -> raw
 * response" chain, wired end to end.
 *
 * Deliberately renders for a run that's still `queued`/`running`, not just
 * `completed` — every endpoint here returns 200 with partial data mid-run
 * (`GET .../score` returns `computed: false`, `GET .../responses` returns
 * whatever jobs have finished so far), so a user can watch evidence arrive
 * during the documented 30–60 minute run instead of staring at a spinner
 * until the very end.
 */
export function AiRunDetail({ run }: { run: AiRun }) {
  const [tab, setTab] = useState<Tab>("score");
  const [filter, setFilter] = useState<ResponseFilter>(EMPTY_FILTER);

  // Re-fetched whenever the run's own progress advances (status flips, or
  // completed/failed job counts tick up) — `run` is the live-polled object
  // from `useAiRun`/`AiRunHistoryTable`, so this stays fresh without its
  // own poll loop.
  const progressKey = `${run.status}:${run.completedJobs}:${run.failedJobs}`;

  const scoreState = useAsyncData(() => getAiRunScore(run.id), [run.id, progressKey]);
  const responsesState = useAsyncData(() => getAllAiRunResponses(run.id), [run.id, progressKey]);
  // Only used for the explorer's total count when the aggregate fetch above
  // hasn't finished yet — avoids a "0 responses" flash while it loads.
  const quickCount = useAsyncData(() => getAiRunResponses(run.id, { limit: 1 }), [run.id, progressKey]);

  const queriesState = useAsyncData(() => getQuerySetQueries(run.querySetId), [run.querySetId]);

  const queryMeta = useMemo(() => {
    const map = new Map<string, AiVisibilityQueryMeta>();
    if (queriesState.status === "success") for (const q of queriesState.data) map.set(q.id, q);
    return map;
  }, [queriesState]);

  function drillTo(next: ResponseFilter) {
    setFilter(next);
    setTab("responses");
  }

  const responses = responsesState.status === "success" ? responsesState.data.items : [];
  const total =
    responsesState.status === "success" ? responsesState.data.total : quickCount.status === "success" ? quickCount.data.total : 0;
  const truncated = responsesState.status === "success" && responsesState.data.truncated;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList>
        <TabsTrigger value="score">Score</TabsTrigger>
        <TabsTrigger value="intent">By intent</TabsTrigger>
        <TabsTrigger value="responses">Responses{total > 0 ? ` (${total})` : ""}</TabsTrigger>
        <TabsTrigger value="citations">Citations &amp; sentiment</TabsTrigger>
      </TabsList>

      <TabsContent value="score">
        {scoreState.status === "loading" && <ScorePanelSkeleton />}
        {scoreState.status === "error" && <ErrorPanel message={scoreState.error.message} onRetry={scoreState.reload} />}
        {scoreState.status === "success" && (
          <ScorePanel run={run} score={scoreState.data} responses={responses} onDrill={drillTo} />
        )}
      </TabsContent>

      <TabsContent value="intent">
        <IntentBreakdownPanel
          responses={responses}
          queryMeta={queryMeta}
          loading={responsesState.status === "loading" || queriesState.status === "loading"}
          onDrillIntent={drillTo}
        />
      </TabsContent>

      <TabsContent value="responses">
        {responsesState.status === "error" ? (
          <ErrorPanel message={responsesState.error.message} onRetry={responsesState.reload} />
        ) : (
          <ResponsesExplorer
            responses={responses}
            total={total}
            truncated={truncated}
            loading={responsesState.status === "loading"}
            queryMeta={queryMeta}
            providers={run.providers}
            filter={filter}
            onFilterChange={setFilter}
          />
        )}
      </TabsContent>

      <TabsContent value="citations">
        <CitationSentimentPanel responses={responses} loading={responsesState.status === "loading"} onDrill={drillTo} />
      </TabsContent>
    </Tabs>
  );
}
