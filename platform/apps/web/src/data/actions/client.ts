import { apiClient, ApiError } from "@/lib/api-client";
import { getAgentRun, listAgentRuns } from "@/data/agents/client";
import type { AgentPendingAction } from "@/data/agents/types";
import type { ActionsOverview, ApproveActionResult, ExecuteActionResult, RollbackActionResult } from "./types";

/**
 * Epic 13 (Action Center & Controlled Publishing)'s data-access seam — same
 * role `data/content/client.ts`/`data/agents/client.ts` play for Epics
 * 11/12. Every screen calls through here, never `apiClient` directly. Calls
 * `platform/apps/api`'s real, tested routes from the first line, no fixture
 * layer:
 *
 *   GET  /api/brands/me/actions   -> getActionsOverview()
 *   POST /api/actions/:id/approve -> approveAction()
 *   POST /api/actions/:id/execute -> executeAction()
 *   POST /api/actions/:id/rollback -> rollbackAction()
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

/** A foreign/deleted action id — never a 403 that would confirm existence
 *  (tenant isolation), same flat-404 convention `action-details.ts`'s own
 *  `NOT_FOUND_ERROR` documents for every one of its three routes. */
export class ActionNotFoundError extends Error {
  constructor(message = "That action couldn't be found.") {
    super(message);
    this.name = "ActionNotFoundError";
  }
}

/** `POST .../execute` 409 `not_approved` — the HTTP surface of this epic's
 *  own non-negotiable ("no code path exists that publishes without a prior
 *  approved_at"). Reachable in practice by calling execute before approve
 *  succeeds, which this UI's own flow never does, but a real, named error
 *  regardless of how it's reached. */
export class ActionNotApprovedError extends Error {
  constructor(message = "This action hasn't been approved yet. Approve it before executing.") {
    super(message);
    this.name = "ActionNotApprovedError";
  }
}

/** `POST .../rollback` 409 `not_executed`. */
export class ActionNotExecutedError extends Error {
  constructor(message = "This action hasn't been executed yet — there's nothing to roll back.") {
    super(message);
    this.name = "ActionNotExecutedError";
  }
}

/** `POST .../rollback` 409 `rollback_window_expired` — the real, tested
 *  30-day check (`lib/actions/rollback-window.ts`), never silently allowed
 *  past the deadline. Distinguished from `ActionNotExecutedError` above so
 *  the UI can show a specific reason, not a generic failure. */
export class RollbackWindowExpiredError extends Error {
  constructor(message = "The 30-day rollback window for this action has expired.") {
    super(message);
    this.name = "RollbackWindowExpiredError";
  }
}

/** `POST .../approve` or `.../execute` 422 `autonomy_level_rejected` — the
 *  HTTP surface of this epic's own defense-in-depth Level 4 block
 *  (`routes/action-details.ts`'s guard clause, evaluated even against a
 *  manually-approved row). Unreachable from this UI's own controls — no
 *  button here ever targets a Level 4 action (`action-card.tsx`) — only
 *  from a hostile/malformed request or a legitimately-4 row surfaced by
 *  some other path. */
export class ActionAutonomyLevelRejectedError extends Error {
  constructor(message = "Level 4 (fully autonomous) actions can never be approved or executed.") {
    super(message);
    this.name = "ActionAutonomyLevelRejectedError";
  }
}

/** `GET /brands/me/actions`'s four literal sections. A 404 (no brand
 *  profile yet) degrades to an all-empty overview — same "let the empty
 *  state carry it" precedent `listContentBriefs`/`listAgentRuns` use for
 *  the same situation. */
export async function getActionsOverview(): Promise<ActionsOverview> {
  try {
    return await apiClient.get<ActionsOverview>("/brands/me/actions");
  } catch (err) {
    if (isNotFound(err)) return { pending: [], inProgress: [], completed: [], rolledBack: [] };
    throw err;
  }
}

function translateActionError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 404) throw new ActionNotFoundError();
    if (err.status === 422 && errorCode(err) === "autonomy_level_rejected") {
      throw new ActionAutonomyLevelRejectedError(errorMessage(err));
    }
  }
  throw err;
}

/** `owner`/`admin`-only server-side (`publish_content` permission — this
 *  epic's own task brief, verbatim: "owner/admin-only approve action per
 *  docs/08-security/SECURITY.md"). A 403 is surfaced as-is, same convention
 *  `approveDraft` (`data/content/client.ts`) documents; there is no
 *  client-side role gate that pre-empts it, only a UI hint
 *  (`actions-view.tsx`'s `canPublish`). Idempotent: approving an
 *  already-approved action returns `alreadyApproved: true` rather than
 *  erroring or duplicating. Sets `approved_by`/`approved_at` from the real
 *  authenticated caller entirely server-side — this function sends no body
 *  that could override either. */
export async function approveAction(id: string): Promise<ApproveActionResult> {
  try {
    return await apiClient.post<ApproveActionResult>(`/actions/${id}/approve`);
  } catch (err) {
    translateActionError(err);
  }
}

/** Deliberately separate from approve (spec, verbatim: "a human might
 *  approve now and the system executes async") — this is the one and only
 *  call in this frontend that can ever create a `published_content` row.
 *  Rejects 409 `not_approved` (`ActionNotApprovedError`) and 422
 *  `autonomy_level_rejected` (`ActionAutonomyLevelRejectedError`, checked
 *  server-side even against a manually-approved Level 4 row) — both real
 *  server-side guard clauses this function only surfaces, never
 *  re-implements or pre-empts. */
export async function executeAction(id: string): Promise<ExecuteActionResult> {
  try {
    return await apiClient.post<ExecuteActionResult>(`/actions/${id}/execute`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && errorCode(err) === "not_approved") {
      throw new ActionNotApprovedError(errorMessage(err));
    }
    translateActionError(err);
  }
}

/** Reverts `published_content`'s status within the real, server-enforced
 *  30-day window (measured from `executed_at`). Rejects 409 `not_executed`
 *  / `rollback_window_expired` as their own typed errors so the UI can show
 *  a specific reason, never a generic failure — matching this epic's own
 *  DoD requirement ("rollback attempted after 30 days -> confirm it's
 *  rejected with a specific error, not silently allowed"). */
export async function rollbackAction(id: string): Promise<RollbackActionResult> {
  try {
    return await apiClient.post<RollbackActionResult>(`/actions/${id}/rollback`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const code = errorCode(err);
      if (code === "not_executed") throw new ActionNotExecutedError(errorMessage(err));
      if (code === "rollback_window_expired") throw new RollbackWindowExpiredError(errorMessage(err));
    }
    translateActionError(err);
  }
}

/** How many of the most recent Level-3 agent runs to scan when resolving an
 *  agent-originated action's `agentPendingActionId` back to the
 *  `agentRunId` it belongs to. Same bounded-scan precedent, same limit, as
 *  `listPendingActionsByRecommendationId` (`data/agents/client.ts`)
 *  documents in full: there is no `GET /agent-pending-actions/:id` route
 *  anywhere in this codebase, and `actions` itself carries no
 *  `agent_run_id` column — only `agent_pending_action_id`
 *  (`packages/database/prisma/schema.prisma`) — so the only way to resolve
 *  one id to the other is reading every candidate run's own full detail
 *  (`GET /agent-runs/:id`, the only route that ever returns a pending
 *  action at all). */
const AGENT_RUN_SCAN_LIMIT = 10;

/**
 * Builds an `agentPendingActionId -> agentRunId` map (to link straight to
 * `/agents/:id`, Epic 12's live run view) AND an `agentPendingActionId ->
 * AgentPendingAction` map (the pending action's own `title`/`description` —
 * the same fields `pending-action-panel.tsx` already shows inline elsewhere
 * in this app) for every id in `pendingActionIds`. Both come off the exact
 * same scan — `GET /agent-runs/:id` already returns each run's full
 * `pendingActions` array, not just ids — so surfacing the second map costs
 * no extra request; it was previously being fetched and discarded here.
 * This is `action-origin.tsx`'s own literal UI requirement: "pending
 * approvals with the underlying recommendation/draft visible inline, not
 * just a title" applies just as much to an agent-originated action as a
 * content-draft-originated one.
 *
 * Best-effort and bounded, same documented limitation as the Epic 12
 * precedent this mirrors: only the `AGENT_RUN_SCAN_LIMIT` most recent
 * Level-3 runs are scanned (the only runs that could possibly have
 * produced a pending action at all — a lower-autonomy run never does,
 * `lib/agents/runner.ts`), so an action whose originating pending action
 * falls outside that window resolves to no entry in either returned map
 * rather than growing this into an unbounded fetch. Called with an empty
 * array short-circuits to empty maps without any request.
 */
export async function agentRunIdsByPendingActionId(
  pendingActionIds: string[],
): Promise<{ runIds: Map<string, string>; pendingActions: Map<string, AgentPendingAction> }> {
  const runIds = new Map<string, string>();
  const pendingActions = new Map<string, AgentPendingAction>();
  if (pendingActionIds.length === 0) return { runIds, pendingActions };
  const wanted = new Set(pendingActionIds);

  const runs = await listAgentRuns();
  const candidates = runs.filter((r) => r.autonomyLevel === 3).slice(0, AGENT_RUN_SCAN_LIMIT);

  const details = await Promise.all(candidates.map((run) => getAgentRun(run.id).catch(() => null)));
  for (const detail of details) {
    if (!detail) continue;
    for (const pending of detail.pendingActions) {
      if (wanted.has(pending.id)) {
        runIds.set(pending.id, detail.id);
        pendingActions.set(pending.id, pending);
      }
    }
  }
  return { runIds, pendingActions };
}
