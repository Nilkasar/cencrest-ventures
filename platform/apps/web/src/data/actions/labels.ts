import type { BadgeProps } from "@bebest/ui";
import type { ActionAutonomyLevel, ActionPriority, ActionStatus } from "./types";

/** Display-only label/variant maps for Epic 13 (Action Center & Controlled
 *  Publishing) — same role `data/content/labels.ts`/`data/agents/labels.ts`
 *  play for Epics 11/12. */

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  pending: "Pending approval",
  approved: "In progress",
  completed: "Completed",
  rolled_back: "Rolled back",
};

export const ACTION_STATUS_BADGE_VARIANT: Record<ActionStatus, NonNullable<BadgeProps["variant"]>> = {
  pending: "warning",
  approved: "accent",
  completed: "success",
  rolled_back: "neutral",
};

export const ACTION_PRIORITY_LABEL: Record<ActionPriority, string> = {
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
  critical: "Critical",
};

export const ACTION_PRIORITY_BADGE_VARIANT: Record<ActionPriority, NonNullable<BadgeProps["variant"]>> = {
  low: "neutral",
  medium: "outline",
  high: "warning",
  critical: "danger",
};

/** `actions.action_type` is an open string on the backend — `"publish_content"`
 *  (Epic 11's content-draft handoff, `routes/content-drafts.ts`) or any
 *  `ToolName` (Epic 12's agent handoff, `routes/agent-run-details.ts` copies
 *  `agent_pending_actions.action_type` verbatim; only `create_content_brief`
 *  is ever actually produced by this build's agents today, per
 *  `data/agents/types.ts`'s own comment). Known values get a real label;
 *  anything else degrades to a humanized snake_case string rather than an
 *  `as`-cast crash — same open-fallback convention `contentTypeLabel`
 *  (`data/content/labels.ts`) already uses for exactly this situation. */
const ACTION_TYPE_LABEL: Record<string, string> = {
  publish_content: "Publish content",
  create_content_brief: "Create content brief",
  create_content_draft: "Create content draft",
  create_recommendation: "Create recommendation",
  send_notification: "Send notification",
};

export function actionTypeLabel(actionType: string): string {
  return ACTION_TYPE_LABEL[actionType] ?? actionType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** `1-3` reuse Epic 12's own autonomy ladder; `4` gets its own — never
 *  actually reachable through this build's own handoff flows (Epic 11's
 *  handoff always writes `1`; Epic 12's handoff copies `agent_runs.
 *  autonomy_level`, itself hard-capped to 1-3 server-side,
 *  `chk_agent_runs_autonomy_level`), representable here only because this
 *  epic's own non-negotiable requires a legitimately-`4` row be handled
 *  gracefully, not assumed impossible (see `types.ts`'s
 *  `ActionAutonomyLevel` comment). */
const AUTONOMY_LEVEL_LABEL: Record<ActionAutonomyLevel, string> = {
  1: "Level 1 — Recommend",
  2: "Level 2 — Draft",
  3: "Level 3 — Approve & Execute",
  4: "Level 4 — blocked",
};

export function autonomyLevelLabel(level: ActionAutonomyLevel): string {
  return AUTONOMY_LEVEL_LABEL[level];
}
