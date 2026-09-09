import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';
import { generateCandidateQueries, type QueryGeneratorBrandProfile } from '../lib/query-generator.js';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  use_cases: { findMany: vi.fn() },
  competitors: { findMany: vi.fn() },
  query_sets: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  queries: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  subscriptions: { findUnique: vi.fn() },
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
  use_cases: db.use_cases,
  competitors: db.competitors,
  query_sets: db.query_sets,
  queries: db.queries,
  subscriptions: db.subscriptions,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: querySets } = await import('./query-sets.js');
  const app = new Hono();
  app.route('/query-sets', querySets);
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
  differentiators: ['real-time GPS tracking'],
  markets: ['North America'],
};

const USE_CASES = [
  {
    title: 'tracking refrigerated shipments',
    industries: ['cold chain logistics'],
    company_sizes: ['mid-market'],
    pain_points: ['spoiled shipments'],
    solutions: ['monitor temperature in real time'],
  },
];

const COMPETITORS = [{ name: 'Rival TMS' }];

const PROFILE: QueryGeneratorBrandProfile = {
  name: BRAND.name,
  categories: BRAND.categories,
  differentiators: BRAND.differentiators,
  markets: BRAND.markets,
  useCases: USE_CASES.map((uc) => ({
    title: uc.title,
    industries: uc.industries,
    companySizes: uc.company_sizes,
    painPoints: uc.pain_points,
    solutions: uc.solutions,
  })),
  competitors: COMPETITORS,
};

function draftQuerySet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'qs-1',
    organization_id: 'org-1',
    brand_id: 'brand-1',
    name: 'Acme Freight Query Universe',
    description: null,
    query_count: 10,
    version: 1,
    status: 'draft',
    plan_tier: 'free',
    plan_limit: 50,
    potential_count: 10,
    activated_at: null,
    archived_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  db.query_sets.updateMany.mockResolvedValue({ count: 0 });
  db.queries.count.mockResolvedValue(0);
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.use_cases.findMany.mockResolvedValue(USE_CASES);
  db.competitors.findMany.mockResolvedValue(COMPETITORS);
  db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' });
});

describe('POST /query-sets/generate', () => {
  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/query-sets/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('403s for a viewer (below create_brand_profile)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/query-sets/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('spans multiple of the ten template categories, returns a draft query_set, and matches the uncapped generator output on a free plan under the cap', async () => {
    const expected = generateCandidateQueries(PROFILE);
    expect(expected.length).toBeLessThan(50); // stays under the free-plan cap of 50

    db.query_sets.create.mockResolvedValue(draftQuerySet({ query_count: expected.length }));
    db.queries.findMany.mockResolvedValue(
      expected.map((q, i) => ({
        id: `q-${i}`,
        query_set_id: 'qs-1',
        text: q.text,
        intent_type: q.intentType,
        category: q.category,
        tags: q.tags,
        priority: q.priority,
        created_at: new Date(),
        updated_at: new Date(),
      })),
    );

    const app = await buildApp();
    const res = await app.request('/query-sets/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { querySet: Record<string, unknown>; queries: Array<Record<string, unknown>> };
    expect(body.querySet).toMatchObject({ status: 'draft', queryCount: expected.length });
    const categoriesUsed = new Set(body.queries.map((q) => q.category));
    expect(categoriesUsed.size).toBeGreaterThan(2);

    // The exact set of queries persisted must equal the generator's output
    // — nothing silently dropped or added between generation and the write.
    const createCall = db.query_sets.create.mock.calls[0]![0];
    expect(createCall.data.queries.create).toHaveLength(expected.length);
    expect(createCall.data.status).toBe('draft');
  });

  it('caps the persisted query count at the plan limit BEFORE writing — never writes more than the cap', async () => {
    // Blow past the free plan's cap of 50 with a much richer profile.
    const richUseCases = Array.from({ length: 10 }, (_, i) => ({
      title: `use case ${i}`,
      industries: [`industry ${i}-a`, `industry ${i}-b`],
      company_sizes: [`size ${i}`],
      pain_points: [`pain point ${i}`],
      solutions: [`solution ${i}`],
    }));
    db.use_cases.findMany.mockResolvedValue(richUseCases);
    db.competitors.findMany.mockResolvedValue([{ name: 'Rival A' }, { name: 'Rival B' }, { name: 'Rival C' }]);

    const richProfile: QueryGeneratorBrandProfile = {
      ...PROFILE,
      useCases: richUseCases.map((uc) => ({
        title: uc.title,
        industries: uc.industries,
        companySizes: uc.company_sizes,
        painPoints: uc.pain_points,
        solutions: uc.solutions,
      })),
      competitors: [{ name: 'Rival A' }, { name: 'Rival B' }, { name: 'Rival C' }],
    };
    const uncapped = generateCandidateQueries(richProfile);
    expect(uncapped.length).toBeGreaterThan(50);

    db.query_sets.create.mockResolvedValue(draftQuerySet({ query_count: 50 }));
    db.queries.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.request('/query-sets/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const createCall = db.query_sets.create.mock.calls[0]![0];
    expect(createCall.data.queries.create).toHaveLength(50);
    expect(createCall.data.query_count).toBe(50);
  });

  it('does not cap on the growth plan at the same profile size (limit is 500, not 50)', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'growth' });
    const expected = generateCandidateQueries(PROFILE);
    db.query_sets.create.mockResolvedValue(draftQuerySet({ query_count: expected.length }));
    db.queries.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.request('/query-sets/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const createCall = db.query_sets.create.mock.calls[0]![0];
    expect(createCall.data.queries.create).toHaveLength(expected.length);
  });
});

describe('PATCH /query-sets/:id/activate', () => {
  it('404s for an unknown query set', async () => {
    db.query_sets.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/query-sets/nope/activate', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(404);
  });

  it('409s when the query set is not a draft', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ status: 'active' }));
    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/activate', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(409);
  });

  it('flips draft -> active and freezes version (version untouched)', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet());
    db.query_sets.update.mockResolvedValue(draftQuerySet({ status: 'active' }));
    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/activate', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'active', version: 1 });
    expect(db.query_sets.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
    );
  });

  it('archives the brand\'s other active set in the same transaction as activation', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ id: 'qs-2', status: 'draft' }));
    db.query_sets.update.mockResolvedValue(draftQuerySet({ id: 'qs-2', status: 'active' }));
    const app = await buildApp();
    const res = await app.request('/query-sets/qs-2/activate', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
    expect(db.query_sets.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brand_id: 'brand-1', status: 'active', id: { not: 'qs-2' } }),
        data: expect.objectContaining({ status: 'archived' }),
      }),
    );
  });

  // Post-verification fix (backend bug #1): proves the single-active
  // invariant across two SEQUENTIAL activations, against a genuinely
  // mutable in-memory model (not just asserting the mocks were called) —
  // `findFirst`/`update`/`updateMany` all read from and write to the same
  // `store` array, so this test would fail if the route ever left two rows
  // `active` at once.
  it('leaves exactly one active query_set per brand after two activations in sequence', async () => {
    let store: Array<Record<string, unknown>> = [
      draftQuerySet({ id: 'qs-1', status: 'draft' }),
      draftQuerySet({ id: 'qs-2', status: 'draft' }),
    ];

    db.query_sets.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; organization_id: string } }) =>
        store.find((s) => s.id === where.id && s.organization_id === where.organization_id) ?? null,
    );
    db.query_sets.updateMany.mockImplementation(
      async ({ where, data }: { where: { brand_id: string; organization_id: string; status: string; id: { not: string } }; data: Record<string, unknown> }) => {
        let count = 0;
        store = store.map((s) => {
          if (
            s.brand_id === where.brand_id &&
            s.organization_id === where.organization_id &&
            s.status === where.status &&
            s.id !== where.id.not
          ) {
            count += 1;
            return { ...s, ...data };
          }
          return s;
        });
        return { count };
      },
    );
    db.query_sets.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      store = store.map((s) => (s.id === where.id ? { ...s, ...data } : s));
      return store.find((s) => s.id === where.id)!;
    });

    const app = await buildApp();
    const headers = await authHeader('user-1', 'org-1');

    const res1 = await app.request('/query-sets/qs-1/activate', { method: 'PATCH', headers });
    expect(res1.status).toBe(200);
    expect(store.find((s) => s.id === 'qs-1')?.status).toBe('active');

    const res2 = await app.request('/query-sets/qs-2/activate', { method: 'PATCH', headers });
    expect(res2.status).toBe(200);

    const activeSets = store.filter((s) => s.status === 'active');
    expect(activeSets).toHaveLength(1);
    expect(activeSets[0]?.id).toBe('qs-2');
    expect(store.find((s) => s.id === 'qs-1')?.status).toBe('archived');
  });
});

describe('PATCH /query-sets/:id/archive', () => {
  it('409s when already archived', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ status: 'archived' }));
    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/archive', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(409);
  });

  it('archives an active query set', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ status: 'active' }));
    db.query_sets.update.mockResolvedValue(draftQuerySet({ status: 'archived' }));
    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/archive', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
  });
});

describe('manual curation — POST/PATCH/DELETE /query-sets/:id/queries', () => {
  it('POST adds a query and increments query_count, only while draft', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet());
    db.queries.create.mockResolvedValue({
      id: 'q-new',
      query_set_id: 'qs-1',
      text: 'best freight visibility software for enterprise?',
      intent_type: 'commercial',
      category: 'size',
      tags: [],
      priority: 2,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ text: 'best freight visibility software for enterprise?', category: 'size' }),
    });

    expect(res.status).toBe(201);
    expect(db.query_sets.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ query_count: { increment: 1 } }) }),
    );
  });

  it('POST 409s once the query set is active (frozen version cannot be silently mutated)', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ status: 'active' }));
    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      // Post-verification fix: `category` is now required by
      // `queryInputSchema` (see routes/query-sets.ts's nullability
      // reconciliation) — included here so this test still exercises the
      // draft-only guard, not a validation 422.
      body: JSON.stringify({ text: 'a new query', category: 'category' }),
    });
    expect(res.status).toBe(409);
    expect(db.queries.create).not.toHaveBeenCalled();
  });

  it('PATCH edits a query while draft', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet());
    db.queries.findFirst.mockResolvedValue({ id: 'q-1', query_set_id: 'qs-1', organization_id: 'org-1' });
    db.queries.update.mockResolvedValue({
      id: 'q-1',
      query_set_id: 'qs-1',
      text: 'edited text',
      intent_type: null,
      category: null,
      tags: [],
      priority: 2,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries/q-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ text: 'edited text' }),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE soft-deletes a query and decrements query_count, only while draft', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet());
    db.queries.findFirst.mockResolvedValue({ id: 'q-1', query_set_id: 'qs-1', organization_id: 'org-1' });
    db.queries.update.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries/q-1', {
      method: 'DELETE',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
    expect(db.queries.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deleted_at: expect.any(Date) }) }),
    );
    expect(db.query_sets.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ query_count: { decrement: 1 } }) }),
    );
  });

  it('DELETE 409s once the query set is active', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ status: 'active' }));
    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries/q-1', {
      method: 'DELETE',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(409);
    expect(db.queries.update).not.toHaveBeenCalled();
  });

  it('GET lists queries filtered by category', async () => {
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet());
    db.queries.findMany.mockResolvedValue([
      {
        id: 'q-1',
        query_set_id: 'qs-1',
        text: 'What is freight visibility software?',
        intent_type: 'informational',
        category: 'category',
        tags: [],
        priority: 3,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries?category=category', {
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(db.queries.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'category' }) }),
    );
  });
});

// Post-verification fix (backend bug #2): `POST /generate` correctly capped
// against `queries_per_query_set`, but manual add never checked the cap at
// all — a user could generate up to the limit, then add unlimited queries
// manually. These tests prove the entitlement check added to this route.
describe('entitlement cap on manual add — POST /query-sets/:id/queries', () => {
  it('402s once the query set has reached the free plan\'s 50-query cap, and never calls queries.create', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' });
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ query_count: 50 }));
    db.queries.count.mockResolvedValue(50);

    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ text: 'one query too many', category: 'category' }),
    });

    expect(res.status).toBe(402);
    expect(db.queries.create).not.toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: 'query_limit_reached', metric: 'queries_per_query_set', limit: 50, current: 50, plan: 'free' });
  });

  it('allows the add when under the cap', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' });
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ query_count: 49 }));
    db.queries.count.mockResolvedValue(49);
    db.queries.create.mockResolvedValue({
      id: 'q-new',
      query_set_id: 'qs-1',
      text: 'the 50th query',
      intent_type: 'commercial',
      category: 'size',
      tags: [],
      priority: 2,
      source: 'manual',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ text: 'the 50th query', category: 'size' }),
    });

    expect(res.status).toBe(201);
    expect(db.queries.create).toHaveBeenCalled();
  });

  it('does not cap on the growth plan at the same count (limit is 500, not 50)', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'growth' });
    db.query_sets.findFirst.mockResolvedValue(draftQuerySet({ query_count: 50, plan_tier: 'growth', plan_limit: 500 }));
    db.queries.count.mockResolvedValue(50);
    db.queries.create.mockResolvedValue({
      id: 'q-new',
      query_set_id: 'qs-1',
      text: 'past the free cap, under the growth cap',
      intent_type: 'informational',
      category: 'category',
      tags: [],
      priority: 3,
      source: 'manual',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/query-sets/qs-1/queries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ text: 'past the free cap, under the growth cap', category: 'category' }),
    });

    expect(res.status).toBe(201);
  });
});
