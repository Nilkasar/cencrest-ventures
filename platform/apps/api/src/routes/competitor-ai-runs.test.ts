import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  competitors: { findFirst: vi.fn() },
  query_sets: { findFirst: vi.fn() },
  queries: { findMany: vi.fn() },
  subscriptions: { findUnique: vi.fn() },
  ai_runs: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), update: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  competitors: db.competitors,
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

const runAiVisibilityRun = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/ai-visibility/pipeline.js', () => ({ runAiVisibilityRun }));

async function buildApp() {
  const { default: competitorAiRuns } = await import('./competitor-ai-runs.js');
  const app = new Hono();
  app.route('/competitors', competitorAiRuns);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme' };
const COMPETITOR = { id: 'competitor-1', organization_id: 'org-1', brand_id: 'brand-1', name: 'Rival Inc', deleted_at: null };
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
  db.competitors.findFirst.mockResolvedValue(COMPETITOR);
  db.query_sets.findFirst.mockResolvedValue(ACTIVE_QUERY_SET);
  db.queries.findMany.mockResolvedValue(QUERIES);
  db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' }); // competitors_tracked: 2, ai_queries_per_month: 50
  db.ai_runs.count.mockResolvedValue(0); // not yet tracked -> first-time entitlement check applies
  db.ai_runs.findMany.mockResolvedValue([]); // no competitors actively tracked yet (countTrackedCompetitors)
  db.ai_runs.aggregate.mockResolvedValue({ _sum: { total_jobs: 0 } });
});

describe('POST /competitors/:competitorId/ai-runs', () => {
  it('404s when the competitor does not belong to this brand/org', async () => {
    db.competitors.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/competitors/competitor-1/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: 'Competitor not found' });
  });

  it('403s for a viewer (below run_ai_analysis)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/competitors/competitor-1/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
  });

  it('404s when the brand has no active query set', async () => {
    db.query_sets.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/competitors/competitor-1/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
    expect((await res.json() as Record<string, unknown>).error).toBe('no_active_query_set');
  });

  it(
    "402s with 'competitor_tracking_limit_reached' when a NEW competitor would exceed the plan's active-tracking cap " +
      '— BEFORE the ai_runs row is created or any provider is called',
    async () => {
      // free plan: competitors_tracked = 2. Already 2 distinct competitors
      // actively tracked, and this one (competitor-1) is not among them yet.
      db.ai_runs.count.mockResolvedValue(0); // this competitor has never been run
      db.ai_runs.findMany.mockResolvedValue([{ competitor_id: 'other-1' }, { competitor_id: 'other-2' }]);

      const app = await buildApp();
      const res = await app.request('/competitors/competitor-1/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

      expect(res.status).toBe(402);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('competitor_tracking_limit_reached');
      expect(body.limit).toBe(2);
      expect(body.current).toBe(2);
      expect(db.ai_runs.create).not.toHaveBeenCalled();
    },
  );

  it('does NOT re-check the tracking cap for a competitor that has already been run before (re-measurement is always allowed)', async () => {
    db.ai_runs.count.mockResolvedValue(3); // this competitor already has 3 prior runs
    db.ai_runs.findMany.mockResolvedValue([{ competitor_id: 'a' }, { competitor_id: 'b' }, { competitor_id: 'c' }]); // already over cap org-wide
    db.ai_runs.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
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
    }));

    const app = await buildApp();
    const res = await app.request('/competitors/competitor-1/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

    expect(res.status).toBe(202);
    expect(db.ai_runs.create).toHaveBeenCalled();
  });

  it('creates a queued, competitor-scoped ai_runs row and schedules the pipeline, returning 202', async () => {
    db.ai_runs.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
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
    }));

    const app = await buildApp();
    const res = await app.request('/competitors/competitor-1/ai-runs', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'run-1', competitorId: 'competitor-1', status: 'queued', totalJobs: 12 });

    expect(db.ai_runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ brand_id: 'brand-1', competitor_id: 'competitor-1', query_set_id: 'qs-1' }),
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'competitor_ai_run.created' }) }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(runAiVisibilityRun).toHaveBeenCalledWith('run-1', 'org-1', 'brand-1');
  });
});

describe('GET /competitors/:competitorId/ai-runs', () => {
  it('lists only this competitor\'s runs', async () => {
    db.ai_runs.findMany.mockResolvedValue([
      {
        id: 'run-1',
        brand_id: 'brand-1',
        competitor_id: 'competitor-1',
        query_set_id: 'qs-1',
        providers: ['openai', 'anthropic', 'google', 'perplexity'],
        status: 'completed',
        total_jobs: 12,
        completed_jobs: 12,
        failed_jobs: 0,
        ai_visibility_score: 45.2,
        scoring_formula_version: '1.0',
        error: null,
        started_at: new Date(),
        completed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const app = await buildApp();
    const res = await app.request('/competitors/competitor-1/ai-runs', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'run-1', competitorId: 'competitor-1', aiVisibilityScore: 45.2 });
  });
});
