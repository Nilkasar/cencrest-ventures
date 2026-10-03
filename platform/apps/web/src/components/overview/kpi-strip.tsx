"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, Gauge, ListChecks, PieChart, Target } from "lucide-react";
import { Card, Skeleton, cn, easings } from "@bebest/ui";
import { useAsyncData, type AsyncState } from "@/lib/use-async-data";
import { getShareOfVoice } from "@/data/competitive-intelligence/client";
import type { ActionsOverview } from "@/data/actions/types";
import type { MeasurementsListResponse } from "@/data/measurement/types";
import type { OpportunityStatus } from "@/data/opportunities/types";
import { AnimatedNumber, SrTable, panelVariants } from "./primitives";

/**
 * Four one-glance numbers under the hero, each answering a different
 * journey question and each a link into the screen that owns it:
 *
 *   Share of voice     -> "How loud am I vs. competitors?"  (/competitors)
 *   Open opportunities -> "Is there work to do?"            (/opportunities)
 *   Awaiting approval  -> "Is anything blocked on me?"      (/actions)
 *   Measured lift      -> "Did what we shipped work?"       (/actions)
 *
 * Each tile has a small inline visual of real composition (who holds the
 * mentions, which statuses make up the count, how each measured action
 * moved the score) — never a decorative sparkline over invented history.
 */

type Loadable<T> = AsyncState<T> & { reload: () => void };

export function KpiStrip({
  oppCounts,
  actions,
  measurements,
}: {
  oppCounts: Loadable<Record<OpportunityStatus, number>>;
  actions: Loadable<ActionsOverview>;
  measurements: Loadable<MeasurementsListResponse>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 @4xl:grid-cols-4 gap-4">
      <ShareOfVoiceTile />
      <OpportunitiesKpi state={oppCounts} />
      <ApprovalsKpi state={actions} />
      <LiftKpi state={measurements} />
    </div>
  );
}

function KpiTile({ href, eyebrow, icon, children }: { href: string; eyebrow: string; icon: ReactNode; children: ReactNode }) {
  return (
    <motion.div variants={panelVariants} className="min-w-0">
      <Link
        href={href}
        className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Card className="relative h-full min-h-[156px] p-4 flex flex-col gap-2 overflow-hidden transition-[border-color,box-shadow,transform] duration-200 ease-out group-hover:border-accent group-hover:shadow-md group-hover:-translate-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground group-hover:bg-accent-muted group-hover:text-accent transition-colors" aria-hidden="true">
                {icon}
              </span>
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-subtle-foreground truncate">{eyebrow}</p>
            </div>
            <ChevronRight size={14} className="text-subtle-foreground group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
          </div>
          <div className="flex-1 flex flex-col justify-end gap-2">{children}</div>
        </Card>
      </Link>
    </motion.div>
  );
}

function TileSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-2 w-full" />
    </>
  );
}

function TileError() {
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-danger">
      <AlertTriangle size={13} aria-hidden="true" />
      Couldn’t load — open to view
    </p>
  );
}

function Big({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <p className={cn("text-[30px] font-semibold leading-none tracking-[-0.02em]", muted ? "text-subtle-foreground" : "text-foreground")}>{children}</p>;
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-muted-foreground leading-snug">{children}</p>;
}

/** Segmented composition bar — 2px surface gaps between segments, grows
 *  from the left once. Labels live in the caption/sr text, not on the bar. */
function SegmentBar({ segments, label }: { segments: { value: number; className: string; key: string }[]; label: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <motion.div
      role="img"
      aria-label={label}
      className="flex h-2 w-full gap-[2px] origin-left"
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.9, delay: 0.3, ease: easings.emphasized }}
    >
      {total === 0 ? (
        <span className="h-full w-full rounded-full bg-surface" />
      ) : (
        segments
          .filter((s) => s.value > 0)
          .map((s) => <span key={s.key} className={cn("h-full rounded-full", s.className)} style={{ flexGrow: s.value, flexBasis: 0, minWidth: 4 }} />)
      )}
    </motion.div>
  );
}

function ShareOfVoiceTile() {
  const state = useAsyncData(() => getShareOfVoice(), []);
  return (
    <KpiTile href="/competitors" eyebrow="Share of voice" icon={<PieChart size={13} />}>
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "error" && <TileError />}
      {state.status === "success" &&
        (!state.data || state.data.totalMentions === 0 ? (
          <>
            <Big muted>—</Big>
            <Caption>No AI mentions counted yet. Run your baseline and measure competitors to split the conversation.</Caption>
          </>
        ) : (
          <>
            <Big>
              <AnimatedNumber value={state.data.yourSharePct} format={(v) => `${v.toFixed(0)}%`} />
            </Big>
            <Caption>
              of {state.data.totalMentions.toLocaleString("en-US")} brand mentions vs {state.data.competitors.length} competitor
              {state.data.competitors.length === 1 ? "" : "s"}
            </Caption>
            <SegmentBar
              label={`You hold ${state.data.yourSharePct}% of mentions; ${state.data.competitors.map((c) => `${c.competitorName} ${c.sharePct}%`).join(", ")}.`}
              segments={[
                { key: "you", value: state.data.yourMentions, className: "bg-accent" },
                ...[...state.data.competitors]
                  .sort((a, b) => b.mentions - a.mentions)
                  .map((c, i) => ({ key: c.competitorId, value: c.mentions, className: i % 2 === 0 ? "bg-border-strong" : "bg-border" })),
              ]}
            />
          </>
        ))}
    </KpiTile>
  );
}

function OpportunitiesKpi({ state }: { state: Loadable<Record<OpportunityStatus, number>> }) {
  return (
    <KpiTile href="/opportunities" eyebrow="Open opportunities" icon={<Target size={13} />}>
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "error" && <TileError />}
      {state.status === "success" &&
        (() => {
          const { new: fresh, in_progress: doing, completed } = state.data;
          const open = fresh + doing;
          return open === 0 && completed === 0 ? (
            <>
              <Big muted>0</Big>
              <Caption>We’re still analyzing your brand — recompute once your baseline lands, or add competitors to surface gaps.</Caption>
            </>
          ) : (
            <>
              <Big>
                <AnimatedNumber value={open} />
              </Big>
              <Caption>
                {fresh} new · {doing} in progress · {completed} done
              </Caption>
              <SegmentBar
                label={`${fresh} new, ${doing} in progress, ${completed} completed opportunities.`}
                segments={[
                  { key: "new", value: fresh, className: "bg-accent" },
                  { key: "doing", value: doing, className: "bg-info" },
                  { key: "done", value: completed, className: "bg-border-strong" },
                ]}
              />
            </>
          );
        })()}
    </KpiTile>
  );
}

function ApprovalsKpi({ state }: { state: Loadable<ActionsOverview> }) {
  return (
    <KpiTile href="/actions" eyebrow="Awaiting approval" icon={<ListChecks size={13} />}>
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "error" && <TileError />}
      {state.status === "success" &&
        (() => {
          const { pending, inProgress, completed, rolledBack } = state.data;
          const total = pending.length + inProgress.length + completed.length + rolledBack.length;
          return total === 0 ? (
            <>
              <Big muted>0</Big>
              <Caption>Nothing to approve. Actions arrive here from approved content drafts and agent proposals.</Caption>
            </>
          ) : (
            <>
              <Big>
                <AnimatedNumber value={pending.length} />
              </Big>
              <Caption>
                {inProgress.length} ready to ship · {completed.length} shipped
                {rolledBack.length > 0 ? ` · ${rolledBack.length} rolled back` : ""}
              </Caption>
              <SegmentBar
                label={`${pending.length} pending, ${inProgress.length} approved, ${completed.length} completed, ${rolledBack.length} rolled back actions.`}
                segments={[
                  { key: "pending", value: pending.length, className: "bg-warning" },
                  { key: "approved", value: inProgress.length, className: "bg-info" },
                  { key: "completed", value: completed.length, className: "bg-success" },
                  { key: "rolled", value: rolledBack.length, className: "bg-border-strong" },
                ]}
              />
            </>
          );
        })()}
    </KpiTile>
  );
}

function LiftKpi({ state }: { state: Loadable<MeasurementsListResponse> }) {
  return (
    <KpiTile href="/actions" eyebrow="Measured lift" icon={<Gauge size={13} />}>
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "error" && <TileError />}
      {state.status === "success" &&
        (() => {
          const withDelta = state.data.items.filter((m) => m.scoreDelta !== null);
          if (withDelta.length === 0) {
            return (
              <>
                <Big muted>—</Big>
                <Caption>No measured actions yet. Once a shipped action is re-measured, its before/after lands here.</Caption>
              </>
            );
          }
          const latest = withDelta[0]!;
          const d = latest.scoreDelta!;
          const chrono = [...withDelta].reverse();
          const maxAbs = Math.max(...chrono.map((m) => Math.abs(m.scoreDelta!)), 0.1);
          return (
            <>
              <Big>
                <span className={d > 0 ? "text-success" : d < 0 ? "text-danger" : undefined}>
                  <AnimatedNumber value={d} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`} />
                </span>
                <span className="ml-1 text-[13px] font-normal text-subtle-foreground tracking-normal">pts</span>
              </Big>
              <Caption>
                latest of {state.data.total} measured action{state.data.total === 1 ? "" : "s"} · {latest.attributionConfidence} confidence
              </Caption>
              {/* Diverging mini-bars around a zero line, oldest -> newest. */}
              <div className="relative flex h-7 items-center gap-[3px]" role="img" aria-label={`Score change per measured action, oldest to newest: ${chrono.map((m) => m.scoreDelta!.toFixed(1)).join(", ")}.`}>
                <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
                {chrono.map((m, i) => {
                  const v = m.scoreDelta!;
                  const h = Math.max((Math.abs(v) / maxAbs) * 13, 1.5);
                  return (
                    <motion.span
                      key={m.id}
                      className={cn("relative w-[6px] rounded-full", v >= 0 ? "bg-success self-end mb-[14px]" : "bg-danger self-start mt-[14px]")}
                      style={{ height: h, originY: v >= 0 ? 1 : 0 }}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.5, delay: 0.3 + i * 0.05, ease: easings.emphasized }}
                    />
                  );
                })}
              </div>
              <SrTable caption="Measured score change by action" head={["Measured", "Change"]} rows={chrono.map((m) => [new Date(m.measuredAt).toLocaleDateString("en-US"), m.scoreDelta!.toFixed(1)])} />
            </>
          );
        })()}
    </KpiTile>
  );
}
