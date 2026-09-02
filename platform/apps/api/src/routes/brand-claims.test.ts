import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  brand_claims: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  brand_claims: db.brand_claims,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: brandClaims } = await import('./brand-claims.js');
  const app = new Hono();
  app.route('/claims', brandClaims);
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

describe('POST /claims', () => {
  it('defaults confidence to medium and verified to false', async () => {
    db.brand_claims.create.mockResolvedValue({
      id: 'cl-1',
      claim: 'Fastest onboarding in the category',
      evidence: null,
      confidence: 'medium',
      verified: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ claim: 'Fastest onboarding in the category' }),
    });

    expect(res.status).toBe(201);
    expect(db.brand_claims.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ confidence: 'medium', verified: false }) }),
    );
  });

  it('accepts an explicit high confidence + verified claim', async () => {
    db.brand_claims.create.mockResolvedValue({
      id: 'cl-2',
      claim: 'Certified SOC 2 Type II',
      evidence: 'https://acme.example/trust',
      confidence: 'high',
      verified: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({
        claim: 'Certified SOC 2 Type II',
        evidence: 'https://acme.example/trust',
        confidence: 'high',
        verified: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ confidence: 'high', verified: true });
  });

  it('422s for an invalid confidence value', async () => {
    const app = await buildApp();
    const res = await app.request('/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ claim: 'Something', confidence: 'certain' }),
    });
    expect(res.status).toBe(422);
  });

  it('422s for an empty claim', async () => {
    const app = await buildApp();
    const res = await app.request('/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ claim: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('403s for a viewer', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ claim: 'Something' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /claims/:id', () => {
  it('soft-deletes and audits', async () => {
    db.brand_claims.findFirst.mockResolvedValue({ id: 'cl-1', organization_id: 'org-1' });
    db.brand_claims.update.mockResolvedValue({});
    const app = await buildApp();
    const res = await app.request('/claims/cl-1', { method: 'DELETE', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'brand_claim.deleted' }) }),
    );
  });
});
