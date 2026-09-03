/**
 * Epic 12 — GEO Agent / SEO Agent / Growth Agent domain model.
 *
 * Mirrors `apps/api/src/lib/agents/serialize.ts` and `lib/agents/types.ts`
 * field-for-field (read the actual route/serializer source, not just
 * `docs/epics/12-agents-backend.md`'s prose) — every field here is camelCase
 * because the API already returns a camelCase, whitelisted object, same
 * "comes across as-is" convention `data/opportunities/types.ts` documents.
 */

export type AgentName = "geo_agent" | "seo_agent" | "growth_agent";

export const AGENT_NAMES: readonly AgentName[] = ["geo_agent", "seo_agent", "growth_agent"];

export type AgentRunStatus = "queued" | "running" | "completed" | "failed";

export type TriggeredBy = "user" | "schedule" | "event";

/** The backend's real, enforced ceiling is `1 | 2 | 3` — level 4 is
 *  hard-blocked server-side (`lib/agents/autonomy.ts`) and never reachable
 *  from this UI: no control anywhere in this epic's frontend offers 4 as a
 *  choice, per the epic's own "Level 4 must be unreachable" requirement. */
export type AutonomyLevel = 1 | 2 | 3;

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [1, 2, 3];

export type AgentEventType = "progress" | "observation" | "recommendation" | "draft" | "action_required" | "complete" | "error";

/** The real tool-name vocabulary `lib/agents/tool-permissions.ts` enforces
 *  — only `create_content_brief` is ever actually produced as a pending
 *  action by this build's agents, but the full union is kept here so a
 *  future action_type never needs an `as` cast at the UI boundary. */
export type ToolName =
  | "crawl_url"
  | "search_web"
  | "run_ai_query"
  | "analyze_page"
  | "query_database"
  | "create_recommendation"
  | "create_content_brief"
  | "create_content_draft"
  | "publish_content"
  | "send_notification"
  | "modify_billing"
  | "change_user_permissions"
  | "access_other_org_data"
  | "send_external_email";

export interface AgentRun {
  id: string;
  brandId: string;
  agentName: AgentName;
  agentVersion: string;
  status: AgentRunStatus;
  triggeredBy: TriggeredBy;
  triggeredById: string | null;
  autonomyLevel: AutonomyLevel;
  stepsCompleted: number;
  totalSteps: number;
  tokensUsed: number;
  latencyMs: number | null;
  resultId: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `evidence`/`payload` are open JSONB on the backend — real ids/links into
 *  the underlying engine's own data (an `aiRunId`, a `recommendationId`, a
 *  `querySetId`...), never a fixed shape, so this stays an open record
 *  rather than a discriminated union the UI can't actually rely on. */
export interface AgentEvent {
  id: string;
  agentRunId: string;
  type: AgentEventType;
  message: string | null;
  step: number | null;
  totalSteps: number | null;
  evidence: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export type AgentPendingActionStatus = "pending" | "approved" | "rejected";

export interface AgentPendingAction {
  id: string;
  agentRunId: string;
  agentEventId: string;
  actionType: ToolName;
  title: string;
  description: string;
  payload: Record<string, unknown> | null;
  status: AgentPendingActionStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rollbackUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /agent-runs/:id`'s response shape — the run plus its full
 *  append-only event stream and any pending actions it produced. */
export interface AgentRunDetail extends AgentRun {
  events: AgentEvent[];
  pendingActions: AgentPendingAction[];
}

/** A `create_content_brief` pending action's real payload shape (see
 *  `geo-agent.ts`/`seo-agent.ts`'s `action_required` event) — narrowed here
 *  only for the one join the Opportunities/Recommendations screens need
 *  (`pending.payload.recommendationId`), not asserted as the only possible
 *  payload shape a future action_type might carry. */
export interface CreateContentBriefPayload {
  recommendationId: string;
}
