import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

let uoRows: Array<Record<string, unknown>> = [];
let ueRows: Array<Record<string, unknown>> = [];
let uoCounter = 0;
let ueCounter = 0;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'in' in (value as Record<string, unknown>)) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  seo_keywords: { findMany: vi.fn() },
  seo_opportunities: { findMany: vi.fn() },
  query_sets: { findFirst: vi.fn() },
  queries: { findMany: vi.fn() },
  competitors: { findMany: vi.fn() },
  ai_runs: { findFirst: vi.fn() },
  brand_observations: { findMany: vi.fn() },
  unified_opportunities: {
    findFirst: vi.fn(async ({ where, include }: { where: Record<string, unknown>; include?: { opportunity_evidence?: unknown } }) => {
      const row = uoRows.find((r) => matches(r, where));
      if (!row) return null;
      if (!include?.opportunity_evidence) return { ...row };
      return { ...row, opportunity_evidence: ueRows.filter((e) => e.opportunity_id === row.id).map((e) => ({ ...e })) };
    }),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const rows = where ? uoRows.filter((r) => matches(r, where)) : uoRows.slice();
      return rows
        .slice()
        .sort((a, b) => Number(b.opportunity_score) - Number(a.opportunity_score))
        .map((r) => ({ ...r }));
    }),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? uoRows.filter((r) => matches(r, where)).length : uoRows.length)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `uo-${++uoCounter}`, created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), dismissal_reason: null, updated_by: null, ...data };
      uoRows.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = uoRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row, opportunity_evidence: ueRows.filter((e) => e.opportunity_id === row.id).map((e) => ({ ...e })) };
    }),
  },
  opportunity_evidence: {
    createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      for (const d of data) ueRows.push({ id: `ue-${++ueCounter}`, created_at: new Date('2026-02-01'), ...d });
      return { count: data.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { opportunity_id: string } }) => {
      const before = ueRows.length;
      ueRows = ueRows.filter((e) => e.opportunity_id !== where.opportunity_id);
      return { count: before - ueRows.length };
    }),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  seo_keywords: db.seo_keywords,
  seo_opportunities: db.seo_opportunities,
  query_sets: db.query_sets,
  queries: db.queries,
  competitors: db.competitors,
  ai_runs: db.ai_runs,
  brand_observations: db.brand_observations,
  unified_opportunities: db.unified_opportunities,
  opportunity_evidence: db.opportunity_evidence,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: opportunities } = await import('./opportunities.js');
  const { default: opportunityDetails } = await import('./opportunity-details.js');
  const app = new Hono();
  app.route('/brands/me/opportunities', opportunities);
  app.route('/opportunities', opportunityDetails);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme', created_at: new Date('2025-01-01') };
const QUERY_SET = { id: 'qs-1', organization_id: 'org-1', brand_id: 'brand-1', status: 'active', deleted_at: null };
const QUERY_TEXT = 'best freight visibility software';
const QUERIES = [{ id: 'q1', text: QUERY_TEXT, intent_type: 'commercial', category: 'category', created_at: new Date('2026-01-01'), deleted_at: null }];
const COMPETITOR = { id: 'competitor-1', organization_id: 'org-1', brand_id: 'brand-1', name: 'CompetitorA', deleted_at: null, created_at: new Date() };

const KEYWORD = {
  id: 'kw-1',
  organization_id: 'org-1',
  keyword_group_id: 'group-1',
  text: QUERY_TEXT,
  intent: 'commercial',
  monthly_volume: 500,
  difficulty: 40,
  confidence: 'estimate',
  source: 'null_provider',
  deleted_at: null,
};

function obs(overrides: Partial<Record<string, unknown>>) {
  return {
    query_id: 'q1',
    brand_mentioned: false,
    brand_recommended: false,
    brand_first_position: null,
    cited_domains: [],
    ...overrides,
  };
}

const BRAND_RUN = {
  id: 'run-brand-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  competitor_id: null,
  query_set_id: 'qs-1',
  providers: ['openai', 'anthropic', 'google', 'perplexity'],
  status: 'completed',
  total_jobs: 4,
  created_at: new Date('2026-01-02'),
  completed_at: new Date('2026-01-02'),
};
const COMPETITOR_RUN = { ...BRAND_RUN, id: 'run-competitor-1', competitor_id: 'competitor-1' };

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  uoRows = [];
  ueRows = [];
  uoCounter = 0;
  ueCounter = 0;

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  // Resolves whatever org id is actually in the caller's token (not a fixed
  // 'org-1' fixture) so a cross-org request in the tenant-isolation test
  // below genuinely resolves a DIFFERENT `org.organizationId`, rather than
  // silently aliasing back to org-1.
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    slug: where.id,
    name: where.id,
    deleted_at: null,
  }));
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.query_sets.findFirst.mockResolvedValue(QUERY_SET);
  db.queries.findMany.mockResolvedValue(QUERIES);
  db.competitors.findMany.mockResolvedValue([COMPETITOR]);
  db.seo_keywords.findMany.mockResolvedValue([KEYWORD]);
  db.seo_opportunities.findMany.mockResolvedValue([]);

  // Brand: 0 of 4 mentioned for q1 (triggers an intent_gap). Competitor: 3
  // of 4 mentioned (75% -> 'high' severity, since >=50%).
  db.ai_runs.findFirst.mockImplementation(async ({ where }: { where: { competitor_id: string | null } }) =>
    where.competitor_id === null ? BRAND_RUN : COMPETITOR_RUN,
  );
  db.brand_observations.findMany.mockImplementation(async ({ where }: { where: { ai_run_id: string } }) =>
    where.ai_run_id === BRAND_RUN.id
      ? [obs({}), obs({}), obs({}), obs({})]
      : [obs({ brand_mentioned: true, brand_first_position: 0.1 }), obs({ brand_mentioned: true, brand_first_position: 0.2 }), obs({ brand_mentioned: true, brand_first_position: 0.3 }), obs({})],
  );
});

describe('POST /brands/me/opportunities/recompute', () => {
  it('404s when the brand has no active query set', async () => {
    db.query_sets.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it(
    'creates exactly one UNIFIED opportunity from fixture SEO+GEO data, scored higher than either signal alone, with evidence citing the specific keyword and AI-response data',
    async () => {
      const app = await buildApp();
      const res = await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { summary: Record<string, number>; opportunities: Array<Record<string, unknown>> };

      expect(body.summary.created).toBe(1);
      expect(body.opportunities).toHaveLength(1);
      expect(uoRows).toHaveLength(1);

      const opp = body.opportunities[0]!;
      expect(opp.type).toBe('unified');
      expect(opp.status).toBe('new');
      expect(opp.seoDemandScore).not.toBeNull();
      expect(opp.geoGapScore).toBe(75);

      expect(ueRows).toHaveLength(2);
      const seoEvidence = ueRows.find((e) => e.source_table === 'seo_keywords')!;
      expect(seoEvidence.source_id).toBe('kw-1');
      expect(seoEvidence.summary).toContain('500 monthly searches');
      const geoEvidence = ueRows.find((e) => e.source_table === 'ai_runs')!;
      expect(geoEvidence.summary).toContain('CompetitorA appears in 75% of responses');
      expect(geoEvidence.summary).toContain('you appear in 0% of responses');
    },
  );

  it('is idempotent: a second consecutive call with unchanged data updates the SAME row in place, never duplicates it', async () => {
    const app = await buildApp();

    const first = await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect((await first.json() as { summary: { created: number } }).summary.created).toBe(1);
    expect(uoRows).toHaveLength(1);
    const idAfterFirst = uoRows[0]!.id;

    const second = await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const secondBody = (await second.json()) as { summary: { created: number; updated: number } };
    expect(secondBody.summary.created).toBe(0);
    expect(secondBody.summary.updated).toBe(1);
    expect(uoRows).toHaveLength(1); // still exactly one row — no duplicate
    expect(uoRows[0]!.id).toBe(idAfterFirst);
  });

  it('does not resurrect a dismissed opportunity when nothing about the underlying signal changed', async () => {
    const app = await buildApp();
    await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const id = uoRows[0]!.id as string;

    const dismissRes = await app.request(`/opportunities/${id}`, {
      method: 'PATCH',
      headers: { ...(await authHeader('user-1', 'org-1')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed', dismissalReason: 'Not a priority this quarter' }),
    });
    expect(dismissRes.status).toBe(200);
    expect(uoRows[0]!.status).toBe('dismissed');
    expect(db.audit_events.create).toHaveBeenCalled();

    const recomputeRes = await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const body = (await recomputeRes.json()) as { summary: Record<string, number> };
    expect(body.summary.skippedDismissed).toBe(1);
    expect(body.summary.reactivated).toBe(0);
    expect(uoRows).toHaveLength(1);
    expect(uoRows[0]!.status).toBe('dismissed'); // still dismissed — did not reappear
  });

  it('reactivates a dismissed opportunity back to "new" when the underlying signal materially changes (brand coverage improves, GEO gap closes)', async () => {
    const app = await buildApp();
    await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const id = uoRows[0]!.id as string;

    await app.request(`/opportunities/${id}`, {
      method: 'PATCH',
      headers: { ...(await authHeader('user-1', 'org-1')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed', dismissalReason: 'later' }),
    });
    expect(uoRows[0]!.status).toBe('dismissed');

    // Brand's coverage improves: now mentioned in 3 of 4 responses for q1 —
    // classifyIntentGaps no longer fires (yourStats.mentionRatePct > 0), so
    // the GEO signal disappears entirely and the type flips seo<->unified.
    db.brand_observations.findMany.mockImplementation(async ({ where }: { where: { ai_run_id: string } }) =>
      where.ai_run_id === BRAND_RUN.id
        ? [obs({ brand_mentioned: true, brand_first_position: 0.1 }), obs({ brand_mentioned: true }), obs({ brand_mentioned: true }), obs({})]
        : [obs({ brand_mentioned: true, brand_first_position: 0.1 }), obs({ brand_mentioned: true }), obs({ brand_mentioned: true }), obs({})],
    );

    const recomputeRes = await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const body = (await recomputeRes.json()) as { summary: Record<string, number>; opportunities: Array<Record<string, unknown>> };
    expect(body.summary.reactivated).toBe(1);
    expect(body.summary.skippedDismissed).toBe(0);
    expect(uoRows).toHaveLength(1);
    expect(uoRows[0]!.status).toBe('new');
    expect(uoRows[0]!.type).toBe('seo'); // GEO signal gone, only SEO remains
    expect(uoRows[0]!.dismissal_reason).toBeNull();
  });
});

describe('GET /brands/me/opportunities', () => {
  it('lists opportunities sorted by opportunity_score desc, filterable by status/type/priority', async () => {
    const app = await buildApp();
    await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

    const res = await app.request('/brands/me/opportunities', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { opportunities: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.opportunities[0]!.type).toBe('unified');
  });
});

describe('GET /opportunities/:id and PATCH /opportunities/:id', () => {
  it('returns full detail with the evidence trail inlined', async () => {
    const app = await buildApp();
    await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const id = uoRows[0]!.id as string;

    const res = await app.request(`/opportunities/${id}`, { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { evidence: unknown[] };
    expect(body.evidence).toHaveLength(2);
  });

  it('404s (not a leaking 403) for an opportunity belonging to a different organization — tenant isolation', async () => {
    const app = await buildApp();
    await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const id = uoRows[0]!.id as string;

    // A different org (user-1 is, for this test, also a legitimate member
    // of org-2 — see beforeEach's `memberships` mock): the route's own
    // `organization_id` WHERE clause is what must reject this, not a
    // membership check.
    const res = await app.request(`/opportunities/${id}`, { headers: await authHeader('user-1', 'org-2') });
    expect(res.status).toBe(404);
  });

  it('requires a dismissalReason when dismissing, and audit-logs the status change', async () => {
    const app = await buildApp();
    await app.request('/brands/me/opportunities/recompute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const id = uoRows[0]!.id as string;

    const missingReason = await app.request(`/opportunities/${id}`, {
      method: 'PATCH',
      headers: { ...(await authHeader('user-1', 'org-1')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    });
    expect(missingReason.status).toBe(422);

    const ok = await app.request(`/opportunities/${id}`, {
      method: 'PATCH',
      headers: { ...(await authHeader('user-1', 'org-1')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed', dismissalReason: 'Deprioritized' }),
    });
    expect(ok.status).toBe(200);
    expect(db.audit_events.create).toHaveBeenCalled();
  });
});
