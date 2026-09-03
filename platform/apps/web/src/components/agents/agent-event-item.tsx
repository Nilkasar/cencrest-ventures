import { AlertCircle, CheckCircle2, FileText, Lightbulb, ListChecks, Sparkles, ShieldAlert } from "lucide-react";
import { Badge } from "@bebest/ui";
import type { AgentEvent } from "@/data/agents/types";
import { AGENT_EVENT_TYPE_BADGE_VARIANT, AGENT_EVENT_TYPE_LABEL } from "@/data/agents/labels";
import { formatDateTime } from "@/lib/format";
import { AgentEvidence } from "./agent-evidence";

const EVENT_ICON: Record<AgentEvent["type"], typeof ListChecks> = {
  progress: ListChecks,
  observation: Lightbulb,
  recommendation: Sparkles,
  draft: FileText,
  action_required: ShieldAlert,
  complete: CheckCircle2,
  error: AlertCircle,
};

/**
 * One row of the append-only `agent_events` stream — this IS the
 * "customers can see what the agent did, step-by-step" transparency
 * `AGENT_ARCHITECTURE.md` calls a trust differentiator, per this epic's UI
 * requirement. Every event's real evidence (an id/link into the underlying
 * engine's own data, never a synthetic string) is disclosed via
 * `AgentEvidence`, not summarized away.
 */
export function AgentEventItem({ event }: { event: AgentEvent }) {
  const Icon = EVENT_ICON[event.type];
  const isError = event.type === "error";

  return (
    <li className="flex gap-3 py-3">
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
          isError ? "border-danger/30 bg-danger-muted text-danger" : "border-border bg-surface text-muted-foreground"
        }`}
      >
        <Icon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={AGENT_EVENT_TYPE_BADGE_VARIANT[event.type]} size="sm">
            {AGENT_EVENT_TYPE_LABEL[event.type]}
          </Badge>
          {event.step !== null && event.totalSteps !== null && (
            <span className="font-mono text-[11px] text-subtle-foreground">
              step {event.step}/{event.totalSteps}
            </span>
          )}
          <span className="text-[11px] text-subtle-foreground">{formatDateTime(event.createdAt)}</span>
        </div>
        <p className={`text-[13px] mt-1 leading-relaxed ${isError ? "text-danger" : "text-foreground"}`}>{event.message}</p>
        {event.evidence && Object.keys(event.evidence).length > 0 && <AgentEvidence evidence={event.evidence} />}
      </div>
    </li>
  );
}
