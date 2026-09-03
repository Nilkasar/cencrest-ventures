import { apiClient, ApiError } from "@/lib/api-client";
import type { AgentName, AgentPendingAction, AgentRun, AgentRunDetail, AutonomyLevel, CreateContentBriefPayload } from "./types";

/**
 * Epic 12 (GEO Agent / SEO Agent / Growth Agent)'s data-access seam — same
 * role `data/opportunities/client.ts`/`data/recommendations/client.ts` play
 * for Epics 9/10. Every screen calls through here, never `apiClient`
 * directly. Calls `platform/apps/api`'s real, tested routes from the first
 * line, no fixture layer:
 *
 *   GET  /api/brands/me/agents                 -> listAgentRuns()
 *   POST /api/brands/me/agents/:agentName/run  -> triggerAgentRun()
 *   GET  /api/agent-runs/:id                    -> getAgentRun()
 *   POST /api/agent-runs/:id/approve            -> approvePendingAction()
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
    const value = (err.body as { error?: unknown }).error;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function errorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "message" in err.body) {
    const value = (err.body as { message?: unknown }).message;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** Thrown when any route 404s with the shared `NO_BRAND_ERROR` body — the
 *  organization hasn't completed brand onboarding yet. Same convention
 *  `data/opportunities/client.ts`'s own `NoBrandProfileError` documents. */
export class NoBrandProfileError extends Error {
  constructor() {
    super("Complete your brand profile before running an agent.");
    this.name = "NoBrandProfileError";
  }
}

/** Thrown when `POST .../agents/:agentName/run` 402s because the plan lacks
 *  the `agents` feature at all (distinct from having the feature but hitting
 *  its usage cap — see `AgentRunLimitError` below). */
export class AgentsNotAvailableError extends Error {
  constructor(message = "Agents are not available on your current plan.") {
    super(message);
    this.name = "AgentsNotAvailableError";
  }
}

/** Thrown when the `agent_runs_per_month` entitlement is exhausted (402
 *  `agent_run_limit_reached`) — BEFORE any `agent_runs` row is created, the
 *  epic's own end-to-end flow step 2 invariant. Same typed-error shape as
 *  `AiQueryLimitError` in `data/ai-visibility/client.ts`. */
export class AgentRunLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
    public readonly plan: string,
    public readonly upgradeTo: string | null,
  ) {
    super(
      `Your ${plan} plan allows up to ${limit.toLocaleString()} agent runs per month (you've already used ${current.toLocaleString()} this month).${
        upgradeTo ? ` Upgrade to ${upgradeTo} for a higher limit.` : ""
      }`,
    );
    this.name = "AgentRunLimitError";
  }
}

/** The HTTP surface of `lib/agents/autonomy.ts`'s hard block (422
 *  `autonomy_level_rejected`) — reachable only by a hostile/malformed
 *  request, since this UI never offers anything above level 3 as a choice. */
export class AutonomyLevelRejectedError extends Error {
  constructor(message = "That autonomy level is not allowed.") {
    super(message);
    this.name = "AutonomyLevelRejectedError";
  }
}

/** Thrown when an agent-run id doesn't resolve for this org — deleted,
 *  never existed, or another org's row. Never a 403 that would confirm
 *  existence (tenant isolation), per `agent-run-details.ts`'s own
 *  `NOT_FOUND_ERROR` convention (a flat 404 regardless of which case). */
export class AgentRunNotFoundError extends Error {
  constructor(message = "That agent run couldn't be found.") {
    super(message);
    this.name = "AgentRunNotFoundError";
  }
}

/** Thrown when `POST /agent-runs/:id/approve` 404s because the run has no
 *  `status: 'pending'` action awaiting approval (already decided, or this
 *  run never produced one). */
export class NoPendingActionError extends Error {
  constructor(message = "This run has no pending action awaiting approval.") {
    super(message);
    this.name = "NoPendingActionError";
  }
}

function translateRunError(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as { limit?: number; current?: number; plan?: string; upgradeTo?: string | null } | undefined;
    if (err.status === 402 && errorCode(err) === "agent_run_limit_reached") {
      throw new AgentRunLimitError(body?.limit ?? 0, body?.current ?? 0, body?.plan ?? "free", body?.upgradeTo ?? null);
    }
    if (err.status === 402 && errorCode(err) === "agents_not_available") {
      throw new AgentsNotAvailableError(errorMessage(err));
    }
    if (err.status === 422 && errorCode(err) === "autonomy_level_rejected") {
      throw new AutonomyLevelRejectedError(errorMessage(err));
    }
    if (err.status === 404) {
      throw new NoBrandProfileError();
    }
  }
  throw err;
}

/** Newest first (`GET /brands/me/agents` orders by `created_at desc`
 *  server-side — never re-sorted client-side). A 404 (no brand profile yet)
 *  degrades to an empty list, same "let the empty state carry it" precedent
 *  `listOpportunities`/`listRecommendations` use for the same situation. */
export async function listAgentRuns(): Promise<AgentRun[]> {
  try {
    return await apiClient.get<AgentRun[]>("/brands/me/agents");
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

/** Triggers one of the three agents against the org's one brand.
 *  `autonomyLevel` defaults to `1` (Recommend-only) when omitted — the
 *  safest choice, never silently escalated. Rethrows the
 *  entitlement/precondition failures as the typed errors above; anything
 *  else propagates as a plain `ApiError`. */
export async function triggerAgentRun(agentName: AgentName, autonomyLevel: AutonomyLevel = 1): Promise<AgentRun> {
  try {
    return await apiClient.post<AgentRun>(`/brands/me/agents/${agentName}/run`, { autonomyLevel });
  } catch (err) {
    translateRunError(err);
  }
}

/** Status + the full append-only event stream, plus any pending Level-3
 *  actions this run produced — this IS the "customers can see what the
 *  agent did, step-by-step" transparency the run detail screen polls. */
export async function getAgentRun(id: string): Promise<AgentRunDetail> {
  try {
    return await apiClient.get<AgentRunDetail>(`/agent-runs/${id}`);
  } catch (err) {
    if (isNotFound(err)) throw new AgentRunNotFoundError();
    throw err;
  }
}

/** The one-click approval this epic's Level 3 mechanics require. Sets a
 *  30-day rollback window server-side; never executes/publishes anything
 *  itself (Epic 13's job) — this only flips the pending action's status. */
export async function approvePendingAction(agentRunId: string): Promise<AgentPendingAction> {
  try {
    return await apiClient.post<AgentPendingAction>(`/agent-runs/${agentRunId}/approve`);
  } catch (err) {
    if (isNotFound(err)) {
      throw errorCode(err) === "no_pending_action" ? new NoPendingActionError(errorMessage(err)) : new AgentRunNotFoundError();
    }
    throw err;
  }
}

/** Reads a `create_content_brief` pending action's `recommendationId` back
 *  out of its open `payload` JSONB — the one join the Opportunities/
 *  Recommendations screens need to surface an approval inline on the exact
 *  recommendation it targets. `undefined` for any other action_type/shape. */
export function pendingActionRecommendationId(pending: AgentPendingAction): string | undefined {
  if (pending.actionType !== "create_content_brief" || !pending.payload) return undefined;
  const payload = pending.payload as Partial<CreateContentBriefPayload>;
  return typeof payload.recommendationId === "string" ? payload.recommendationId : undefined;
}

/** How many of the most recent agent runs `listPendingActionsByRecommendationId`
 *  below will inspect. There is no `GET`-all-pending-actions route (the
 *  backend's own API surface only ever returns pending actions nested under
 *  one run, `GET /agent-runs/:id`) — surfacing "wherever a pending action
 *  appears" on the Opportunities/Recommendations screens therefore means
 *  fetching each candidate run's detail and reading its `pendingActions`
 *  back out, one request per run. This cap bounds that fan-out to a small,
 *  recent window rather than every run this brand has ever triggered.
 *  Documented as a known limitation in this epic's frontend completion doc. */
const PENDING_ACTION_SCAN_LIMIT = 10;

/**
 * Builds a `recommendationId -> { pendingAction, agentRunId }` map for every
 * still-`pending` `create_content_brief` action among this brand's most
 * recent agent runs, so `recommendation-card.tsx`/`opportunity-card.tsx`
 * can show the one-click approval inline without a separate "approval
 * inbox" screen (per this epic's UI-surface requirement — "surfaced inline
 * wherever a pending action appears... rather than building a separate
 * approval inbox").
 *
 * Only autonomy-level-3 runs are ever fetched in detail — a pending action
 * is created only when `autonomy_level >= 3` (`lib/agents/runner.ts`), so
 * lower-autonomy runs are skipped without a request. Deliberately not
 * additionally filtered to `status === 'completed'`: the runner persists
 * the `agent_pending_actions` row as soon as it processes the
 * `action_required` event, which can land a moment before the run's own
 * `agent_runs.status` flips to `completed` — excluding `running` rows would
 * create a real (if narrow) window where a just-created pending action
 * fails to show up here. A run detail fetch that fails (e.g. a run that
 * aged out) is swallowed rather than failing the whole screen — this is a
 * best-effort inline surface, not this screen's primary data.
 */
export async function listPendingActionsByRecommendationId(): Promise<Map<string, { pendingAction: AgentPendingAction; agentRunId: string }>> {
  const map = new Map<string, { pendingAction: AgentPendingAction; agentRunId: string }>();
  const runs = await listAgentRuns();
  const candidates = runs.filter((r) => r.autonomyLevel === 3).slice(0, PENDING_ACTION_SCAN_LIMIT);

  const details = await Promise.all(
    candidates.map((run) =>
      getAgentRun(run.id).catch(() => null),
    ),
  );

  for (const detail of details) {
    if (!detail) continue;
    for (const pending of detail.pendingActions) {
      if (pending.status !== "pending") continue;
      const recommendationId = pendingActionRecommendationId(pending);
      if (recommendationId) map.set(recommendationId, { pendingAction: pending, agentRunId: detail.id });
    }
  }

  return map;
}
