"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Play } from "lucide-react";
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
 */
export function AgentTriggerCard({
  agentName,
  running,
  lastRun,
  onRun,
}: {
  agentName: AgentName;
  running: boolean;
  lastRun?: AgentRun;
  onRun: (agentName: AgentName, autonomyLevel: AutonomyLevel) => void;
}) {
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>(1);
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
              <SelectItem key={level} value={String(level)}>
                {AUTONOMY_LEVEL_LABEL[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={descId} className="min-h-[2lh] text-[12px] leading-snug text-muted-foreground">
          {AUTONOMY_LEVEL_DESCRIPTION[autonomyLevel]}
        </p>
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
