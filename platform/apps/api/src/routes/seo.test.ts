import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

let analysisCounter = 0;
let opportunityCounter = 0;

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  use_cases: { findMany: vi.fn() },
  crawl_jobs: { findFirst: vi.fn() },
  pages: { findMany: vi.fn() },
  page_issues: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  seo_analyses: {
    create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `analysis-${++analysisCounter}`,
      analyzed_at: new Date('2026-02-01'),
      ...data,
    })),
  },
  keyword_groups: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  seo_keywords: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn(),
  },
  seo_opportunities: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `opp-${++opportunityCounter}`,
      created_at: new Date('2026-02-01'),
      updated_at: new Date('2026-02-01'),
      ...data,
    })),
    update: vi.fn(),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  // Epic 18 — backs `resolveSEODataProviderForOrg`'s "is Search Console
  // connected" check. Defaults to "no" (`null`) so every PRE-EXISTING test
  // in this file keeps exercising `NullSEODataProvider`, unchanged.
  integrations: { findUnique: vi.fn().mockResolvedValue(null) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  use_cases: db.use_cases,
  crawl_jobs: db.crawl_jobs,
  pages: db.pages,
  page_issues: db.page_issues,
  seo_analyses: db.seo_analyses,
  keyword_groups: db.keyword_groups,
  seo_keywords: db.seo_keywords,
  seo_opportunities: db.seo_opportunities,
  integrations: db.integrations,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: seo } = await import('./seo.js');
  const app = new Hono();
  app.route('/seo', seo);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = {
  id: 'brand-1',
  organization_id: 'org-1',
  name: 'Acme Freight',
  categories: ['freight visibility software'],
  website_url: 'https://acme.example',
};

const CRAWL_JOB = {
  id: 'job-1',
  brand_id: 'brand-1',
  organization_id: 'org-1',
  root_url: 'https://acme.example',
  created_at: new Date('2026-01-01'),
};

function makePage(overrides: Record<string, unknown>) {
  return {
    id: 'page-1',
    organization_id: 'org-1',
    brand_id: 'brand-1',
    crawl_job_id: 'job-1',
    url: 'https://acme.example/',
    title: 'Home',
    meta_description: 'desc',
    h1: 'Welcome',
    canonical_url: 'https://acme.example/',
    status_code: 200,
    word_count: 500,
    load_ms: 100,
    internal_links: 2,
    external_links: 1,
    schema_types: ['Organization'],
    raw_html_hash: null,
    crawled_at: new Date('2026-01-02'),
    deleted_at: null,
    page_issues: [],
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  analysisCounter = 0;
  opportunityCounter = 0;
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.page_issues.createMany.mockResolvedValue({ count: 0 });
  db.seo_keywords.createMany.mockResolvedValue({ count: 0 });
});

describe('POST /seo/analyze', () => {
  it('404s when the org has no brand profile', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/seo/analyze', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('422s when the brand has no crawl yet', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/seo/analyze', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: 'no_crawl_data' });
  });

  it('422s when the crawl job has no crawled pages', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue(CRAWL_JOB);
    db.pages.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/seo/analyze', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: 'no_pages_crawled' });
  });

  it('runs the technical checklist per page, writes seo_analyses, and derives new page_issues', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue(CRAWL_JOB);
    const homepage = makePage({ id: 'page-1', url: 'https://acme.example/', schema_types: ['Organization'] });
    const httpPage = makePage({ id: 'page-2', url: 'http://acme.example/about', schema_types: [] });
    db.pages.findMany.mockResolvedValue([homepage, httpPage]);

    const app = await buildApp();
    const res = await app.request('/seo/analyze', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);

    // Homepage is clean (https + Organization schema) — no new issues.
    // The http page gets a new `not_https` page_issues row.
    expect(db.page_issues.createMany).toHaveBeenCalledTimes(1);
    expect(db.page_issues.createMany).toHaveBeenCalledWith({
      data: [{ organization_id: 'org-1', brand_id: 'brand-1', page_id: 'page-2', issue_type: 'not_https', severity: 'medium', detail: null }],
    });

    // One technical seo_analyses row per page + one brand-level content row.
    expect(db.seo_analyses.create).toHaveBeenCalledTimes(3);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ crawlJobId: 'job-1', pagesAnalyzed: 2, issuesCreated: 1 });
    expect((body.technicalAnalyses as unknown[]).length).toBe(2);
    expect((body.contentAnalysis as Record<string, unknown>).analysisType).toBe('content');
  });

  it('resolves a specific crawlJobId when given, scoped to this brand/org', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue(null);
    db.pages.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/seo/analyze', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ crawlJobId: '11111111-1111-1111-1111-111111111111' }),
    });
    expect(res.status).toBe(404);
    expect(db.crawl_jobs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '11111111-1111-1111-1111-111111111111', brand_id: 'brand-1', organization_id: 'org-1' },
      }),
    );
  });
});

describe('keyword_groups CRUD', () => {
  it('lists the brand keyword groups', async () => {
    db.keyword_groups.findMany.mockResolvedValue([
      { id: 'kg-1', name: 'Core', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'), _count: { seo_keywords: 3 } },
    ]);
    const app = await buildApp();
    const res = await app.request('/seo/keyword-groups', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({ id: 'kg-1', name: 'Core', keywordCount: 3 });
  });

  it('creates a keyword group', async () => {
    db.keyword_groups.create.mockResolvedValue({
      id: 'kg-2',
      name: 'New group',
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });
    const app = await buildApp();
    const res = await app.request('/seo/keyword-groups', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New group' }),
    });
    expect(res.status).toBe(201);
    expect(db.keyword_groups.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'New group', brand_id: 'brand-1', created_by: 'user-1' }) }),
    );
  });

  it('404s patching a group that does not belong to this brand/org', async () => {
    db.keyword_groups.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/seo/keyword-groups/kg-404', {
      method: 'PATCH',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /seo/keyword-groups/generate', () => {
  it('reads use_cases/categories (not a fixture), seeds keywords with confidence, and scores an opportunity for each', async () => {
    db.use_cases.findMany.mockResolvedValue([
      { title: 'logistics teams', industries: ['manufacturing'], pain_points: ['late shipments'], solutions: ['live tracking'] },
    ]);
    db.keyword_groups.create.mockResolvedValue({
      id: 'kg-3',
      name: 'Acme Freight Keywords',
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    const generatedKeywordRows = [
      { id: 'kw-1', keyword_group_id: 'kg-3', text: 'freight visibility software', intent: 'informational', monthly_volume: 1000, difficulty: 70, confidence: 'estimate', source: 'null_provider', created_at: new Date(), updated_at: new Date() },
      { id: 'kw-2', keyword_group_id: 'kg-3', text: 'best freight visibility software', intent: 'commercial', monthly_volume: 300, difficulty: 40, confidence: 'estimate', source: 'null_provider', created_at: new Date(), updated_at: new Date() },
    ];
    db.seo_keywords.findMany.mockResolvedValue(generatedKeywordRows);

    const app = await buildApp();
    const res = await app.request('/seo/keyword-groups/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);

    // Reads Epic 2's real use_cases, scoped to this org/brand.
    expect(db.use_cases.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: 'org-1', brand_id: 'brand-1', deleted_at: null } }),
    );

    expect(db.seo_keywords.createMany).toHaveBeenCalledTimes(1);
    const createdKeywordRows = (db.seo_keywords.createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
    // Every generated keyword carries a confidence value — never silently
    // presenting an estimate as a firm number.
    for (const row of createdKeywordRows) {
      expect(row.confidence).toBe('estimate');
      expect(row.source).toBe('null_provider');
    }

    const body = (await res.json()) as Record<string, unknown>;
    expect(db.seo_opportunities.create).toHaveBeenCalledTimes(2);
    const opportunities = body.opportunities as Array<Record<string, unknown>>;
    expect(opportunities).toHaveLength(2);
    for (const opp of opportunities) {
      expect(opp.scoringFormulaVersion).toBe('1.0');
      expect(opp.evidence).toBeDefined();
      expect(typeof opp.opportunityScore).toBe('number');
    }
  });

  it('422s when the brand has no categories/use_cases to generate from', async () => {
    db.brands.findFirst.mockResolvedValue({ ...BRAND, categories: [] });
    db.use_cases.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/seo/keyword-groups/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: 'no_candidates' });
  });
});

describe('GET /seo/opportunities', () => {
  it('sorts server-side by opportunity_score desc with a stable tiebreak', async () => {
    db.seo_opportunities.count.mockResolvedValue(0);
    db.seo_opportunities.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/seo/opportunities', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(db.seo_opportunities.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ opportunity_score: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('filters by status when given', async () => {
    db.seo_opportunities.count.mockResolvedValue(0);
    db.seo_opportunities.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/seo/opportunities?status=dismissed', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(db.seo_opportunities.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'dismissed' }) }),
    );
  });
});

describe('PATCH /seo/opportunities/:id/dismiss', () => {
  it('sets status to dismissed and records who did it', async () => {
    db.seo_opportunities.findFirst.mockResolvedValue({ id: 'opp-1', organization_id: 'org-1', brand_id: 'brand-1' });
    db.seo_opportunities.update.mockResolvedValue({
      id: 'opp-1',
      status: 'dismissed',
      updated_by: 'user-1',
      value_score: 10,
      effort_score: 10,
      opportunity_score: 10,
      scoring_formula_version: '1.0',
      evidence: {},
      created_at: new Date(),
      updated_at: new Date(),
    });
    const app = await buildApp();
    const res = await app.request('/seo/opportunities/opp-1/dismiss', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
    expect(db.seo_opportunities.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'dismissed', updated_by: 'user-1' }) }),
    );
  });

  it('404s dismissing an opportunity that does not belong to this brand/org', async () => {
    db.seo_opportunities.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/seo/opportunities/opp-404/dismiss', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(404);
  });
});
