import { Radar, Search, TrendingUp, type LucideIcon } from "lucide-react";
import { Badge, cn } from "@bebest/ui";
import type { AgentName, AgentRunStatus } from "@/data/agents/types";
import { AGENT_RUN_STATUS_BADGE_VARIANT, AGENT_RUN_STATUS_LABEL } from "@/data/agents/labels";

/** Display helpers shared by the Agents list and the run detail view. */

export const AGENT_ICON: Record<AgentName, LucideIcon> = {
  geo_agent: Radar,
  seo_agent: Search,
  growth_agent: TrendingUp,
};

export function AgentIconTile({ agentName, size = "md" }: { agentName: AgentName; size?: "sm" | "md" | "lg" }) {
  const Icon = AGENT_ICON[agentName];
  const box = size === "lg" ? "size-12 rounded-xl" : size === "md" ? "size-9 rounded-lg" : "size-7 rounded-md";
  const icon = size === "lg" ? 20 : size === "md" ? 16 : 13;
  return (
    <span className={cn("flex shrink-0 items-center justify-center border border-border bg-surface text-muted-foreground", box)} aria-hidden="true">
      <Icon size={icon} />
    </span>
  );
}

export function isLiveStatus(status: AgentRunStatus): boolean {
  return status === "queued" || status === "running";
}

export function RunStatusBadge({ status, size = "sm" }: { status: AgentRunStatus; size?: "sm" | "md" }) {
  return (
    <Badge variant={AGENT_RUN_STATUS_BADGE_VARIANT[status]} size={size} dot>
      {AGENT_RUN_STATUS_LABEL[status]}
    </Badge>
  );
}

/** "850ms" · "12.4s" · "3m 12s" · "1h 04m" — a run's wall-clock duration. */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Thin step-progress bar. Info tone while running, danger on failure,
 *  success when complete — the bar repeats the status badge, never replaces it. */
export function StepProgress({
  completed,
  total,
  status,
  className,
}: {
  completed: number;
  total: number;
  status: AgentRunStatus;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
  const tone = status === "failed" ? "bg-danger" : status === "completed" ? "bg-success" : "bg-info";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface", className)} aria-hidden="true">
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Pulsing "Live" chip for a run that's still updating. The pulse is a
 *  CSS animation and stops under `prefers-reduced-motion`. */
export function LiveIndicator({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-info">
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-info" />
      </span>
      {label}
    </span>
  );
}
