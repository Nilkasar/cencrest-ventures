import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

let orRows: Array<Record<string, unknown>> = [];
let uoRows: Array<Record<string, unknown>> = [];
let ueRows: Array<Record<string, unknown>> = [];
let qRows: Array<Record<string, unknown>> = [];
let bcRows: Array<Record<string, unknown>> = [];
let cbRows: Array<Record<string, unknown>> = [];
let cdRows: Array<Record<string, unknown>> = [];
let cqcRows: Array<Record<string, unknown>> = [];
let caRows: Array<Record<string, unknown>> = [];
let cjRows: Array<Record<string, unknown>> = [];
let pgRows: Array<Record<string, unknown>> = [];
// Epic 13 (Action Center & Controlled Publishing) — the handoff row
// routes/content-drafts.ts's approve handler creates.
let actRows: Array<Record<string, unknown>> = [];
let idCounter = 0;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
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
  opportunity_recommendations: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = orRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
  },
  unified_opportunities: {
    findFirst: vi.fn(async ({ where, include }: { where: Record<string, unknown>; include?: { opportunity_evidence?: unknown } }) => {
      const row = uoRows.find((r) => matches(r, where));
      if (!row) return null;
      if (!include?.opportunity_evidence) return { ...row };
      return { ...row, opportunity_evidence: ueRows.filter((e) => e.opportunity_id === row.id).map((e) => ({ ...e })) };
    }),
  },
  queries: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = qRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
  },
  brand_claims: {
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? bcRows.filter((r) => matches(r, where)) : bcRows).map((r) => ({ ...r }))),
  },
  crawl_jobs: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const rows = cjRows.filter((r) => matches(r, where));
      return rows.length > 0 ? { ...rows[rows.length - 1] } : null;
    }),
  },
  pages: {
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? pgRows.filter((r) => matches(r, where)) : pgRows).map((r) => ({ ...r }))),
  },
  content_briefs: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = cbRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? cbRows.filter((r) => matches(r, where)) : cbRows.slice()).map((r) => ({ ...r }))),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? cbRows.filter((r) => matches(r, where)).length : cbRows.length)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cb-${++idCounter}`, created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), page_id: null, updated_by: null, created_by: null, deleted_at: null, ...data };
      cbRows.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = cbRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
  },
  content_drafts: {
    findFirst: vi.fn(async ({ where, orderBy, include }: { where: Record<string, unknown>; orderBy?: { version?: string }; include?: { content_briefs?: boolean } }) => {
      let rows = cdRows.filter((r) => matches(r, where));
      if (orderBy?.version === 'desc') rows = rows.slice().sort((a, b) => Number(b.version) - Number(a.version));
      if (rows.length === 0) return null;
      const row = { ...rows[0] };
      if (include?.content_briefs) {
        const brief = cbRows.find((b) => b.id === row.brief_id);
        return { ...row, content_briefs: brief ? { ...brief } : null };
      }
      return row;
    }),
    findMany: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: { version?: string } } = {}) => {
      let rows = where ? cdRows.filter((r) => matches(r, where)) : cdRows.slice();
      if (orderBy?.version === 'desc') rows = rows.slice().sort((a, b) => Number(b.version) - Number(a.version));
      return rows.map((r) => ({ ...r }));
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cd-${++idCounter}`, generated_at: new Date('2026-02-02'), created_at: new Date('2026-02-02'), updated_at: new Date('2026-02-02'), deleted_at: null, ...data };
      cdRows.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = cdRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
  },
  content_quality_checks: {
    findMany: vi.fn(async ({ where, orderBy: _orderBy }: { where?: Record<string, unknown>; orderBy?: unknown } = {}) =>
      (where ? cqcRows.filter((r) => matches(r, where)) : cqcRows.slice()).map((r) => ({ ...r })),
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cqc-${++idCounter}`, created_at: new Date('2026-02-02'), ...data };
      cqcRows.push(row);
      return { ...row };
    }),
  },
  content_approvals: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = caRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `ca-${++idCounter}`, approved_at: new Date('2026-02-03'), created_at: new Date('2026-02-03'), notes: null, ...data };
      caRows.push(row);
      return { ...row };
    }),
  },
  // Epic 13 (Action Center & Controlled Publishing) — the pending `actions`
  // row routes/content-drafts.ts's approve handler creates on approval.
  actions: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = actRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `act-${++idCounter}`, created_at: new Date('2026-02-04'), updated_at: new Date('2026-02-04'), deleted_at: null, priority: 'medium', ...data };
      actRows.push(row);
      return { ...row };
    }),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

const tx = { ...db };

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

// The AI generation step itself is unit-tested against a real
// `AIProviderRegistry` in `lib/content/draft-generator.test.ts` — at the
// route level, mocking this one function is exactly ai-runs.test.ts's own
// "mock the pipeline module, not the provider registry" precedent, since
// this route's job is orchestration (load brief -> generate -> persist ->
// run quality checks), not re-proving the AI-provider routing itself.
const generateDraftContentMock = vi.fn();
vi.mock('../lib/content/draft-generator.js', () => ({ generateDraftContent: (...args: unknown[]) => generateDraftContentMock(...args) }));
vi.mock('../lib/ai-visibility/provider-registry.js', () => ({ getDefaultAiProviderRegistry: vi.fn().mockReturnValue({}) }));

async function buildApp() {
  const { default: contentBriefGenerate } = await import('./content-brief-generate.js');
  const { default: contentBriefs } = await import('./content-briefs.js');
  const { default: contentBriefDetails } = await import('./content-brief-details.js');
  const { default: contentDrafts } = await import('./content-drafts.js');
  const app = new Hono();
  app.route('/recommendations', contentBriefGenerate);
  app.route('/brands/me/content-briefs', contentBriefs);
  app.route('/content-briefs', contentBriefDetails);
  app.route('/content-drafts', contentDrafts);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme', created_at: new Date('2025-01-01') };

const RECOMMENDATION = {
  id: 'rec-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  opportunity_id: 'uo-1',
  action_type: 'create_page',
  effort: 'low',
  impact: 'high',
  priority_rank: '65.55',
  title: 'Build a comparison page: Acme vs CompetitorA for best freight visibility software',
  description: 'Publish a new page comparing Acme to CompetitorA.',
  evidence_summary: '"best freight visibility software" gets an estimated 500 monthly searches. CompetitorA appears in 84% of responses.',
  implementation_notes: 'SEO requirements: title tag 50-60 characters.\n\nGEO requirements: write claims in FAQ/numbered-list form.',
  status: 'in_progress',
  updated_by: null,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

const UNIFIED_OPPORTUNITY = { id: 'uo-1', organization_id: 'org-1', brand_id: 'brand-1', query_id: 'q-1', intent_text: 'best freight visibility software' };
const QUERY = { id: 'q-1', organization_id: 'org-1', text: 'best freight visibility software', intent_type: 'commercial' };
const EVIDENCE = { id: 'ue-1', organization_id: 'org-1', opportunity_id: 'uo-1', source_table: 'seo_keywords', summary: '500 monthly searches', raw_data: {}, created_at: new Date('2026-01-01') };
const VERIFIED_CLAIM = { id: 'bc-1', organization_id: 'org-1', brand_id: 'brand-1', claim: 'Acme is SOC2 Type II certified', evidence: null, confidence: 'high', verified: true, deleted_at: null };

const GENERATED_DRAFT = {
  providerName: 'openai',
  modelName: 'gpt-4o-mini',
  promptVersion: 'generation.v1.0',
  title: 'Best Freight Visibility Software: Acme vs CompetitorA',
  metaDescription: 'x'.repeat(150),
  body: [
    'Acme gives freight teams real-time visibility into every shipment for best freight visibility software.',
    '1. Real-time tracking dashboards',
    '2. Automated exception alerts',
    'FAQ',
    'What makes Acme different? Acme is SOC2 Type II certified and integrates with every major TMS.',
    'According to a 2025 industry report, 68% of shippers still lack real-time visibility.',
  ].join('\n\n'),
  wordCount: 400,
  requestId: 'req-1',
  tokensPrompt: 100,
  tokensCompletion: 200,
  tokensTotal: 300,
  latencyMs: 42,
};

beforeEach(async () => {
  vi.clearAllMocks();
  orRows = [{ ...RECOMMENDATION }];
  uoRows = [{ ...UNIFIED_OPPORTUNITY }];
  ueRows = [{ ...EVIDENCE }];
  qRows = [{ ...QUERY }];
  bcRows = [{ ...VERIFIED_CLAIM }];
  cbRows = [];
  cdRows = [];
  cqcRows = [];
  caRows = [];
  cjRows = [];
  pgRows = [];
  actRows = [];
  idCounter = 0;

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  generateDraftContentMock.mockResolvedValue({ ...GENERATED_DRAFT });
});

describe('POST /recommendations/:id/content-brief', () => {
  it('404s for a recommendation id that does not exist / belongs to another org', async () => {
    const app = await buildApp();
    const res = await app.request('/recommendations/does-not-exist/content-brief', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('409s when the recommendation has not been approved (status new)', async () => {
    orRows = [{ ...RECOMMENDATION, status: 'new' }];
    const app = await buildApp();
    const res = await app.request('/recommendations/rec-1/content-brief', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(409);
  });

  it('409s when the recommendation was dismissed', async () => {
    orRows = [{ ...RECOMMENDATION, status: 'dismissed' }];
    const app = await buildApp();
    const res = await app.request('/recommendations/rec-1/content-brief', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(409);
  });

  it('422s for a non-content-type recommendation (fix_technical/build_citations)', async () => {
    orRows = [{ ...RECOMMENDATION, action_type: 'fix_technical' }];
    const app = await buildApp();
    const res = await app.request('/recommendations/rec-1/content-brief', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it(
    'generates a brief that carries forward the REAL recommendation_id and the FULL dual SEO+GEO implementation_notes, not a stripped-down summary',
    async () => {
      const app = await buildApp();
      const res = await app.request('/recommendations/rec-1/content-brief', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { created: boolean; brief: Record<string, unknown> };
      expect(body.created).toBe(true);
      expect(body.brief.recommendationId).toBe('rec-1');
      expect(body.brief.implementationNotes).toBe(RECOMMENDATION.implementation_notes);
      expect(body.brief.implementationNotes).toMatch(/SEO requirements:/);
      expect(body.brief.implementationNotes).toMatch(/GEO requirements:/);
      expect(body.brief.evidenceSummary).toBe(RECOMMENDATION.evidence_summary);
      expect((body.brief.researchNotes as { brandClaims: unknown[] }).brandClaims).toHaveLength(1);
      expect(cbRows).toHaveLength(1);
    },
  );

  it('is idempotent: a second call updates the SAME brief, never creates a duplicate', async () => {
    const app = await buildApp();
    const first = await app.request('/recommendations/rec-1/content-brief', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(first.status).toBe(201);
    const second = await app.request('/recommendations/rec-1/content-brief', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(second.status).toBe(200);
    expect(cbRows).toHaveLength(1);
  });
});

const BRIEF = {
  organization_id: 'org-1',
  brand_id: 'brand-1',
  recommendation_id: 'rec-1',
  content_type: 'landing_page',
  title: RECOMMENDATION.title,
  target_query: 'best freight visibility software',
  target_stage: null,
  target_intent: 'commercial',
  keywords: ['best freight visibility software'],
  outline: [],
  evidence_summary: RECOMMENDATION.evidence_summary,
  implementation_notes: RECOMMENDATION.implementation_notes,
  research_notes: { brandClaims: [{ id: 'bc-1', claim: VERIFIED_CLAIM.claim, confidence: 'high', verified: true }], opportunityEvidence: [] },
  status: 'draft',
  deleted_at: null,
  page_id: null,
  created_by: null,
  updated_by: null,
};

describe('GET /brands/me/content-briefs', () => {
  it('lists briefs for the brand', async () => {
    cbRows = [{ id: 'cb-1', created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), ...BRIEF }];
    const app = await buildApp();
    const res = await app.request('/brands/me/content-briefs', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { briefs: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.briefs).toHaveLength(1);
  });
});

describe('GET /content-briefs/:id and POST /content-briefs/:id/draft', () => {
  beforeEach(() => {
    cbRows = [{ id: 'cb-1', created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), ...BRIEF }];
  });

  it('404s for a brief id that does not exist', async () => {
    const app = await buildApp();
    const res = await app.request('/content-briefs/does-not-exist', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('GET returns the brief with its (empty) draft list', async () => {
    const app = await buildApp();
    const res = await app.request('/content-briefs/cb-1', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: Record<string, unknown>; drafts: unknown[] };
    expect(body.brief.id).toBe('cb-1');
    expect(body.drafts).toEqual([]);
  });

  it(
    'POST /:id/draft generates version 1 via AIProviderRegistry.resolveAvailable("content.generation") (mocked), stores promptVersion, and runs ALL 5 quality checks',
    async () => {
      const app = await buildApp();
      const res = await app.request('/content-briefs/cb-1/draft', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { draft: Record<string, unknown>; qualityChecks: Array<Record<string, unknown>> };

      expect(generateDraftContentMock).toHaveBeenCalledTimes(1);
      expect(body.draft.version).toBe(1);
      expect(body.draft.promptVersion).toBe('generation.v1.0');
      expect(body.draft.status).toBe('generated');
      expect(body.qualityChecks).toHaveLength(5);
      expect(body.qualityChecks.map((q) => q.checkType).sort()).toEqual(
        ['brand_voice', 'duplicate_content', 'fact_check', 'geo_structure', 'seo_checklist'].sort(),
      );
      for (const check of body.qualityChecks) {
        expect(['pass', 'fail', 'warning']).toContain(check.status);
      }
    },
  );

  it('a SECOND draft generation creates version 2, and version 1 remains readable (never overwritten)', async () => {
    const app = await buildApp();
    const first = await app.request('/content-briefs/cb-1/draft', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect((await first.json() as { draft: { version: number } }).draft.version).toBe(1);

    generateDraftContentMock.mockResolvedValue({ ...GENERATED_DRAFT, title: 'Version 2 Title' });
    const second = await app.request('/content-briefs/cb-1/draft', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(second.status).toBe(201);
    expect((await second.json() as { draft: { version: number; title: string } }).draft.version).toBe(2);

    expect(cdRows).toHaveLength(2);
    const detail = await app.request('/content-briefs/cb-1', { headers: await authHeader('user-1', 'org-1') });
    const detailBody = (await detail.json()) as { drafts: Array<{ version: number; title: string }> };
    expect(detailBody.drafts).toHaveLength(2);
    expect(detailBody.drafts.map((d) => d.version).sort()).toEqual([1, 2]);
    expect(detailBody.drafts.find((d) => d.version === 1)!.title).toBe(GENERATED_DRAFT.title);
  });
});

describe('GET /content-drafts/:id/quality-checks', () => {
  it('returns every stored check individually, not a single aggregate flag', async () => {
    cbRows = [{ id: 'cb-1', created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), ...BRIEF }];
    const app = await buildApp();
    await app.request('/content-briefs/cb-1/draft', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const draftId = cdRows[0]!.id as string;

    const res = await app.request(`/content-drafts/${draftId}/quality-checks`, { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: unknown[] };
    expect(body.checks).toHaveLength(5);
  });

  it('404s for an unknown draft id', async () => {
    const app = await buildApp();
    const res = await app.request('/content-drafts/does-not-exist/quality-checks', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });
});

describe('POST /content-drafts/:id/approve', () => {
  beforeEach(async () => {
    cbRows = [{ id: 'cb-1', created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), ...BRIEF }];
    const app = await buildApp();
    await app.request('/content-briefs/cb-1/draft', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
  });

  it('an owner/admin approves successfully, writes content_approvals, audit-logs it, and moves status to "approved" (never "published")', async () => {
    const draftId = cdRows[0]!.id as string;
    const app = await buildApp();
    const res = await app.request(`/content-drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { approval: Record<string, unknown>; draft: Record<string, unknown> };
    expect(body.draft.status).toBe('approved');
    expect(caRows).toHaveLength(1);
    expect(caRows[0]!.approved_by).toBe('user-1');
    expect(caRows[0]!.approved_role).toBe('admin');
    expect(db.audit_events.create).toHaveBeenCalledTimes(1);
    const auditCall = db.audit_events.create.mock.calls[0]![0] as { data: { action: string } };
    expect(auditCall.data.action).toBe('content.approved');

    // Epic 13 (Action Center & Controlled Publishing) handoff — a real FK
    // to the draft, never a re-typed copy, plus the recommendation_id
    // carried through from the draft's own brief.
    expect(actRows).toHaveLength(1);
    expect(actRows[0]!.content_draft_id).toBe(draftId);
    expect(actRows[0]!.agent_pending_action_id).toBeUndefined();
    expect(actRows[0]!.recommendation_id).toBe('rec-1');
    expect(actRows[0]!.status).toBe('pending');
    expect(actRows[0]!.autonomy_level).toBe(1);
  });

  it('a viewer (below approve_content\'s allowed roles) is rejected server-side with 403', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const draftId = cdRows[0]!.id as string;
    const app = await buildApp();
    const res = await app.request(`/content-drafts/${draftId}/approve`, { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
    expect(caRows).toHaveLength(0);
  });

  it('an editor who did NOT author the draft is rejected (editor may approve only their own draft)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const draftId = cdRows[0]!.id as string;
    (cdRows[0] as Record<string, unknown>).created_by = 'someone-else';
    const app = await buildApp();
    const res = await app.request(`/content-drafts/${draftId}/approve`, { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
  });

  it('an editor who DID author the draft may approve it', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const draftId = cdRows[0]!.id as string;
    (cdRows[0] as Record<string, unknown>).created_by = 'user-1';
    const app = await buildApp();
    const res = await app.request(`/content-drafts/${draftId}/approve`, { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(201);
  });

  it('is idempotent: approving an already-approved draft a second time returns the existing approval without a new audit event', async () => {
    const draftId = cdRows[0]!.id as string;
    const app = await buildApp();
    await app.request(`/content-drafts/${draftId}/approve`, { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(db.audit_events.create).toHaveBeenCalledTimes(1);

    const second = await app.request(`/content-drafts/${draftId}/approve`, { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { alreadyApproved: boolean };
    expect(body.alreadyApproved).toBe(true);
    expect(caRows).toHaveLength(1);
    expect(db.audit_events.create).toHaveBeenCalledTimes(1); // still just one
    // The Epic 13 handoff row is created exactly once too, not duplicated
    // on the idempotent repeat.
    expect(actRows).toHaveLength(1);
  });

  it('404s (not a leaking 403) for a draft belonging to a different organization — tenant isolation', async () => {
    const draftId = cdRows[0]!.id as string;
    const app = await buildApp();
    const res = await app.request(`/content-drafts/${draftId}/approve`, { method: 'POST', headers: await authHeader('user-1', 'org-2') });
    expect(res.status).toBe(404);
  });
});

describe('ADR-007 — this epic never publishes', () => {
  it('the approved draft response never contains a "published" status or a publish-shaped field', async () => {
    cbRows = [{ id: 'cb-1', created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'), ...BRIEF }];
    const app = await buildApp();
    await app.request('/content-briefs/cb-1/draft', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const draftId = cdRows[0]!.id as string;

    const res = await app.request(`/content-drafts/${draftId}/approve`, { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as { draft: Record<string, unknown> };
    expect(body.draft.status).toBe('approved');
    expect(body.draft.status).not.toBe('published');
    expect(body).not.toHaveProperty('published');
    expect(body).not.toHaveProperty('publishedUrl');
  });
});
