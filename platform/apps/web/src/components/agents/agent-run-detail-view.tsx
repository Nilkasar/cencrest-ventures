"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, CardContent, Skeleton, useToast } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAgentRun } from "@/hooks/use-agent-run";
import { approvePendingAction } from "@/data/agents/client";
import { AGENT_NAME_LABEL, AGENT_RUN_STATUS_BADGE_VARIANT, AGENT_RUN_STATUS_LABEL } from "@/data/agents/labels";
import { formatDateTime } from "@/lib/format";
import { AgentEventItem } from "./agent-event-item";
import { PendingActionPanel } from "./pending-action-panel";

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * The live-updating run view — `docs/epics/12-agents.md`'s literal UI
 * requirement: "a live-updating run view (step list with real evidence
 * links...)". Backed by `useAgentRun`'s 2s poll of `GET /agent-runs/:id`
 * for as long as the run is `queued`/`running`; a completed/failed run stops
 * polling automatically. Level 3's pending action (if any) is shown inline
 * here with its one-click approval — the same `PendingActionPanel` also
 * embedded on the Recommendations/Opportunities screens, per this epic's
 * "surfaced inline... rather than a separate approval inbox" requirement.
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

  const backLink = (
    <Link href="/agents" className="inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline underline-offset-4">
      <ArrowLeft size={13} /> Back to Agents
    </Link>
  );

  if (state.status === "loading") {
    return (
      <>
        <PageHeader eyebrow="Automation" title="Agent run" actions={backLink} />
        <Card>
          <DetailSkeleton />
        </Card>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <PageHeader eyebrow="Automation" title="Agent run" actions={backLink} />
        <ErrorPanel message={state.error.message} onRetry={reload} />
      </>
    );
  }

  const { run } = state;
  const isLive = run.status === "queued" || run.status === "running";

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title={AGENT_NAME_LABEL[run.agentName]}
        description={`Autonomy Level ${run.autonomyLevel} · triggered ${run.triggeredBy} · started ${run.startedAt ? formatDateTime(run.startedAt) : "not yet"}.`}
        actions={backLink}
      />

      <Card className="mb-5">
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Badge variant={AGENT_RUN_STATUS_BADGE_VARIANT[run.status]}>{AGENT_RUN_STATUS_LABEL[run.status]}</Badge>
            {isLive && <span className="text-[12px] text-muted-foreground animate-pulse">Live — updating every 2s…</span>}
            <span className="font-mono text-[12.5px] text-foreground">
              {run.stepsCompleted}/{run.totalSteps} steps
            </span>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
            {run.latencyMs !== null && <span>{(run.latencyMs / 1000).toFixed(1)}s elapsed</span>}
            {run.completedAt && <span>Completed {formatDateTime(run.completedAt)}</span>}
          </div>
        </CardContent>
        {run.totalSteps > 0 && (
          <div className="h-1.5 w-full bg-surface rounded-b-lg overflow-hidden">
            <div
              className={`h-full ${run.status === "failed" ? "bg-danger" : "bg-accent"}`}
              style={{ width: `${Math.min(100, (run.stepsCompleted / run.totalSteps) * 100)}%` }}
            />
          </div>
        )}
      </Card>

      {run.error && (
        <div role="alert" className="mb-5 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3">
          <p className="text-[13px] font-medium text-foreground">Run failed</p>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">{run.error}</p>
        </div>
      )}

      {run.pendingActions.length > 0 && (
        <div className="mb-5 flex flex-col gap-3">
          {run.pendingActions.map((pending) => (
            <PendingActionPanel key={pending.id} pendingAction={pending} onApprove={handleApprove} />
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <h2 className="font-display text-[15px] font-semibold text-foreground mb-1">Event log</h2>
          <p className="text-[12.5px] text-muted-foreground mb-2">Every step this run took, in order — append-only, never edited after the fact.</p>
          {run.events.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground py-4">No events yet — this run hasn&apos;t started emitting steps.</p>
          ) : (
            <ul className="divide-y divide-border">
              {run.events.map((event) => (
                <AgentEventItem key={event.id} event={event} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
