"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { BadgeCheck, Link2, MessageSquareText, Quote } from "lucide-react";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { SectionSkeleton } from "@/components/patterns/states";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { getAiRunResponses, getAiRunScore, getAllAiRunResponses, getQuerySetQueries } from "@/data/ai-visibility/client";
import { computeCitationMap, computeProviderBreakdown } from "@/data/ai-visibility/analysis";
import type { AiRun, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import { formatNumber, formatPercent } from "@/lib/format";
import { ScoreHero, ScoreHeroSkeleton, type PreviousScore } from "./score-panel";
import { ModelBreakdownPanel } from "./model-breakdown-panel";
import { IntentBreakdownPanel } from "./intent-breakdown-panel";
import { ResponsesExplorer } from "./responses-explorer";
import { CitationPanel, SentimentPanel } from "./citation-sentiment-panel";
import { EMPTY_FILTER, type ResponseFilter } from "./response-filter";

/**
 * One `ai_runs` row as a single evidence page — score → formula → the
 * breakdowns → every raw answer, top to bottom, no tabs to hunt through.
 * One `ResponseFilter` is lifted here: selecting a formula component, a
 * model, an intent, a cited domain or a tone sets it and scrolls to the
 * Responses list, which is the same filter the list's own controls edit.
 *
 * Renders for a run still in flight too: every endpoint returns partial
 * data mid-run, so evidence arrives while the user watches. Must sit
 * inside a `PageStack` (its blocks join the page's stagger).
 */
export function AiRunDetail({
  run,
  previous = null,
  subject = "you",
  heroActions,
}: {
  run: AiRun;
  /** The completed run before this one, for the hero's change line. */
  previous?: PreviousScore | null;
  /** "you" for the brand, or a competitor's name. */
  subject?: string;
  heroActions?: ReactNode;
}) {
  const [filter, setFilter] = useState<ResponseFilter>(EMPTY_FILTER);
  const reduceMotion = useReducedMotion();
  const responsesAnchor = `responses-${run.id}`;

  // Re-fetched whenever the run's progress advances — `run` is the
  // live-polled object, so this stays fresh without its own poll loop.
  const progressKey = `${run.status}:${run.completedJobs}:${run.failedJobs}`;

  const scoreState = useAsyncData(() => getAiRunScore(run.id), [run.id, progressKey]);
  const responsesState = useAsyncData(() => getAllAiRunResponses(run.id), [run.id, progressKey]);
  // Only for the total while the full fetch is in flight — avoids a "0" flash.
  const quickCount = useAsyncData(() => getAiRunResponses(run.id, { limit: 1 }), [run.id, progressKey]);
  const queriesState = useAsyncData(() => getQuerySetQueries(run.querySetId), [run.querySetId]);

  const queryMeta = useMemo(() => {
    const map = new Map<string, AiVisibilityQueryMeta>();
    if (queriesState.status === "success") for (const q of queriesState.data) map.set(q.id, q);
    return map;
  }, [queriesState]);

  const responses = useMemo(() => (responsesState.status === "success" ? responsesState.data.items : []), [responsesState]);
  const total =
    responsesState.status === "success" ? responsesState.data.total : quickCount.status === "success" ? quickCount.data.total : 0;
  const truncated = responsesState.status === "success" && responsesState.data.truncated;
  const responsesReady = responsesState.status === "success";

  const providerStats = useMemo(() => computeProviderBreakdown(responses, run.providers), [responses, run.providers]);
  const sourcesCited = useMemo(() => computeCitationMap(responses).length, [responses]);
  const totals = providerStats.reduce(
    (acc, s) => ({ answers: acc.answers + s.totalJobs, mentioned: acc.mentioned + s.mentioned, recommended: acc.recommended + s.recommended }),
    { answers: 0, mentioned: 0, recommended: 0 },
  );
  const rate = (n: number) => (totals.answers > 0 ? formatPercent((n / totals.answers) * 100) : "—");
  const youOrThem = subject === "you" ? "you" : subject;

  function drillTo(next: ResponseFilter) {
    setFilter(next);
    requestAnimationFrame(() => {
      document.getElementById(responsesAnchor)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  }

  return (
    <>
      {scoreState.status === "loading" && <ScoreHeroSkeleton />}
      {scoreState.status === "error" && <ErrorPanel title="Score didn't load" message={scoreState.error.message} onRetry={scoreState.reload} />}
      {scoreState.status === "success" && (
        <ScoreHero
          run={run}
          score={scoreState.data}
          previous={previous}
          responseCount={total}
          subject={youOrThem}
          actions={heroActions}
          onDrill={drillTo}
        />
      )}

      <StatGrid>
        <StatTile
          label="Mention rate"
          icon={<Quote size={13} />}
          loading={!responsesReady}
          value={rate(totals.mentioned)}
          muted={totals.answers === 0}
          hint={totals.answers > 0 ? `${formatNumber(totals.mentioned)} of ${formatNumber(totals.answers)} answers name ${youOrThem}` : "No answers yet"}
        />
        <StatTile
          label="Recommended"
          icon={<BadgeCheck size={13} />}
          loading={!responsesReady}
          value={rate(totals.recommended)}
          muted={totals.answers === 0}
          hint={totals.answers > 0 ? `${formatNumber(totals.recommended)} answers recommend ${youOrThem}` : "No answers yet"}
        />
        <StatTile
          label="Sources cited"
          icon={<Link2 size={13} />}
          loading={!responsesReady}
          value={formatNumber(sourcesCited)}
          hint="Distinct domains in the answers"
        />
        <StatTile
          label="Answers"
          icon={<MessageSquareText size={13} />}
          loading={!responsesReady && quickCount.status !== "success"}
          value={formatNumber(total)}
          hint={run.status === "completed" || run.status === "failed" ? `${run.providers.length} models × your query set` : `${formatNumber(run.totalJobs)} expected`}
        />
      </StatGrid>

      {responsesState.status === "error" && (
        <ErrorPanel title="Answers didn't load" message={responsesState.error.message} onRetry={responsesState.reload} />
      )}

      {responsesState.status === "loading" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" aria-busy="true">
          <SectionSkeleton lines={5} className="lg:col-span-7" />
          <SectionSkeleton lines={5} className="lg:col-span-5" />
        </div>
      )}

      {responsesReady && (
        <>
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            <ModelBreakdownPanel stats={providerStats} onDrill={drillTo} className="lg:col-span-7" />
            <SentimentPanel responses={responses} onDrill={drillTo} className="lg:col-span-5" />
          </div>
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            <IntentBreakdownPanel
              responses={responses}
              queryMeta={queryMeta}
              queryMetaFailed={queriesState.status === "error"}
              onDrillIntent={drillTo}
              className="lg:col-span-7"
            />
            <CitationPanel responses={responses} onDrill={drillTo} className="lg:col-span-5" />
          </div>
        </>
      )}

      {responsesState.status !== "error" && (
        <ResponsesExplorer
          id={responsesAnchor}
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
    </>
  );
}
