import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  query_sets: { findFirst: vi.fn() },
  queries: { findMany: vi.fn() },
  subscriptions: { findUnique: vi.fn() },
  ai_runs: { create: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(), update: vi.fn() },
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
  query_sets: db.query_sets,
  queries: db.queries,
  subscriptions: db.subscriptions,
  ai_runs: db.ai_runs,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

// The route schedules the real pipeline via setImmediate — mocked out here
// so route tests assert ONLY the PREPARE/QUEUE invariants (entitlement
// checked and the ai_runs row exists BEFORE any provider is called), not
// EXECUTE/AGGREGATE itself (covered by lib/ai-visibility/pipeline.test.ts).
const runAiVisibilityRun = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/ai-visibility/pipeline.js', () => ({ runAiVisibilityRun }));

async function buildApp() {
  const { default: aiRuns } = await import('./ai-runs.js');
  const app = new Hono();
  app.route('/ai-runs', aiRuns);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme' };
const ACTIVE_QUERY_SET = { id: 'qs-1', organization_id: 'org-1', brand_id: 'brand-1', status: 'active' };
const QUERIES = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.query_sets.findFirst.mockResolvedValue(ACTIVE_QUERY_SET);
  db.queries.findMany.mockResolvedValue(QUERIES);
  db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' }); // ai_queries_per_month: 50
  db.ai_runs.aggregate.mockResolvedValue({ _sum: { total_jobs: 0 } });
});

describe('POST /brands/me/ai-runs', () => {
  it('403s for a viewer (below run_ai_analysis)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
  });

  it('404s when the org has no brand profile', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('404s when the brand has no active query set', async () => {
    db.query_sets.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('no_active_query_set');
  });

  it('422s when the active query set has no queries', async () => {
    db.queries.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it(
    '402s with a specific entitlement error when the run would exceed the plan\'s monthly AI-query limit — ' +
      'BEFORE the ai_runs row is created or any provider is called',
    async () => {
      // free plan: ai_queries_per_month = 50. 3 queries x 4 providers = 12
      // requested; 45 already used this month -> 45 + 12 > 50, rejected.
      db.ai_runs.aggregate.mockResolvedValue({ _sum: { total_jobs: 45 } });

      const app = await buildApp();
      const res = await app.request('/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

      expect(res.status).toBe(402);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('ai_query_limit_reached');
      expect(body.limit).toBe(50);
      expect(body.current).toBe(45);
      expect(body.requested).toBe(12);

      expect(db.ai_runs.create).not.toHaveBeenCalled();
      expect(runAiVisibilityRun).not.toHaveBeenCalled();
    },
  );

  it(
    'creates a queued ai_runs row fanned out to all 4 cloud providers (never Ollama) BEFORE scheduling the ' +
      'background pipeline, writes an audit event, and returns 202',
    async () => {
      const callOrder: string[] = [];
      db.ai_runs.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        callOrder.push('db.create');
        return {
          id: 'run-1',
          ...data,
          completed_jobs: 0,
          failed_jobs: 0,
          ai_visibility_score: null,
          scoring_formula_version: null,
          mention_score: null,
          recommendation_score: null,
          position_score: null,
          coverage_score: null,
          error: null,
          started_at: null,
          completed_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
      });
      runAiVisibilityRun.mockImplementation(async () => {
        callOrder.push('runAiVisibilityRun');
      });

      const app = await buildApp();
      const res = await app.request('/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

      expect(res.status).toBe(202);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id: 'run-1',
        status: 'queued',
        providers: ['openai', 'anthropic', 'google', 'perplexity'],
        totalJobs: 12, // 3 queries x 4 providers
      });

      expect(db.ai_runs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: 'org-1',
            brand_id: 'brand-1',
            query_set_id: 'qs-1',
            providers: ['openai', 'anthropic', 'google', 'perplexity'],
            status: 'queued',
            total_jobs: 12,
            created_by: 'user-1',
          }),
        }),
      );
      expect(db.audit_events.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ai_run.created' }) }),
      );

      await new Promise((resolve) => setImmediate(resolve));
      expect(runAiVisibilityRun).toHaveBeenCalledWith('run-1', 'org-1', 'brand-1');

      // The literal invariant (end-to-end flow step 1's mirror on the
      // success path): the DB row was created before the background
      // pipeline (and therefore before any provider call) ever ran.
      expect(callOrder).toEqual(['db.create', 'runAiVisibilityRun']);
    },
  );

  it("marks the run failed if the background pipeline throws unexpectedly", async () => {
    db.ai_runs.create.mockResolvedValue({
      id: 'run-2',
      organization_id: 'org-1',
      brand_id: 'brand-1',
      query_set_id: 'qs-1',
      providers: ['openai', 'anthropic', 'google', 'perplexity'],
      status: 'queued',
      total_jobs: 12,
      completed_jobs: 0,
      failed_jobs: 0,
      ai_visibility_score: null,
      scoring_formula_version: null,
      mention_score: null,
      recommendation_score: null,
      position_score: null,
      coverage_score: null,
      error: null,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    runAiVisibilityRun.mockRejectedValue(new Error('boom'));

    const app = await buildApp();
    const res = await app.request('/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(202);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.ai_runs.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-2' },
        data: expect.objectContaining({ status: 'failed', error: expect.stringContaining('boom') }),
      }),
    );
  });
});

describe('GET /brands/me/ai-runs', () => {
  it('lists the brand\'s runs newest first', async () => {
    db.ai_runs.findMany.mockResolvedValue([
      {
        id: 'run-1',
        brand_id: 'brand-1',
        query_set_id: 'qs-1',
        providers: ['openai', 'anthropic', 'google', 'perplexity'],
        status: 'completed',
        total_jobs: 12,
        completed_jobs: 12,
        failed_jobs: 0,
        ai_visibility_score: 60.5,
        scoring_formula_version: '1.0',
        error: null,
        started_at: new Date(),
        completed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const app = await buildApp();
    const res = await app.request('/ai-runs', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'run-1', aiVisibilityScore: 60.5, progressPct: 100 });
  });
});
