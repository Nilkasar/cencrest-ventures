import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  brands: db.brands,
  users: db.users,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: brands } = await import('./brands.js');
  const app = new Hono();
  app.route('/brands', brands);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({
    id: 'org-1',
    slug: 'acme',
    name: 'Acme',
    deleted_at: null,
  });
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
});

describe('GET /brands/me', () => {
  it('404s when the organization has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('returns the brand for a viewer (read-only role is enough to view)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    db.brands.findFirst.mockResolvedValue({
      id: 'brand-1',
      name: 'Acme Corp',
      description: null,
      website_url: 'https://acme.example',
      industries: ['SaaS'],
      categories: [],
      markets: [],
      logo_url: null,
      aliases: [],
      positioning: null,
      value_proposition: null,
      differentiators: [],
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });
    const app = await buildApp();
    const res = await app.request('/brands/me', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'brand-1', name: 'Acme Corp', websiteUrl: 'https://acme.example' });
  });
});

describe('PATCH /brands/me', () => {
  it('403s for a viewer (below create_brand_profile)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/brands/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(res.status).toBe(403);
  });

  it('403s for an editor too — brand profile is owner/admin/analyst-write only', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const app = await buildApp();
    const res = await app.request('/brands/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(res.status).toBe(403);
  });

  it('422s when creating without a name', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ description: 'no name given' }),
    });
    expect(res.status).toBe(422);
  });

  it('creates the brand (201) when none exists and writes an audit event', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    db.brands.create.mockResolvedValue({
      id: 'brand-1',
      name: 'Acme Corp',
      description: null,
      website_url: null,
      industries: [],
      categories: [],
      markets: [],
      logo_url: null,
      aliases: [],
      positioning: null,
      value_proposition: null,
      differentiators: [],
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/brands/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Acme Corp' }),
    });

    expect(res.status).toBe(201);
    expect(db.brands.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organization_id: 'org-1', name: 'Acme Corp', created_by: 'user-1' }),
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'brand.created' }) }),
    );
  });

  it('updates the existing brand (200) when one already exists', async () => {
    db.brands.findFirst.mockResolvedValue({
      id: 'brand-1',
      name: 'Old Name',
      organization_id: 'org-1',
    });
    db.brands.update.mockResolvedValue({
      id: 'brand-1',
      name: 'New Name',
      description: null,
      website_url: null,
      industries: [],
      categories: [],
      markets: [],
      logo_url: null,
      aliases: [],
      positioning: null,
      value_proposition: null,
      differentiators: [],
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/brands/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'New Name' }),
    });

    expect(res.status).toBe(200);
    expect(db.brands.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'brand-1' }, data: expect.objectContaining({ name: 'New Name' }) }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'brand.updated' }) }),
    );
  });

  it('rejects a non-http(s) websiteUrl', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Acme', websiteUrl: 'javascript:alert(1)' }),
    });
    expect(res.status).toBe(422);
  });
});
