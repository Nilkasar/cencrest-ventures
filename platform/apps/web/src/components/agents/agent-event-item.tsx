import { AlertCircle, CheckCircle2, FileText, Lightbulb, ListChecks, Sparkles, ShieldAlert } from "lucide-react";
import { Badge, cn } from "@bebest/ui";
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

const NODE_TONE: Record<AgentEvent["type"], string> = {
  progress: "border-border bg-surface-raised text-muted-foreground",
  observation: "border-border bg-surface-raised text-muted-foreground",
  recommendation: "border-info/30 bg-info-muted text-info",
  draft: "border-info/30 bg-info-muted text-info",
  action_required: "border-warning/30 bg-warning-muted text-warning",
  complete: "border-success/30 bg-success-muted text-success",
  error: "border-danger/30 bg-danger-muted text-danger",
};

/**
 * One step of the append-only `agent_events` stream, drawn as a node on a
 * vertical timeline — the "see what the agent did, step by step"
 * transparency `AGENT_ARCHITECTURE.md` calls a trust differentiator.
 * Every event's real evidence is disclosed via `AgentEvidence`, never
 * summarized away.
 */
export function AgentEventItem({ event, last = false }: { event: AgentEvent; last?: boolean }) {
  const Icon = EVENT_ICON[event.type];
  const isError = event.type === "error";

  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0">
      {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" aria-hidden="true" />}
      <span className={cn("relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full border", NODE_TONE[event.type])} aria-hidden="true">
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={AGENT_EVENT_TYPE_BADGE_VARIANT[event.type]} size="sm">
            {AGENT_EVENT_TYPE_LABEL[event.type]}
          </Badge>
          {event.step !== null && event.totalSteps !== null && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              Step {event.step} of {event.totalSteps}
            </span>
          )}
          <time dateTime={event.createdAt} className="ml-auto text-[12px] text-subtle-foreground">
            {formatDateTime(event.createdAt)}
          </time>
        </div>
        {event.message && (
          <p className={cn("mt-1.5 text-[13px] leading-relaxed", isError ? "font-medium text-danger" : "text-foreground")}>{event.message}</p>
        )}
        {event.evidence && Object.keys(event.evidence).length > 0 && <AgentEvidence evidence={event.evidence} />}
      </div>
    </li>
  );
}
