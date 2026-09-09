import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  brand_entities: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
  brand_entities: db.brand_entities,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: brandEntities } = await import('./brand-entities.js');
  const app = new Hono();
  app.route('/entities', brandEntities);
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

describe('POST /entities', () => {
  it('403s for an editor (owner/admin/analyst-write only)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const app = await buildApp();
    const res = await app.request('/entities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Widget Pro' }),
    });
    expect(res.status).toBe(403);
  });

  it('422s without a name', async () => {
    const app = await buildApp();
    const res = await app.request('/entities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ schemaType: 'Product' }),
    });
    expect(res.status).toBe(422);
  });

  it('creates an entity scoped to the org brand and audits it', async () => {
    db.brand_entities.create.mockResolvedValue({
      id: 'e-1',
      name: 'Widget Pro',
      schema_type: 'Product',
      description: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/entities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Widget Pro', schemaType: 'Product' }),
    });

    expect(res.status).toBe(201);
    expect(db.brand_entities.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organization_id: 'org-1', brand_id: 'brand-1', name: 'Widget Pro' }),
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'brand_entity.created' }) }),
    );
  });

  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/entities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Widget Pro' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /entities', () => {
  it('lists entities for the org brand', async () => {
    db.brand_entities.findMany.mockResolvedValue([
      { id: 'e-1', name: 'Widget Pro', schema_type: 'Product', description: null, created_at: new Date(), updated_at: new Date() },
    ]);
    const app = await buildApp();
    const res = await app.request('/entities', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });
});

describe('DELETE /entities/:id', () => {
  it('soft-deletes', async () => {
    db.brand_entities.findFirst.mockResolvedValue({ id: 'e-1', organization_id: 'org-1' });
    db.brand_entities.update.mockResolvedValue({});
    const app = await buildApp();
    const res = await app.request('/entities/e-1', { method: 'DELETE', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(db.brand_entities.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deleted_at: expect.any(Date) }) }),
    );
  });
});
