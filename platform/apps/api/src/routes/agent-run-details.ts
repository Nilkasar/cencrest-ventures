/**
 * Epic 12 — `GET /agent-runs/:id` (status + full event stream, spec's
 * literal API surface) and `POST /agent-runs/:id/approve` (Level 3 actions
 * only, audit-logged, spec's literal API surface). An `agent_runs` row is
 * addressed by its own id, not a brand's — same precedent
 * `/api/ai-runs/:id`/`/api/crawl-jobs/:id` already set for exactly this
 * "id-addressed sibling of a brand-scoped list route" shape.
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
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
agentRunDetailsRoute.get('/:id', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const run = await getAgentRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  const [events, pendingActions] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.agent_events.findMany({ where: { agent_run_id: run.id, organization_id: org.organizationId }, orderBy: { created_at: 'asc' } }),
      tx.agent_pending_actions.findMany({ where: { agent_run_id: run.id, organization_id: org.organizationId }, orderBy: { created_at: 'asc' } }),
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
agentRunDetailsRoute.post('/:id/approve', requireAuth, requireOrgFromToken('viewer'), requirePermission(APPROVE), async (c) => {
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

  // `agent.action` — SECURITY.md's `ALWAYS_AUDITED_ACTIONS` vocabulary,
  // reused verbatim rather than inventing a new action string (lib/audit.ts).
  await writeManualAuditEvent(c, { action: 'agent.action', entityType: 'agent_pending_action', entityId: updated.id });

  return c.json(serializeAgentPendingAction(updated));
});

export default agentRunDetailsRoute;
