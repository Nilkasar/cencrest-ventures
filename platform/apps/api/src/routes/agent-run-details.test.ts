import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  agent_runs: { findFirst: vi.fn() },
  agent_events: { findMany: vi.fn() },
  agent_pending_actions: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  // Epic 13 (Action Center & Controlled Publishing) — the pending `actions`
  // handoff row this route's approve handler now also creates.
  actions: { create: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};
const tx = {
  // writeAuditEvent runs org-attributed writes inside withOrgContext now
  // (see lib/audit.ts), so the transaction client exposes audit_events.
  audit_events: db.audit_events,
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  agent_runs: db.agent_runs,
  agent_events: db.agent_events,
  agent_pending_actions: db.agent_pending_actions,
  actions: db.actions,
};
vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: agentRunDetails } = await import('./agent-run-details.js');
  const app = new Hono();
  app.route('/agent-runs', agentRunDetails);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const RUN = {
  id: 'run-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  agent_name: 'geo_agent',
  agent_version: '1.0.0',
  status: 'completed',
  triggered_by: 'user',
  triggered_by_id: 'user-1',
  autonomy_level: 3,
  steps_completed: 5,
  total_steps: 5,
  tokens_used: 0,
  latency_ms: 1200,
  result_id: 'rec-1',
  error: null,
  started_at: new Date(),
  completed_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
};

const PENDING_ACTION = {
  id: 'pending-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  agent_run_id: 'run-1',
  agent_event_id: 'event-1',
  action_type: 'create_content_brief',
  title: 'Approve content brief',
  description: 'desc',
  payload: { recommendationId: 'rec-1' },
  status: 'pending',
  approved_by: null,
  approved_at: null,
  rollback_until: null,
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
  db.agent_runs.findFirst.mockResolvedValue(RUN);
  db.agent_events.findMany.mockResolvedValue([]);
  db.agent_pending_actions.findMany.mockResolvedValue([PENDING_ACTION]);
  db.agent_pending_actions.findFirst.mockResolvedValue(PENDING_ACTION);
  db.agent_pending_actions.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...PENDING_ACTION, ...data }));
  db.actions.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'action-1', created_at: new Date(), updated_at: new Date(), ...data }));
});

describe('GET /agent-runs/:id', () => {
  it('404s (not a leaking 403) for a run belonging to a different organization — tenant isolation', async () => {
    db.agent_runs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/agent-runs/run-1', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);

    // The lookup itself is org-scoped — a foreign org's run row can never
    // be returned even if the mock were misconfigured to ignore the WHERE.
    expect(db.agent_runs.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'run-1', organization_id: 'org-1' }) }));
  });

  it('returns the run plus its full append-only event log and any pending actions', async () => {
    db.agent_events.findMany.mockResolvedValue([
      { id: 'e1', agent_run_id: 'run-1', type: 'progress', message: 'step 1', step: 1, total_steps: 5, evidence: null, payload: null, created_at: new Date() },
    ]);
    const app = await buildApp();
    const res = await app.request('/agent-runs/run-1', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'run-1', status: 'completed', autonomyLevel: 3 });
    expect(body.events).toHaveLength(1);
    expect(body.pendingActions).toHaveLength(1);
  });
});

describe('POST /agent-runs/:id/approve', () => {
  it('404s for a run in a different organization — tenant isolation', async () => {
    db.agent_runs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/agent-runs/run-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('403s for a viewer (autonomous_actions is owner/admin only)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/agent-runs/run-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
    expect(db.agent_pending_actions.update).not.toHaveBeenCalled();
  });

  it('404s when the run has no pending action awaiting approval', async () => {
    db.agent_pending_actions.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/agent-runs/run-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('no_pending_action');
  });

  it('flips status to approved, sets approved_by/approved_at, and sets rollback_until 30 days out — and audit-logs it', async () => {
    const app = await buildApp();
    const before = Date.now();
    const res = await app.request('/agent-runs/run-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('approved');
    expect(body.approvedBy).toBe('user-1');
    expect(body.approvedAt).toBeTruthy();
    expect(body.rollbackUntil).toBeTruthy();

    const rollbackMs = new Date(body.rollbackUntil as string).getTime();
    const approvedMs = new Date(body.approvedAt as string).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(rollbackMs - approvedMs).toBe(thirtyDaysMs);
    expect(approvedMs).toBeGreaterThanOrEqual(before);

    expect(db.agent_pending_actions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pending-1' },
        data: expect.objectContaining({ status: 'approved', approved_by: 'user-1' }),
      }),
    );

    // `agent.action` — SECURITY.md's ALWAYS_AUDITED_ACTIONS vocabulary.
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'agent.action', entity_type: 'agent_pending_action', entity_id: 'pending-1' }) }),
    );

    // Epic 13 (Action Center & Controlled Publishing) handoff — a real FK
    // to this pending action, never a re-typed copy, status starts at
    // 'pending' (a SEPARATE approval gate at the Action Center layer,
    // still required before anything executes — see routes/
    // action-details.ts). Not itself audit-logged (the privileged decision
    // it follows, `agent.action` above, already is).
    expect(db.actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 'org-1',
          brand_id: 'brand-1',
          agent_pending_action_id: 'pending-1',
          status: 'pending',
          autonomy_level: 3,
        }),
      }),
    );
    const handoffCall = db.actions.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(handoffCall.data.content_draft_id).toBeUndefined();
    expect(db.audit_events.create).toHaveBeenCalledTimes(1); // still just the one 'agent.action' event
  });

  it('never publishes/executes anything — approval only ever calls agent_pending_actions.update (plus the Epic 13 pending-actions handoff create), no publish/content-draft/execute call exists in this route', async () => {
    const app = await buildApp();
    await app.request('/agent-runs/run-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

    // The only mutations this route performs at all are the pending-action
    // update and the Epic 13 handoff create above — no OTHER table's
    // `.update()`/`.create()` is touched, and even the handoff create only
    // ever creates a `pending` Action Center entry (never anything
    // publish/execute-shaped) — proving this epic still stops at
    // "approved," Epic 13's own execute is a separate, later call this
    // route never makes.
    const mutatedTables = Object.entries(tx)
      .filter(([, model]) => 'update' in model || 'create' in model)
      .filter(([name]) => name !== 'agent_pending_actions' && name !== 'audit_events' && name !== 'actions');
    for (const [, model] of mutatedTables) {
      if ('update' in model) expect(model.update).not.toHaveBeenCalled();
    }
    expect(db.actions.create).toHaveBeenCalledTimes(1);
    const createCall = db.actions.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(createCall.data.status).toBe('pending');
    expect(createCall.data).not.toHaveProperty('executed_at');
    expect(createCall.data).not.toHaveProperty('approved_at');
  });
});
