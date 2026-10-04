"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Lock, Play } from "lucide-react";
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bebest/ui";
import type { AgentName, AgentRun, AutonomyLevel } from "@/data/agents/types";
import { AUTONOMY_LEVELS } from "@/data/agents/types";
import { AGENT_NAME_DESCRIPTION, AGENT_NAME_LABEL, AUTONOMY_LEVEL_DESCRIPTION, AUTONOMY_LEVEL_LABEL } from "@/data/agents/labels";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { AgentIconTile, RunStatusBadge } from "./agent-meta";

/**
 * One agent's launch tile. The autonomy select only ever offers 1-3
 * (`AUTONOMY_LEVELS`) — level 4 is never reachable from this UI, per the
 * epic's "Level 4 must be unreachable" requirement; the real hard block
 * lives server-side (`lib/agents/autonomy.ts`). `lastRun` is this agent's
 * most recent run from the history list, linked so "what happened last
 * time" is one click away from "run it again".
 *
 * Epic 22 Phase 2: `limit` is the organization's ceiling (Settings ›
 * Autonomy, `effectiveMax`). Levels above it stay visible but disabled,
 * with the reason and — for an owner/admin — a link to change it. Unknown
 * (still loading, or the read failed) means no client-side cap; the server
 * enforces it either way (422 `above_org_autonomy_limit`).
 */
export interface AutonomyLimit {
  effectiveMax: AutonomyLevel;
  canEdit: boolean;
}

export function AgentTriggerCard({
  agentName,
  running,
  lastRun,
  limit,
  onRun,
}: {
  agentName: AgentName;
  running: boolean;
  lastRun?: AgentRun;
  limit?: AutonomyLimit;
  onRun: (agentName: AgentName, autonomyLevel: AutonomyLevel) => void;
}) {
  const [chosenLevel, setAutonomyLevel] = useState<AutonomyLevel>(1);
  const maxLevel: AutonomyLevel = limit?.effectiveMax ?? 3;
  // Clamped at render: if the limit drops below an earlier choice, the
  // card shows (and runs) the highest level still allowed.
  const autonomyLevel = Math.min(chosenLevel, maxLevel) as AutonomyLevel;
  const selectId = useId();
  const descId = useId();

  return (
    <div className="flex h-full flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        <AgentIconTile agentName={agentName} />
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground">{AGENT_NAME_LABEL[agentName]}</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{AGENT_NAME_DESCRIPTION[agentName]}</p>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-1.5">
        <Label htmlFor={selectId} className="text-[12px]">
          Autonomy
        </Label>
        <Select value={String(autonomyLevel)} onValueChange={(v) => setAutonomyLevel(Number(v) as AutonomyLevel)} disabled={running}>
          <SelectTrigger id={selectId} aria-describedby={descId} className="h-9 text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTONOMY_LEVELS.map((level) => (
              <SelectItem key={level} value={String(level)} disabled={level > maxLevel}>
                <span className="flex items-center gap-1.5">
                  {AUTONOMY_LEVEL_LABEL[level]}
                  {level > maxLevel && (
                    <>
                      <Lock size={11} aria-hidden="true" className="text-subtle-foreground" />
                      <span className="sr-only">(above your organization&apos;s limit)</span>
                    </>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={descId} className="min-h-[2lh] text-[12px] leading-snug text-muted-foreground">
          {AUTONOMY_LEVEL_DESCRIPTION[autonomyLevel]}
        </p>
        {limit && maxLevel < 3 && (
          <p className="flex items-start gap-1.5 rounded-md bg-surface px-2.5 py-2 text-[12px] leading-snug text-muted-foreground">
            <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Your organization limits agents to Level {maxLevel}.{" "}
              {limit.canEdit ? (
                <Link
                  href="/settings?tab=autonomy"
                  className="font-medium text-foreground underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  Change in Settings › Autonomy
                </Link>
              ) : (
                "Ask an owner or admin to raise it."
              )}
            </span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border pt-3">
        <Button variant="primary" size="md" loading={running} onClick={() => onRun(agentName, autonomyLevel)} className="w-full">
          <Play size={13} aria-hidden="true" /> Run {AGENT_NAME_LABEL[agentName]}
        </Button>
        {lastRun ? (
          <Link
            href={`/agents/${lastRun.id}`}
            className="flex items-center justify-between gap-2 rounded-md text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              Last run{" "}
              <span title={formatDateTime(lastRun.createdAt)}>{formatRelativeTime(lastRun.startedAt ?? lastRun.createdAt)}</span>
            </span>
            <RunStatusBadge status={lastRun.status} />
          </Link>
        ) : (
          <p className="text-[12px] text-subtle-foreground">Never run</p>
        )}
      </div>
    </div>
  );
}
