"use client";

import { AlertTriangle, Loader2, Minus, Radar, TrendingDown, TrendingUp } from "lucide-react";
import { useAsyncData } from "@/lib/use-async-data";
import { listAiRuns } from "@/data/ai-visibility/client";
import type { AiRun } from "@/data/ai-visibility/types";
import { StatTile, StatTileSkeleton } from "./stat-tile";

/**
 * "How am I doing?" tile #1 — the AI Visibility Score, with trend, exactly
 * as `docs/09-ux/CUSTOMER_JOURNEY.md`'s Overview Dashboard spec names it.
 * Reuses `listAiRuns()` (`data/ai-visibility/client.ts`) — the same real,
 * tested `GET /brands/me/ai-runs` the `/ai-visibility` screen's own
 * `AiVisibilityView`/`useAiRun` hook calls — no parallel fetch logic and no
 * new backend concept. `AiRun.aiVisibilityScore` is read directly off each
 * run row (already resolved server-side); this tile never recomputes a
 * score, only picks which run's number to show and diffs two of them for
 * the trend arrow.
 *
 * Trend is a genuine before/after: `listAiRuns()` returns newest first, so
 * the two most recent COMPLETED runs (skipping any queued/running/failed
 * attempts in between) are the real prior baseline vs. current comparison
 * — never a synthesized delta.
 */
export function AiVisibilityTile() {
  const state = useAsyncData(() => listAiRuns(), []);

  if (state.status === "loading") return <StatTileSkeleton />;

  if (state.status === "error") {
    return (
      <StatTile href="/ai-visibility" eyebrow="AI Visibility" icon={<Radar size={13} />}>
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle size={16} aria-hidden="true" />
          <p className="text-[12.5px]">Couldn&rsquo;t load — tap to view</p>
        </div>
      </StatTile>
    );
  }

  const runs = state.data;

  if (runs.length === 0) {
    return (
      <StatTile href="/ai-visibility" eyebrow="AI Visibility" icon={<Radar size={13} />}>
        <p className="font-mono text-[22px] font-semibold text-muted-foreground leading-none">Not started</p>
        <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
          Run your baseline across ChatGPT, Claude, Gemini &amp; Perplexity to see this score.
        </p>
      </StatTile>
    );
  }

  const latest: AiRun = runs[0]!;
  const completed = runs.filter((r) => r.status === "completed" && r.aiVisibilityScore !== null);
  const latestCompleted = completed[0];
  const previousCompleted = completed[1];

  if (latest.status === "queued" || latest.status === "running") {
    return (
      <StatTile href="/ai-visibility" eyebrow="AI Visibility" icon={<Radar size={13} />}>
        {latestCompleted ? (
          <p className="font-mono text-[32px] font-semibold text-foreground leading-none">
            {latestCompleted.aiVisibilityScore!.toFixed(1)}
            <span className="text-[13px] text-muted-foreground font-normal">/100</span>
          </p>
        ) : (
          <p className="font-mono text-[22px] font-semibold text-muted-foreground leading-none">Running…</p>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-accent">
          <Loader2 size={12} className="animate-[spin_0.9s_linear_infinite]" aria-hidden="true" />
          Baseline in progress — {latest.progressPct}% ({latest.completedJobs + latest.failedJobs}/{latest.totalJobs} jobs)
        </p>
      </StatTile>
    );
  }

  if (latest.status === "failed") {
    return (
      <StatTile href="/ai-visibility" eyebrow="AI Visibility" icon={<Radar size={13} />}>
        {latestCompleted ? (
          <>
            <p className="font-mono text-[32px] font-semibold text-foreground leading-none">
              {latestCompleted.aiVisibilityScore!.toFixed(1)}
              <span className="text-[13px] text-muted-foreground font-normal">/100</span>
            </p>
            <p className="mt-2 text-[12px] text-danger">Latest re-run failed — tap to retry</p>
          </>
        ) : (
          <>
            <p className="font-mono text-[22px] font-semibold text-danger leading-none">Run failed</p>
            <p className="mt-2 text-[12px] text-muted-foreground">Tap to see why and retry.</p>
          </>
        )}
      </StatTile>
    );
  }

  // latest.status === "completed"
  const score = latest.aiVisibilityScore;
  if (score === null) {
    // Defensive only — `completed` + non-null score is the real invariant
    // `getAiRunScore`'s own `computed` flag documents; not expected in
    // practice, but never renders a blank tile if it happens.
    return (
      <StatTile href="/ai-visibility" eyebrow="AI Visibility" icon={<Radar size={13} />}>
        <p className="font-mono text-[22px] font-semibold text-muted-foreground leading-none">Pending</p>
      </StatTile>
    );
  }

  const trend = latestCompleted && previousCompleted ? latestCompleted.aiVisibilityScore! - previousCompleted.aiVisibilityScore! : null;
  const trendTone = trend === null || trend === 0 ? "text-muted-foreground" : trend > 0 ? "text-success" : "text-danger";
  const TrendIcon = trend === null || trend === 0 ? Minus : trend > 0 ? TrendingUp : TrendingDown;

  return (
    <StatTile href="/ai-visibility" eyebrow="AI Visibility" icon={<Radar size={13} />}>
      <p className="font-mono text-[32px] font-semibold text-foreground leading-none">
        {score.toFixed(1)}
        <span className="text-[13px] text-muted-foreground font-normal">/100</span>
      </p>
      {trend !== null ? (
        <p className={`mt-2 flex items-center gap-1.5 text-[12px] ${trendTone}`}>
          <TrendIcon size={12} aria-hidden="true" />
          {trend > 0 ? "+" : ""}
          {trend.toFixed(1)} vs. previous run
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">Run again to see a trend</p>
      )}
    </StatTile>
  );
}
