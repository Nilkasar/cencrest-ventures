"use client";

import { AlertTriangle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn, easings, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DetailHeader } from "@/components/patterns/page-header";
import { DetailLayout } from "@/components/patterns/layout";
import { PageStack } from "@/components/patterns/motion";
import { PropertyList, Section } from "@/components/patterns/section";
import { DetailSkeleton } from "@/components/patterns/states";
import { useAgentRun } from "@/hooks/use-agent-run";
import { approvePendingAction } from "@/data/agents/client";
import type { AgentEvent, AgentRunDetail } from "@/data/agents/types";
import { AGENT_EVENT_TYPE_LABEL, AGENT_NAME_LABEL, AUTONOMY_LEVEL_LABEL } from "@/data/agents/labels";
import { formatDateTime, formatNumber } from "@/lib/format";
import { AgentEventItem } from "./agent-event-item";
import { AgentIconTile, LiveIndicator, RunStatusBadge, formatDuration, isLiveStatus } from "./agent-meta";
import { PendingActionPanel } from "./pending-action-panel";

const TRIGGER_LABEL: Record<AgentRunDetail["triggeredBy"], string> = { user: "Started manually", schedule: "Scheduled", event: "Triggered by an event" };

/** Event types worth counting in the rail — what the run produced. */
const OUTPUT_TYPES: AgentEvent["type"][] = ["observation", "recommendation", "draft", "action_required"];

/**
 * The live run view — `docs/epics/12-agents.md`'s "live-updating run view
 * (step list with real evidence links)". `useAgentRun` polls `GET
 * /agent-runs/:id` every 2s while the run is queued/running and stops on
 * its own. Anything the run needs from a human (Level 3's pending action)
 * comes first; the step timeline is the main story; the rail holds
 * progress and the run's facts.
 */
export function AgentRunDetailView({ runId }: { runId: string }) {
  const { state, reload } = useAgentRun(runId);
  const { toast } = useToast();

  async function handleApprove() {
    try {
      await approvePendingAction(runId);
      toast({ title: "Action approved", description: "A 30-day rollback window has started. This has not published anything." });
      reload();
    } catch (err) {
      toast({
        title: "Couldn't approve that action",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    }
  }

  if (state.status === "loading") return <DetailSkeleton label="Loading agent run…" />;

  if (state.status === "error") {
    return (
      <>
        <DetailHeader backHref="/agents" backLabel="Agents" title="Agent run" />
        <ErrorPanel title="This run didn't load" message={state.error.message} onRetry={reload} />
      </>
    );
  }

  const { run } = state;
  const live = isLiveStatus(run.status);
  const pendingFirst = [...run.pendingActions].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));

  return (
    <>
      <DetailHeader
        backHref="/agents"
        backLabel="Agents"
        leading={<AgentIconTile agentName={run.agentName} size="lg" />}
        title={AGENT_NAME_LABEL[run.agentName]}
        badges={
          <>
            <RunStatusBadge status={run.status} size="md" />
            {live && <LiveIndicator label="Live · updates every 2s" />}
          </>
        }
        subtitle={`${AUTONOMY_LEVEL_LABEL[run.autonomyLevel]} · ${TRIGGER_LABEL[run.triggeredBy]}`}
        meta={[
          { label: "Started", value: run.startedAt ? formatDateTime(run.startedAt) : "Not yet" },
          { label: "Duration", value: run.latencyMs !== null ? formatDuration(run.latencyMs) : live ? "In progress" : "—" },
          { label: "Steps", value: `${run.stepsCompleted} of ${run.totalSteps}` },
          { label: "Tokens", value: formatNumber(run.tokensUsed) },
          ...(run.completedAt ? [{ label: "Finished", value: formatDateTime(run.completedAt) }] : []),
        ]}
      />

      <PageStack>
        <DetailLayout
          aside={
            <>
              <Section title="Progress">
                <ProgressRing run={run} />
                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
                  {OUTPUT_TYPES.map((type) => (
                    <div key={type} className="rounded-lg bg-surface px-3 py-2">
                      <dt className="truncate text-[11.5px] text-muted-foreground">{AGENT_EVENT_TYPE_LABEL[type]}</dt>
                      <dd className="font-mono text-[15px] font-semibold tabular-nums text-foreground">
                        {run.events.filter((e) => e.type === type).length}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Section>
              <Section title="Details">
                <PropertyList
                  items={[
                    { label: "Agent version", value: <span className="font-mono text-[12.5px]">v{run.agentVersion}</span> },
                    { label: "Autonomy", value: AUTONOMY_LEVEL_LABEL[run.autonomyLevel] },
                    { label: "Trigger", value: TRIGGER_LABEL[run.triggeredBy] },
                    { label: "Queued", value: formatDateTime(run.createdAt) },
                    { label: "Run ID", value: <span className="break-all font-mono text-[11.5px] text-muted-foreground">{run.id}</span> },
                  ]}
                />
              </Section>
            </>
          }
        >
          {run.error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-muted px-4 py-3.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">This run failed</p>
                <p className="mt-0.5 break-words text-[12.5px] leading-relaxed text-muted-foreground">{run.error}</p>
              </div>
            </div>
          )}

          {pendingFirst.length > 0 && (
            <Section
              title={pendingFirst.some((p) => p.status === "pending") ? "Needs your approval" : "Proposed actions"}
              description="What this run proposed at Level 3. Approving never publishes anything on its own."
            >
              <div className="flex flex-col gap-3">
                {pendingFirst.map((pending) => (
                  <PendingActionPanel key={pending.id} pendingAction={pending} onApprove={handleApprove} />
                ))}
              </div>
            </Section>
          )}

          <Section
            title="Step log"
            description="Every step this run took, in order — append-only, never edited after the fact."
            actions={<span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">{run.events.length} events</span>}
          >
            {run.events.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-border-strong/60 px-4 py-6">
                {live && <LiveIndicator label="" />}
                <p className="text-[13px] text-muted-foreground">
                  {live ? "Waiting for the first step — this page updates on its own." : "This run didn't record any steps."}
                </p>
              </div>
            ) : (
              <ol aria-live={live ? "polite" : undefined} aria-relevant="additions">
                {run.events.map((event, i) => (
                  <AgentEventItem key={event.id} event={event} last={i === run.events.length - 1 && !live} />
                ))}
                {live && (
                  <li className="relative flex items-center gap-3.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-info/50" aria-hidden="true">
                      <span className="size-2 animate-pulse rounded-full bg-info motion-reduce:animate-none" />
                    </span>
                    <p className="text-[12.5px] text-muted-foreground">Working on the next step…</p>
                  </li>
                )}
              </ol>
            )}
          </Section>
        </DetailLayout>
      </PageStack>
    </>
  );
}

/** Steps completed as a ring — the run's one-glance answer to "how far
 *  along is it?". Real `stepsCompleted / totalSteps`, nothing estimated. */
function ProgressRing({ run }: { run: AgentRunDetail }) {
  const reduce = useReducedMotion();
  const pct = run.totalSteps > 0 ? Math.min(1, run.stepsCompleted / run.totalSteps) : 0;
  const tone = run.status === "failed" ? "text-danger" : run.status === "completed" ? "text-success" : "text-info";
  const R = 34;

  return (
    <div className="flex items-center gap-4">
      <div className="relative size-[84px] shrink-0">
        <svg viewBox="0 0 84 84" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="42" cy="42" r={R} fill="none" strokeWidth="7" className="stroke-surface" style={{ stroke: "var(--surface)" }} />
          <motion.circle
            cx="42"
            cy="42"
            r={R}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className={cn("stroke-current", tone)}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: pct }}
            transition={{ duration: reduce ? 0 : 0.8, ease: easings.emphasized }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[17px] font-semibold tabular-nums text-foreground">
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">
          {run.stepsCompleted} of {run.totalSteps} steps
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          {run.status === "completed"
            ? "Finished. Everything it found is in the step log."
            : run.status === "failed"
              ? "Stopped early — see the error above."
              : run.status === "queued"
                ? "Queued. It starts as soon as a worker picks it up."
                : "Running. You can leave this page — the run keeps going."}
        </p>
      </div>
      <span className="sr-only">
        {Math.round(pct * 100)} percent complete, {run.stepsCompleted} of {run.totalSteps} steps.
      </span>
    </div>
  );
}
