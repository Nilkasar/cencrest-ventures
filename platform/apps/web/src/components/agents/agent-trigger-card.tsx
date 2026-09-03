"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { Button, Card, CardContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bebest/ui";
import type { AgentName, AutonomyLevel } from "@/data/agents/types";
import { AUTONOMY_LEVELS } from "@/data/agents/types";
import { AGENT_NAME_DESCRIPTION, AGENT_NAME_LABEL, AUTONOMY_LEVEL_DESCRIPTION, AUTONOMY_LEVEL_LABEL } from "@/data/agents/labels";

/**
 * One agent's trigger control — `docs/epics/12-agents.md`'s "trigger the
 * GEO Agent on demand" (end-to-end flow step 1), extended to all three
 * agents this epic builds. The autonomy-level select only ever offers 1-3
 * (`AUTONOMY_LEVELS`) — level 4 is never a reachable choice anywhere in this
 * UI, per the epic's own "Level 4 must be unreachable" requirement; the
 * real hard-block still lives server-side (`lib/agents/autonomy.ts`), this
 * is just the UI never handing it a way to try.
 */
export function AgentTriggerCard({
  agentName,
  running,
  onRun,
}: {
  agentName: AgentName;
  running: boolean;
  onRun: (agentName: AgentName, autonomyLevel: AutonomyLevel) => void;
}) {
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>(1);

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-3">
        <div>
          <h3 className="font-display text-[14.5px] font-semibold text-foreground">{AGENT_NAME_LABEL[agentName]}</h3>
          <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">{AGENT_NAME_DESCRIPTION[agentName]}</p>
        </div>

        <Select value={String(autonomyLevel)} onValueChange={(v) => setAutonomyLevel(Number(v) as AutonomyLevel)} disabled={running}>
          <SelectTrigger className="h-8 text-[12.5px]" aria-label={`Autonomy level for ${AGENT_NAME_LABEL[agentName]}`}>
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
        <p className="text-[11.5px] text-subtle-foreground leading-relaxed -mt-1.5">{AUTONOMY_LEVEL_DESCRIPTION[autonomyLevel]}</p>

        <Button variant="primary" size="sm" loading={running} onClick={() => onRun(agentName, autonomyLevel)}>
          <Play size={13} /> Run {AGENT_NAME_LABEL[agentName]}
        </Button>
      </CardContent>
    </Card>
  );
}
