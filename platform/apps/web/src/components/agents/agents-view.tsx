"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, Bot, CheckCircle2, Play, XCircle } from "lucide-react";
import { Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { CellLink, ClickableRow, TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { typography } from "@/components/patterns/typography";
import { useAgentRuns } from "@/hooks/use-agent-runs";
import { OrgAutonomyLimitError, triggerAgentRun } from "@/data/agents/client";
import { getAutonomy } from "@/data/organization/client";
import { useAsyncData } from "@/lib/use-async-data";
import type { AgentName, AgentRun, AutonomyLevel } from "@/data/agents/types";
import { AGENT_NAME_LABEL, AUTONOMY_LEVEL_LABEL } from "@/data/agents/labels";
import { formatDateTime, formatNumber, formatPercent, formatRelativeTime } from "@/lib/format";
import { AgentTriggerCard } from "./agent-trigger-card";
import { AgentIconTile, LiveIndicator, RunStatusBadge, StepProgress, formatDuration, isLiveStatus } from "./agent-meta";

const AGENTS: AgentName[] = ["geo_agent", "seo_agent", "growth_agent"];

const COLUMNS: SkeletonColumn[] = [
  { header: "Agent", cell: "entity" },
  { header: "Status", cell: "badge" },
  { header: "Progress", cell: "text" },
  { header: "Autonomy", cell: "meta" },
  { header: "Duration", cell: "number", align: "right" },
  { header: "Started", cell: "meta" },
];

const TRIGGER_LABEL: Record<AgentRun["triggeredBy"], string> = { user: "Manual", schedule: "Scheduled", event: "Event" };

/**
 * Epic 12 (GEO / SEO / Growth Agent)'s screen. Launch an agent (top), see
 * how runs are going (stats), and open any run's live step log (history
 * table → `/agents/:id`). Backed by the real `triggerAgentRun` and
 * `useAgentRuns` (which polls every 4s while any run is in flight).
 */
export function AgentsView() {
  const router = useRouter();
  const { toast } = useToast();
  const { reload, ...state } = useAgentRuns();
  const [runningAgent, setRunningAgent] = useState<AgentName | null>(null);
  // The org's autonomy ceiling (Settings › Autonomy). If it can't be read,
  // the cards fall back to no client-side cap — the server still enforces it.
  const { reload: reloadAutonomy, ...autonomy } = useAsyncData(getAutonomy, []);
  const limit = autonomy.status === "success" ? { effectiveMax: autonomy.data.effectiveMax, canEdit: autonomy.data.canEdit } : undefined;

  async function handleRun(agentName: AgentName, autonomyLevel: AutonomyLevel) {
    setRunningAgent(agentName);
    try {
      const run = await triggerAgentRun(agentName, autonomyLevel);
      toast({ title: `${AGENT_NAME_LABEL[agentName]} started`, description: `Running at ${AUTONOMY_LEVEL_LABEL[autonomyLevel]}.` });
      reload();
      router.push(`/agents/${run.id}`);
    } catch (err) {
      if (err instanceof OrgAutonomyLimitError) {
        // The limit changed since this page loaded — re-read it so the
        // cards lock the levels above it, and say what happened.
        reloadAutonomy();
        toast({
          title: `Level ${autonomyLevel} is above your organization’s limit`,
          description: `Agents here can run up to Level ${err.limit}. Pick a lower level${limit?.canEdit ? ", or raise the limit in Settings › Autonomy" : ""}.`,
          variant: "danger",
        });
        return;
      }
      // Entitlement / precondition failures (`AgentRunLimitError`,
      // `AgentsNotAvailableError`, …) already carry a user-facing message.
      toast({
        title: "Couldn't start that agent",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setRunningAgent(null);
    }
  }

  const runs = state.status === "success" ? state.data : null;
  const live = runs?.filter((r) => isLiveStatus(r.status)).length ?? 0;
  const completed = runs?.filter((r) => r.status === "completed").length ?? 0;
  const failed = runs?.filter((r) => r.status === "failed").length ?? 0;
  const finished = completed + failed;
  const lastRunByAgent = new Map<AgentName, AgentRun>();
  for (const run of runs ?? []) if (!lastRunByAgent.has(run.agentName)) lastRunByAgent.set(run.agentName, run);

  return (
    <PageStack>
      {state.status !== "error" && (
        <StatGrid>
          <StatTile label="Runs" icon={<Bot size={13} />} loading={!runs} value={runs ? formatNumber(runs.length) : "—"} hint="In your run history" />
          <StatTile
            label="Running now"
            icon={<Activity size={13} />}
            loading={!runs}
            value={runs ? formatNumber(live) : "—"}
            hint={live > 0 ? <LiveIndicator label="Updating live" /> : "Queued or in progress"}
          />
          <StatTile
            label="Completed"
            icon={<CheckCircle2 size={13} />}
            loading={!runs}
            value={runs ? formatNumber(completed) : "—"}
            hint={finished > 0 ? `${formatPercent((completed / finished) * 100)} of finished runs` : "No finished runs yet"}
          />
          <StatTile label="Failed" icon={<XCircle size={13} />} loading={!runs} value={runs ? formatNumber(failed) : "—"} hint="Open a run to see why" />
        </StatGrid>
      )}

      <Section title="Run an agent" description="Pick how much the agent may do on its own. Level 4 (fully autonomous) is never available.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {AGENTS.map((agentName) => (
            <AgentTriggerCard
              key={agentName}
              agentName={agentName}
              running={runningAgent === agentName}
              lastRun={lastRunByAgent.get(agentName)}
              limit={limit}
              onRun={handleRun}
            />
          ))}
        </div>
      </Section>

      <Reveal>
        {state.status === "loading" && <TableSkeleton columns={COLUMNS} rows={4} label="Loading agent runs…" />}

        {state.status === "error" && <ErrorPanel title="Run history didn't load" message={state.error.message} onRetry={reload} />}

        {runs && runs.length === 0 && (
          <EmptyState
            compact
            icon={<Bot size={18} />}
            title="No agent runs yet"
            description="Start with the GEO Agent at Level 1 — it measures your AI visibility, diagnoses gaps and recommends next moves, without creating anything on its own. Every step shows up here live."
            action={
              <Button variant="primary" size="sm" loading={runningAgent === "geo_agent"} onClick={() => handleRun("geo_agent", 1)}>
                <Play size={13} aria-hidden="true" /> Run GEO Agent
              </Button>
            }
          />
        )}

        {runs && runs.length > 0 && (
          <Section
            flush
            title="Run history"
            description="Newest first. Open a run for its full step-by-step event log."
            actions={live > 0 ? <LiveIndicator /> : undefined}
          >
            <Table framed={false}>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[180px]">Progress</TableHead>
                  <TableHead>Autonomy</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <ClickableRow key={run.id} href={`/agents/${run.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <AgentIconTile agentName={run.agentName} size="sm" />
                        <div className="min-w-0">
                          <CellLink href={`/agents/${run.id}`} className="block truncate text-[13px]">
                            {AGENT_NAME_LABEL[run.agentName]}
                          </CellLink>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {TRIGGER_LABEL[run.triggeredBy]} · v{run.agentVersion}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <StepProgress completed={run.stepsCompleted} total={run.totalSteps} status={run.status} className="w-20" />
                        <span className={typography.numeric}>
                          {run.stepsCompleted}/{run.totalSteps}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-[13px] text-muted-foreground">Level {run.autonomyLevel}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={typography.numeric}>{formatDuration(run.latencyMs)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={typography.meta} title={run.startedAt ? formatDateTime(run.startedAt) : undefined}>
                        {run.startedAt ? formatRelativeTime(run.startedAt) : "Not started"}
                      </span>
                    </TableCell>
                  </ClickableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        )}
      </Reveal>
    </PageStack>
  );
}
