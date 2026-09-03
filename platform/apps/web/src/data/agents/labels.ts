import type { BadgeProps } from "@bebest/ui";
import type { AgentEventType, AgentName, AgentPendingActionStatus, AgentRunStatus, AutonomyLevel } from "./types";

/** Display-only label/variant maps for Epic 12 (GEO Agent / SEO Agent /
 *  Growth Agent) — same role `data/opportunities/labels.ts` plays for
 *  Epic 9. */

export const AGENT_NAME_LABEL: Record<AgentName, string> = {
  geo_agent: "GEO Agent",
  seo_agent: "SEO Agent",
  growth_agent: "Growth Agent",
};

export const AGENT_NAME_DESCRIPTION: Record<AgentName, string> = {
  geo_agent: "Runs AI visibility measurement, diagnoses competitive gaps, and generates recommendations end to end.",
  seo_agent: "Reviews already-crawled pages for issues and generates recommendations from search-demand gaps.",
  growth_agent: "Runs the GEO Agent then the SEO Agent in sequence and synthesizes both into one summary.",
};

export const AGENT_RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export const AGENT_RUN_STATUS_BADGE_VARIANT: Record<AgentRunStatus, NonNullable<BadgeProps["variant"]>> = {
  queued: "neutral",
  running: "warning",
  completed: "success",
  failed: "danger",
};

/** `1` (Recommend), `2` (Draft), `3` (Approve & Execute) — per
 *  `docs/13-agents/AGENT_ARCHITECTURE.md`'s autonomy ladder. `4` is
 *  deliberately absent: the backend hard-blocks it
 *  (`lib/agents/autonomy.ts`) and this UI never offers it as a choice. */
export const AUTONOMY_LEVEL_LABEL: Record<AutonomyLevel, string> = {
  1: "Level 1 — Recommend",
  2: "Level 2 — Draft",
  3: "Level 3 — Approve & Execute",
};

export const AUTONOMY_LEVEL_DESCRIPTION: Record<AutonomyLevel, string> = {
  1: "The agent observes and recommends. Nothing is created without a separate manual step.",
  2: "The agent drafts recommendations directly from its findings.",
  3: "The agent proposes one action for one-click approval. Approving it never publishes anything — execution is a later step.",
};

export const AGENT_EVENT_TYPE_LABEL: Record<AgentEventType, string> = {
  progress: "Progress",
  observation: "Observation",
  recommendation: "Recommendation",
  draft: "Draft",
  action_required: "Action required",
  complete: "Complete",
  error: "Error",
};

export const AGENT_EVENT_TYPE_BADGE_VARIANT: Record<AgentEventType, NonNullable<BadgeProps["variant"]>> = {
  progress: "neutral",
  observation: "outline",
  recommendation: "accent",
  draft: "accent",
  action_required: "warning",
  complete: "success",
  error: "danger",
};

export const PENDING_ACTION_STATUS_LABEL: Record<AgentPendingActionStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
};

export const PENDING_ACTION_STATUS_BADGE_VARIANT: Record<AgentPendingActionStatus, NonNullable<BadgeProps["variant"]>> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};
