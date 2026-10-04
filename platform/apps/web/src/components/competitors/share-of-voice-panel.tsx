"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { PieChart, Trophy } from "lucide-react";
import { Button, EmptyState, cn, easings } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { SectionSkeleton } from "@/components/patterns/states";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { SrTable } from "@/components/overview/primitives";
import type { AsyncState } from "@/lib/use-async-data";
import type { CompetitiveGapsResponse, ShareOfVoiceResponse } from "@/data/competitive-intelligence/types";
import { formatNumber, formatPercent } from "@/lib/format";

type Loadable<T> = AsyncState<T> & { reload: () => void };

interface BarRow {
  id: string;
  name: string;
  value: number;
  isYou: boolean;
  label: string;
  meta?: string;
}

/** Horizontal bars, you in accent, everyone else neutral — emphasis, not a
 *  rainbow. Values are pre-ranked by the caller. */
function RankedBars({ rows, max, ariaLabel }: { rows: BarRow[]; max: number; ariaLabel: string }) {
  return (
    <ol className="flex flex-col gap-2.5" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <li key={r.id} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] items-center gap-3">
          <span className={cn("truncate text-[12.5px]", r.isYou ? "font-semibold text-foreground" : "text-muted-foreground")} title={r.name}>
            <span className="mr-1.5 font-mono text-[11px] tabular-nums text-subtle-foreground">{i + 1}</span>
            {r.name}
          </span>
          <span className="relative h-2.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <motion.span
              className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full", r.isYou ? "bg-accent" : "bg-border-strong")}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: max > 0 ? r.value / max : 0 }}
              transition={{ duration: 0.9, delay: 0.15 + i * 0.06, ease: easings.emphasized }}
            />
          </span>
          <span className={cn("text-right font-mono text-[12.5px] tabular-nums", r.isYou ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {r.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Where do I rank?" — your AVS against every competitor's latest run on
 * the SAME active query set (the server scopes it, so bars are
 * like-for-like). A competitor without a comparable run is listed as not
 * measured, never drawn as zero.
 */
export function RankingPanel({ state, className }: { state: Loadable<CompetitiveGapsResponse | null>; className?: string }) {
  return (
    <Section title="Where you rank" description="AI Visibility Score on your active query set." icon={<Trophy size={14} />} className={className}>
      {state.status === "loading" && <SectionBodySkeleton />}
      {state.status === "error" && <ErrorPanel compact title="Ranking didn't load" message={state.error.message} onRetry={state.reload} />}
      {state.status === "success" && <RankingBody data={state.data} />}
    </Section>
  );
}

function RankingBody({ data }: { data: CompetitiveGapsResponse | null }) {
  if (!data) return <NoQuerySet />;
  const you = data.brandRun?.aiVisibilityScore ?? null;
  if (!data.computed || you === null) {
    return (
      <EmptyState
        compact
        icon={<Trophy size={18} />}
        title="Waiting on your baseline"
        description="Rankings compare against your own completed run on the current query set."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/ai-visibility">Go to AI Visibility</Link>
          </Button>
        }
      />
    );
  }
  const measured = data.competitors.filter((c) => c.run?.aiVisibilityScore != null);
  const unmeasured = data.competitors.filter((c) => c.run?.aiVisibilityScore == null);
  const rows: BarRow[] = [
    { id: "you", name: "You", value: you, isYou: true, label: you.toFixed(1) },
    ...measured.map((c) => ({ id: c.competitorId, name: c.competitorName, value: c.run!.aiVisibilityScore!, isYou: false, label: c.run!.aiVisibilityScore!.toFixed(1) })),
  ].sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col gap-3">
      <RankedBars rows={rows} max={100} ariaLabel="AI Visibility Score ranking" />
      {unmeasured.length > 0 && (
        <p className="text-[12px] text-muted-foreground">Not measured on this query set yet: {unmeasured.map((c) => c.competitorName).join(", ")}.</p>
      )}
      <SrTable caption="AI Visibility Score ranking" head={["Brand", "Score"]} rows={rows.map((r) => [r.name, r.label])} />
    </div>
  );
}

/**
 * Share of AI Voice = your mentions / (yours + every tracked competitor's)
 * on the active query set. Ranked bars with exact counts beside them.
 */
export function ShareOfVoicePanel({ state, className }: { state: Loadable<ShareOfVoiceResponse | null>; className?: string }) {
  return (
    <Section title="Share of AI voice" description="Of every brand mention in AI answers, how much is you." icon={<PieChart size={14} />} className={className}>
      {state.status === "loading" && <SectionBodySkeleton />}
      {state.status === "error" && <ErrorPanel compact title="Share of voice didn't load" message={state.error.message} onRetry={state.reload} />}
      {state.status === "success" && <ShareBody data={state.data} />}
    </Section>
  );
}

function ShareBody({ data }: { data: ShareOfVoiceResponse | null }) {
  if (!data) return <NoQuerySet />;
  if (data.totalMentions === 0) {
    return (
      <EmptyState
        compact
        icon={<PieChart size={18} />}
        title="No mentions yet"
        description="Share of voice needs real mentions — run your baseline and at least one competitor on this query set."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/ai-visibility">Go to AI Visibility</Link>
          </Button>
        }
      />
    );
  }
  const rows: BarRow[] = [
    { id: "you", name: "You", value: data.yourSharePct, isYou: true, label: formatPercent(data.yourSharePct), meta: `${data.yourMentions}` },
    ...data.competitors.map((c) => ({
      id: c.competitorId,
      name: c.competitorName,
      value: c.sharePct,
      isYou: false,
      label: formatPercent(c.sharePct),
      meta: `${c.mentions}`,
    })),
  ].sort((a, b) => b.value - a.value);
  const untracked = data.competitors.filter((c) => !c.tracked);

  return (
    <div className="flex flex-col gap-3">
      <RankedBars rows={rows} max={Math.max(...rows.map((r) => r.value), 1)} ariaLabel="Share of AI voice" />
      <p className="text-[12px] text-muted-foreground">
        {formatNumber(data.totalMentions)} mentions in total
        {untracked.length > 0 ? ` · not yet run on this query set: ${untracked.map((c) => c.competitorName).join(", ")}` : ""}.
      </p>
      <SrTable caption="Share of AI voice" head={["Brand", "Share", "Mentions"]} rows={rows.map((r) => [r.name, r.label, r.meta ?? "—"])} />
    </div>
  );
}

function NoQuerySet() {
  return (
    <EmptyState
      compact
      icon={<PieChart size={18} />}
      title="No active query set"
      description="Comparisons run on your active query set. Activate one in Query Universe to start."
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/query-universe">Open Query Universe</Link>
        </Button>
      }
    />
  );
}

function SectionBodySkeleton() {
  return <SectionSkeleton lines={4} className="border-0 p-0 shadow-none" />;
}
