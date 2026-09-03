import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

let uoRows: Array<Record<string, unknown>> = [];
let ueRows: Array<Record<string, unknown>> = [];
let orRows: Array<Record<string, unknown>> = [];
let orCounter = 0;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'in' in (value as Record<string, unknown>)) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  unified_opportunities: {
    findFirst: vi.fn(async ({ where, include }: { where: Record<string, unknown>; include?: { opportunity_evidence?: unknown } }) => {
      const row = uoRows.find((r) => matches(r, where));
      if (!row) return null;
      if (!include?.opportunity_evidence) return { ...row };
      return { ...row, opportunity_evidence: ueRows.filter((e) => e.opportunity_id === row.id).map((e) => ({ ...e })) };
    }),
  },
  opportunity_recommendations: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = orRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const rows = where ? orRows.filter((r) => matches(r, where)) : orRows.slice();
      return rows
        .slice()
        .sort((a, b) => Number(b.priority_rank) - Number(a.priority_rank))
        .map((r) => ({ ...r }));
    }),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? orRows.filter((r) => matches(r, where)).length : orRows.length)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `or-${++orCounter}`, created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), updated_by: null, status: 'new', ...data };
      orRows.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = orRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  unified_opportunities: db.unified_opportunities,
  opportunity_recommendations: db.opportunity_recommendations,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: opportunityRecommendations } = await import('./opportunity-recommendations.js');
  const { default: recommendations } = await import('./recommendations.js');
  const { default: recommendationDetails } = await import('./recommendation-details.js');
  const app = new Hono();
  app.route('/opportunities', opportunityRecommendations);
  app.route('/brands/me/recommendations', recommendations);
  app.route('/recommendations', recommendationDetails);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme', created_at: new Date('2025-01-01') };

const UNIFIED_OPPORTUNITY = {
  id: 'uo-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  query_id: 'q1',
  intent_text: 'best freight visibility software',
  type: 'unified',
  seo_demand_score: '50.00',
  geo_gap_score: '84.00',
  effort_score: '24.00',
  impact_score: '92.00',
  opportunity_score: '65.55',
  scoring_formula_version: '1.0',
  status: 'new',
  priority: 1,
  dismissal_reason: null,
  title: 'Unify SEO + AI visibility for "best freight visibility software"',
  updated_by: null,
  created_at: new Date('2026-02-01'),
  updated_at: new Date('2026-02-01'),
};

const SEO_EVIDENCE = {
  id: 'ue-1',
  organization_id: 'org-1',
  opportunity_id: 'uo-1',
  source_table: 'seo_keywords',
  source_id: 'kw-1',
  summary: '"best freight visibility software" gets an estimated 500 monthly searches.',
  raw_data: { keywordId: 'kw-1', monthlyVolume: 500 },
  created_at: new Date('2026-02-01'),
};

const GEO_EVIDENCE = {
  id: 'ue-2',
  organization_id: 'org-1',
  opportunity_id: 'uo-1',
  source_table: 'ai_runs',
  source_id: 'run-competitor-1',
  summary: 'CompetitorA appears in 84% of responses at position 1, you appear in 0% of responses.',
  raw_data: { competitorId: 'competitor-1', competitorName: 'CompetitorA', competitorMentionRatePct: 84, yourMentionRatePct: 0 },
  created_at: new Date('2026-02-01'),
};

beforeEach(async () => {
  vi.clearAllMocks();
  uoRows = [{ ...UNIFIED_OPPORTUNITY }];
  ueRows = [{ ...SEO_EVIDENCE }, { ...GEO_EVIDENCE }];
  orRows = [];
  orCounter = 0;

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    slug: where.id,
    name: where.id,
    deleted_at: null,
  }));
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
  db.brands.findFirst.mockResolvedValue(BRAND);
});

describe('POST /opportunities/:id/recommendations/generate', () => {
  it('404s for an opportunity id that does not exist / belongs to another org', async () => {
    const app = await buildApp();
    const res = await app.request('/opportunities/does-not-exist/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it(
    'generates a recommendation whose evidence_summary quotes the REAL opportunity_evidence numbers, and whose implementation_notes cover both SEO and GEO',
    async () => {
      const app = await buildApp();
      const res = await app.request('/opportunities/uo-1/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { created: boolean; recommendation: Record<string, unknown> };
      expect(body.created).toBe(true);
      expect(orRows).toHaveLength(1);

      const rec = body.recommendation;
      expect(rec.actionType).toBe('create_page'); // unified -> create_page
      expect(rec.title).toContain('Acme');
      expect(rec.title).toContain('CompetitorA');

      // Step 1: evidence_summary quotes the SPECIFIC real numbers, not a
      // generic template string.
      expect(rec.evidenceSummary).toContain('500 monthly searches');
      expect(rec.evidenceSummary).toContain('84% of responses');

      // Step 2: implementation_notes cover BOTH an SEO and a GEO requirement.
      expect(rec.implementationNotes).toMatch(/SEO requirements:/);
      expect(rec.implementationNotes).toMatch(/GEO requirements:/);

      expect(db.audit_events.create).toHaveBeenCalled();
    },
  );

  it('is idempotent: a second consecutive call updates the SAME row, never creates a duplicate', async () => {
    const app = await buildApp();

    const first = await app.request('/opportunities/uo-1/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(first.status).toBe(201);
    expect(orRows).toHaveLength(1);
    const idAfterFirst = orRows[0]!.id;

    const second = await app.request('/opportunities/uo-1/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { created: boolean };
    expect(secondBody.created).toBe(false);
    expect(orRows).toHaveLength(1); // still exactly one row — no duplicate
    expect(orRows[0]!.id).toBe(idAfterFirst);
  });

  it.each([
    ['seo', 'create_page'],
    ['geo', 'build_citations'],
    ['content', 'update_page'],
    ['technical', 'fix_technical'],
  ] as const)('opportunity type "%s" generates action_type "%s", still with BOTH SEO and GEO requirements', async (type, expectedActionType) => {
    uoRows = [{ ...UNIFIED_OPPORTUNITY, type }];
    const app = await buildApp();
    const res = await app.request('/opportunities/uo-1/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { recommendation: Record<string, unknown> };
    expect(body.recommendation.actionType).toBe(expectedActionType);
    expect(body.recommendation.implementationNotes).toMatch(/SEO requirements:/);
    expect(body.recommendation.implementationNotes).toMatch(/GEO requirements:/);
  });
});

describe('GET /brands/me/recommendations', () => {
  it('lists recommendations sorted by priority_rank desc, reflecting opportunity_score + effort', async () => {
    // Two fixture opportunities with the SAME opportunity_score but
    // different effort levels (driven by effort_score) — the cheap
    // (low-effort) one must rank first.
    uoRows = [
      { ...UNIFIED_OPPORTUNITY, id: 'uo-cheap', effort_score: '10.00', opportunity_score: '70.00' }, // low effort -> priority_rank 70
      { ...UNIFIED_OPPORTUNITY, id: 'uo-expensive', effort_score: '90.00', opportunity_score: '70.00' }, // high effort -> priority_rank 35
    ];
    ueRows = [];

    const app = await buildApp();
    await app.request('/opportunities/uo-cheap/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    await app.request('/opportunities/uo-expensive/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

    const res = await app.request('/brands/me/recommendations', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendations: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
    expect(body.recommendations[0]!.opportunityId).toBe('uo-cheap');
    expect(body.recommendations[0]!.effort).toBe('low');
    expect((body.recommendations[0]!.priorityRank as number)).toBeGreaterThan(body.recommendations[1]!.priorityRank as number);
  });
});

describe('PATCH /recommendations/:id', () => {
  it('changes status and audit-logs it', async () => {
    const app = await buildApp();
    await app.request('/opportunities/uo-1/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const id = orRows[0]!.id as string;

    const res = await app.request(`/recommendations/${id}`, {
      method: 'PATCH',
      headers: { ...(await authHeader('user-1', 'org-1')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('in_progress');
    expect(orRows[0]!.status).toBe('in_progress');
    expect(db.audit_events.create).toHaveBeenCalled();
  });

  it('404s (not a leaking 403) for a recommendation belonging to a different organization — tenant isolation', async () => {
    const app = await buildApp();
    await app.request('/opportunities/uo-1/recommendations/generate', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const id = orRows[0]!.id as string;

    const res = await app.request(`/recommendations/${id}`, {
      method: 'PATCH',
      headers: { ...(await authHeader('user-1', 'org-2')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(res.status).toBe(404);
  });
});
