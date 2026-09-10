import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  agent_runs: { findMany: vi.fn() },
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
  brands: db.brands,
  agent_runs: db.agent_runs,
};
vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

const triggerAgentRun = vi.fn();
vi.mock('../lib/agents/runner.js', () => ({ triggerAgentRun: (...args: unknown[]) => triggerAgentRun(...args) }));

async function buildApp() {
  const { default: agents } = await import('./agents.js');
  const app = new Hono();
  app.route('/agents', agents);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme' };
const FAKE_RUN = {
  id: 'run-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  agent_name: 'geo_agent',
  agent_version: '1.0.0',
  status: 'queued',
  triggered_by: 'user',
  triggered_by_id: 'user-1',
  autonomy_level: 1,
  steps_completed: 0,
  total_steps: 0,
  tokens_used: 0,
  latency_ms: null,
  result_id: null,
  error: null,
  started_at: null,
  completed_at: null,
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
  db.brands.findFirst.mockResolvedValue(BRAND);
  triggerAgentRun.mockResolvedValue({ run: FAKE_RUN });
});

describe('POST /brands/me/agents/:agentName/run', () => {
  it('403s for a viewer (autonomous_actions is owner/admin only)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/agents/geo_agent/run', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
    expect(triggerAgentRun).not.toHaveBeenCalled();
  });

  it('404s for an unknown agent name', async () => {
    const app = await buildApp();
    const res = await app.request('/agents/not_a_real_agent/run', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
    expect(triggerAgentRun).not.toHaveBeenCalled();
  });

  it('404s when the org has no brand profile', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/agents/geo_agent/run', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('402s with agents_not_available when the plan lacks the agents feature', async () => {
    triggerAgentRun.mockResolvedValue({ error: 'agents_not_available' });
    const app = await buildApp();
    const res = await app.request('/agents/geo_agent/run', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('agents_not_available');
  });

  it('402s with the typed entitlement error when agent_runs_per_month is exhausted (same pattern as ai_query_limit_reached)', async () => {
    const { EntitlementLimitError } = await import('../lib/entitlements.js');
    triggerAgentRun.mockRejectedValue(new EntitlementLimitError('agent_runs_per_month', 10, 10, 'growth', 'pro'));
    const app = await buildApp();
    const res = await app.request('/agents/geo_agent/run', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('agent_run_limit_reached');
    expect(body.limit).toBe(10);
  });

  it('422s when the requested autonomy level is rejected (e.g. level 4) — the HTTP surface of the hard block', async () => {
    const { AutonomyLevelRejectedError } = await import('../lib/agents/autonomy.js');
    triggerAgentRun.mockRejectedValue(new AutonomyLevelRejectedError(4, 'outside the allowed range'));
    const app = await buildApp();
    const res = await app.request('/agents/geo_agent/run', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ autonomyLevel: 4 }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('autonomy_level_rejected');
  });

  it('202s, passes triggeredBy=user + the caller\'s id, and writes an audit event, on success', async () => {
    const app = await buildApp();
    const res = await app.request('/agents/geo_agent/run', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ autonomyLevel: 2 }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'run-1', agentName: 'geo_agent', status: 'queued' });

    expect(triggerAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        brandId: 'brand-1',
        agentName: 'geo_agent',
        triggeredBy: 'user',
        triggeredById: 'user-1',
        requestedAutonomyLevel: 2,
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'agent_run.created' }) }));
  });
});

describe('GET /brands/me/agents', () => {
  it('lists this brand\'s agent runs, newest first', async () => {
    db.agent_runs.findMany.mockResolvedValue([FAKE_RUN]);
    const app = await buildApp();
    const res = await app.request('/agents', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'run-1', agentName: 'geo_agent' });
  });
});
