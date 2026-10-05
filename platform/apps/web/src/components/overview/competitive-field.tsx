"use client";

import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { Badge, cn, easings } from "@bebest/ui";
import { useAsyncData } from "@/lib/use-async-data";
import { getCompetitiveGaps } from "@/data/competitive-intelligence/client";
import { Panel, PanelEmpty, PanelError, PanelSkeleton, SrTable } from "./primitives";

/**
 * "How do I compare?" — your AI Visibility Score ranked against every
 * tracked competitor's latest completed run on the SAME active query set
 * (`GET /brands/me/competitive-gaps`, Epic 8 — the server already scopes
 * every run to the current query set, so these bars are like-for-like).
 *
 * Emphasis, not a rainbow: your bar is the one accent mark, competitors are
 * neutral. A competitor without a comparable run is listed as "not measured
 * yet" instead of being drawn as a zero.
 */
export function CompetitiveField({ className }: { className?: string }) {
  const state = useAsyncData(() => getCompetitiveGaps(), []);
  return (
    <Panel eyebrow="Competitors" title="Where you rank" icon={<Users size={14} />} href="/competitors" hrefLabel="Compare" className={className}>
      {state.status === "loading" && <PanelSkeleton height={250} />}
      {state.status === "error" && <PanelError onRetry={state.reload} height={250} />}
      {state.status === "success" && <Body data={state.data} />}
    </Panel>
  );
}

function Body({ data }: { data: Awaited<ReturnType<typeof getCompetitiveGaps>> }) {
  if (!data) {
    return (
      <PanelEmpty
        icon={<Users size={16} />}
        height={250}
        title="No active query set"
        body="Competitor comparisons run on your active query set. Generate or activate one to start."
        action={{ href: "/query-universe", label: "Open Query Universe" }}
      />
    );
  }
  if (data.competitors.length === 0) {
    return (
      <PanelEmpty
        icon={<Users size={16} />}
        height={250}
        title="No competitors tracked"
        body="Add the brands you lose deals to, then measure them on the same questions AI is asked about you."
        action={{ href: "/competitors", label: "Add competitors" }}
      />
    );
  }
  if (!data.computed || !data.brandRun || data.brandRun.aiVisibilityScore === null) {
    return (
      <PanelEmpty
        icon={<Users size={16} />}
        height={250}
        title="Waiting on your baseline"
        body="Rankings appear once your own run completes on the current query set."
        action={{ href: "/ai-visibility", label: "Go to AI Visibility" }}
      />
    );
  }

  const you = data.brandRun.aiVisibilityScore;
  const measured = data.competitors
    .filter((c) => c.run?.aiVisibilityScore != null)
    .map((c) => ({ id: c.competitorId, name: c.competitorName, score: c.run!.aiVisibilityScore!, gap: c.competitiveGap }));
  const unmeasured = data.competitors.filter((c) => c.run?.aiVisibilityScore == null);
  const rows = [{ id: "you", name: "You", score: you, gap: null as number | null }, ...measured].sort((a, b) => b.score - a.score);
  const rank = rows.findIndex((r) => r.id === "you") + 1;
  const max = Math.max(100, ...rows.map((r) => r.score));
  const highGaps = data.gaps.filter((g) => g.severity === "high").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          You rank <span className="font-display text-[26px] font-semibold text-foreground leading-none">#{rank}</span> of {rows.length} measured
        </p>
        {highGaps > 0 && (
          <Badge variant="warning" size="sm">
            {highGaps} high-severity gap{highGaps === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      <ol className="flex flex-col gap-2.5" aria-label="AI Visibility Score ranking">
        {rows.map((r, i) => {
          const isYou = r.id === "you";
          return (
            <li key={r.id} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3rem] items-center gap-3">
              <span className={cn("text-[12.5px] truncate", isYou ? "font-semibold text-foreground" : "text-muted-foreground")}>{r.name}</span>
              <span className="relative h-2.5 rounded-full bg-surface overflow-hidden">
                <motion.span
                  className={cn("absolute inset-y-0 left-0 w-full rounded-full origin-left", isYou ? "bg-accent" : "bg-border-strong")}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: r.score / max }}
                  transition={{ duration: 1, delay: 0.15 + i * 0.07, ease: easings.emphasized }}
                />
              </span>
              <span className={cn("font-mono text-[12px] text-right", isYou ? "text-foreground font-semibold" : "text-muted-foreground")} style={{ fontVariantNumeric: "tabular-nums" }}>
                {r.score.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ol>

      {unmeasured.length > 0 && (
        <p className="text-[11.5px] text-subtle-foreground leading-relaxed">
          Not measured yet on this query set: {unmeasured.map((c) => c.competitorName).join(", ")}.
        </p>
      )}

      <SrTable
        caption="AI Visibility Score, you versus competitors"
        head={["Brand", "Score", "Gap versus you"]}
        rows={rows.map((r) => [r.name, r.score.toFixed(1), r.id === "you" ? "—" : r.gap === null ? "n/a" : `${r.gap > 0 ? "+" : ""}${r.gap.toFixed(1)}`])}
      />
    </div>
  );
}
