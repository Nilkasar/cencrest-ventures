"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot } from "lucide-react";
import { Badge, EmptyState, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAgentRuns } from "@/hooks/use-agent-runs";
import {
  AgentRunLimitError,
  AgentsNotAvailableError,
  AutonomyLevelRejectedError,
  NoBrandProfileError,
  triggerAgentRun,
} from "@/data/agents/client";
import type { AgentName, AutonomyLevel } from "@/data/agents/types";
import { AGENT_NAME_LABEL, AGENT_RUN_STATUS_BADGE_VARIANT, AGENT_RUN_STATUS_LABEL, AUTONOMY_LEVEL_LABEL } from "@/data/agents/labels";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { AgentTriggerCard } from "./agent-trigger-card";

const AGENTS: AgentName[] = ["geo_agent", "seo_agent", "growth_agent"];

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Epic 12 (GEO Agent / SEO Agent / Growth Agent)'s main screen —
 * `docs/epics/12-agents.md`'s UI-surface requirement: a trigger for each
 * agent, and "an agent-runs history list per brand". Calls
 * `platform/apps/api`'s real, tested routes from the first line, no
 * fixture layer: `data/agents/client.ts`'s `triggerAgentRun`/`listAgentRuns`
 * (via `useAgentRuns`). Clicking a history row opens the live-updating run
 * view (`/agents/:id`, `AgentRunDetailView` + `useAgentRun`'s 2s poll).
 */
export function AgentsView() {
  const router = useRouter();
  const { toast } = useToast();
  const { reload, ...state } = useAgentRuns();
  const [runningAgent, setRunningAgent] = useState<AgentName | null>(null);

  async function handleRun(agentName: AgentName, autonomyLevel: AutonomyLevel) {
    setRunningAgent(agentName);
    try {
      const run = await triggerAgentRun(agentName, autonomyLevel);
      toast({ title: `${AGENT_NAME_LABEL[agentName]} started`, description: `Running at ${AUTONOMY_LEVEL_LABEL[autonomyLevel]}.` });
      reload();
      router.push(`/agents/${run.id}`);
    } catch (err) {
      if (err instanceof AgentRunLimitError || err instanceof AgentsNotAvailableError || err instanceof AutonomyLevelRejectedError || err instanceof NoBrandProfileError) {
        toast({ title: "Couldn't start that agent", description: err.message, variant: "danger" });
      } else {
        toast({
          title: "Couldn't start that agent",
          description: err instanceof Error ? err.message : "Something went wrong — try again.",
          variant: "danger",
        });
      }
    } finally {
      setRunningAgent(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Agents"
        description="Autonomous, observable runs over your existing intelligence — the GEO Agent, SEO Agent, and Growth Agent orchestrate Query Universe, AI Visibility, Competitors, Opportunities, and Recommendations end to end, with a visible step-by-step log for every run."
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        {AGENTS.map((agentName) => (
          <AgentTriggerCard key={agentName} agentName={agentName} running={runningAgent === agentName} onRun={handleRun} />
        ))}
      </div>

      <div>
        <h2 className="font-display text-[16px] font-semibold text-foreground mb-1">Run history</h2>
        <p className="text-[12.5px] text-muted-foreground mb-3">Newest first. Click a run to see its full step-by-step event log.</p>

        {state.status === "loading" && <HistorySkeleton />}

        {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

        {state.status === "success" && state.data.length === 0 && (
          <EmptyState
            compact
            icon={<Bot size={18} />}
            title="No agent runs yet"
            description="Run any of the three agents above to see its live, step-by-step event log here."
          />
        )}

        {state.status === "success" && state.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Autonomy</TableHead>
                <TableHead>Triggered</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.map((run) => (
                <TableRow
                  key={run.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  role="link"
                  onClick={() => router.push(`/agents/${run.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(`/agents/${run.id}`);
                  }}
                >
                  <TableCell>
                    <p className="text-[13px] font-medium text-foreground">{AGENT_NAME_LABEL[run.agentName]}</p>
                    <p className="text-[11.5px] text-subtle-foreground font-mono">v{run.agentVersion}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={AGENT_RUN_STATUS_BADGE_VARIANT[run.status]} size="sm">
                      {AGENT_RUN_STATUS_LABEL[run.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-[12.5px] text-foreground">
                      {run.stepsCompleted}/{run.totalSteps}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[12.5px] text-muted-foreground">Level {run.autonomyLevel}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[12.5px] text-muted-foreground capitalize">{run.triggeredBy}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[12.5px] text-muted-foreground" title={run.startedAt ? formatDateTime(run.startedAt) : undefined}>
                      {run.startedAt ? formatRelativeTime(run.startedAt) : "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
