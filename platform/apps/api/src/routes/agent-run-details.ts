/**
 * Epic 12 — `GET /agent-runs/:id` (status + full event stream, spec's
 * literal API surface) and `POST /agent-runs/:id/approve` (Level 3 actions
 * only, audit-logged, spec's literal API surface). An `agent_runs` row is
 * addressed by its own id, not a brand's — same precedent
 * `/api/ai-runs/:id`/`/api/crawl-jobs/:id` already set for exactly this
 * "id-addressed sibling of a brand-scoped list route" shape.
 *
 * Epic 13 (Action Center & Controlled Publishing) addition: right after a
 * pending action is approved here, this route also creates the pending
 * `actions` row that hands it off to Epic 13's own approve -> execute ->
 * rollback lifecycle (`actions.agent_pending_action_id`, a real FK). This
 * epic's own spec line ("a Level-3-approved agent action... becomes an
 * actions row, status: pending") is read as naming exactly this event —
 * `agent_pending_actions.status` flipping to `'approved'` IS what
 * "Level-3-approved" means. See `@bebest/database` DECISIONS.md §27's
 * "Handoff wiring" section for the full reasoning, including why this
 * still does not execute/publish anything (unchanged from this route's own
 * original scope, see the approve handler's own comment below).
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { serializeAgentEvent, serializeAgentPendingAction, serializeAgentRun } from '../lib/agents/serialize.js';
import type { AppEnv } from '../types/context.js';

const agentRunDetailsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
// Same permission `routes/agents.ts` requires to TRIGGER a run — approving
// one of its proposed actions is the same class of privileged decision.
const APPROVE = 'autonomous_actions' as const;

const NOT_FOUND_ERROR = { error: 'Agent run not found' } as const;

/** Same belt-and-suspenders scoping (`withOrgContext` RLS + explicit WHERE)
 * as every other id-addressed route in this codebase — a foreign id 404s,
 * never a 403 that would confirm it exists (tenant isolation). */
async function getAgentRun(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.agent_runs.findFirst({ where: { id, organization_id: organizationId } }));
}

// ── GET /:id — status + the full append-only event log, plus any pending
// Level-3 actions this run produced. This IS the "customers can see what
// the agent did, step-by-step" transparency AGENT_ARCHITECTURE.md calls a
// trust differentiator. ────────────────────────────────────────────────
agentRunDetailsRoute.get('/:id', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const run = await getAgentRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  // Epic 19 (Production Hardening), item 6 — capped server-side. This is
  // the "full append-only event log" transparency view this route's own
  // header comment promises, for a SINGLE bounded agent run (not a
  // collection that grows across an org's lifetime the way `agent_runs`
  // itself does — see routes/agents.ts's GET / list), so the cap here is a
  // generous technical safety ceiling, not a page size meant to bite in
  // normal use.
  const [events, pendingActions] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.agent_events.findMany({ where: { agent_run_id: run.id, organization_id: org.organizationId }, orderBy: { created_at: 'asc' }, take: 1000 }),
      tx.agent_pending_actions.findMany({ where: { agent_run_id: run.id, organization_id: org.organizationId }, orderBy: { created_at: 'asc' }, take: 1000 }),
    ]),
  );

  return c.json({
    ...serializeAgentRun(run),
    events: events.map(serializeAgentEvent),
    pendingActions: pendingActions.map(serializeAgentPendingAction),
  });
});

const NO_PENDING_ACTION_ERROR = {
  error: 'no_pending_action',
  message: 'This run has no pending action awaiting approval.',
} as const;

// ── POST /:id/approve — the one-click approval this epic's Level 3
// mechanics require. Audit-logged (`agent.action` is on SECURITY.md's
// ALWAYS_AUDITED_ACTIONS list — see lib/audit.ts). Sets a 30-day rollback
// window; NEVER executes/publishes anything — this epic stops at
// "approved, ready for Epic 13 to execute" (its own explicit brief). ─────
agentRunDetailsRoute.post('/:id/approve', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(APPROVE), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const run = await getAgentRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  const pending = await withOrgContext(org.organizationId, (tx) =>
    tx.agent_pending_actions.findFirst({
      where: { agent_run_id: run.id, organization_id: org.organizationId, status: 'pending' },
      orderBy: { created_at: 'asc' },
    }),
  );
  if (!pending) return c.json(NO_PENDING_ACTION_ERROR, 404);

  const now = new Date();
  const rollbackUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const updated = await withOrgContext(org.organizationId, (tx) =>
    tx.agent_pending_actions.update({
      where: { id: pending.id },
      data: { status: 'approved', approved_by: user.id, approved_at: now, rollback_until: rollbackUntil },
    }),
  );

  // Epic 13 handoff — real FK (`agent_pending_action_id`), never a
  // re-typed copy of this row's own fields. Not itself audit-logged: the
  // privileged decision it follows (`agent.action`, just below) already
  // is, and this is bookkeeping for that same decision, not a second one.
  // Still does not execute/publish anything — this route's own original
  // scope (see this file's header comment) is unchanged: it creates a
  // `pending` Action Center entry, nothing more.
  await withOrgContext(org.organizationId, (tx) =>
    tx.actions.create({
      data: {
        organization_id: org.organizationId,
        brand_id: run.brand_id,
        action_type: updated.action_type,
        title: updated.title,
        description: updated.description,
        status: 'pending',
        autonomy_level: run.autonomy_level,
        agent_pending_action_id: updated.id,
        created_by: user.id,
      },
    }),
  );

  // `agent.action` — SECURITY.md's `ALWAYS_AUDITED_ACTIONS` vocabulary,
  // reused verbatim rather than inventing a new action string (lib/audit.ts).
  await writeManualAuditEvent(c, { action: 'agent.action', entityType: 'agent_pending_action', entityId: updated.id });

  return c.json(serializeAgentPendingAction(updated));
});

export default agentRunDetailsRoute;
