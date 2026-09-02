import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  use_cases: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  use_cases: db.use_cases,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: useCases } = await import('./use-cases.js');
  const app = new Hono();
  app.route('/use-cases', useCases);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1' };

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
});

describe('POST /use-cases', () => {
  it('creates with array fields defaulted to [] when omitted', async () => {
    db.use_cases.create.mockResolvedValue({
      id: 'u-1',
      title: 'Sales teams tracking win rate',
      description: null,
      industries: [],
      company_sizes: [],
      pain_points: [],
      solutions: [],
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/use-cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ title: 'Sales teams tracking win rate' }),
    });

    expect(res.status).toBe(201);
    expect(db.use_cases.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 'org-1',
          brand_id: 'brand-1',
          industries: [],
          pain_points: [],
        }),
      }),
    );
  });

  it('passes through provided array fields', async () => {
    db.use_cases.create.mockResolvedValue({
      id: 'u-2',
      title: 'Enterprise onboarding',
      description: null,
      industries: ['SaaS'],
      company_sizes: ['51-200'],
      pain_points: ['slow onboarding'],
      solutions: ['guided setup'],
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/use-cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({
        title: 'Enterprise onboarding',
        industries: ['SaaS'],
        companySizes: ['51-200'],
        painPoints: ['slow onboarding'],
        solutions: ['guided setup'],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.industries).toEqual(['SaaS']);
    expect(body.painPoints).toEqual(['slow onboarding']);
  });

  it('422s without a title', async () => {
    const app = await buildApp();
    const res = await app.request('/use-cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ description: 'no title' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('PATCH /use-cases/:id', () => {
  it('404s for an unknown id', async () => {
    db.use_cases.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/use-cases/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ title: 'New title' }),
    });
    expect(res.status).toBe(404);
  });
});
