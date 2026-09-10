import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const AGENCY_PLAN = { plans: { slug: 'agency', active: true, limits: { white_label: true } } };
const FREE_PLAN = { plans: { slug: 'free', active: true, limits: { white_label: false } } };

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  white_label_configs: { findUnique: vi.fn(), upsert: vi.fn() },
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
  white_label_configs: db.white_label_configs,
  subscriptions: db.subscriptions,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: whiteLabel } = await import('./white-label.js');
  const app = new Hono();
  app.route('/white-label', whiteLabel);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
  db.subscriptions.findUnique.mockResolvedValue(AGENCY_PLAN);
});

describe('GET /orgs/me/settings/white-label', () => {
  it('returns the documented BeBest default when nothing has been configured yet', async () => {
    db.white_label_configs.findUnique.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/white-label', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; brandName: string };
    expect(body.enabled).toBe(false);
    expect(body.brandName).toBe('BeBest');
  });

  it("returns the org's own configured branding when it exists", async () => {
    db.white_label_configs.findUnique.mockResolvedValue({
      enabled: true,
      brand_name: 'Acme Agency',
      logo_url: 'https://acme.example.com/logo.png',
      primary_color: '#112233',
      secondary_color: null,
      custom_domain: 'reports.acme.example.com',
      support_email: 'support@acme.example.com',
      hide_powered_by: true,
      custom_terms_url: null,
      custom_privacy_url: null,
      deleted_at: null,
    });
    const app = await buildApp();
    const res = await app.request('/white-label', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brandName: string; hidePoweredBy: boolean };
    expect(body.brandName).toBe('Acme Agency');
    expect(body.hidePoweredBy).toBe(true);
  });
});

describe('PATCH /orgs/me/settings/white-label', () => {
  it('402s (feature_not_available) on a plan without the white_label entitlement', async () => {
    db.subscriptions.findUnique.mockResolvedValue(FREE_PLAN);
    const app = await buildApp();
    const res = await app.request('/white-label', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ brandName: 'Acme Agency' }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('feature_not_available');
    expect(db.white_label_configs.upsert).not.toHaveBeenCalled();
  });

  it('403s for a viewer (admin+ required)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/white-label', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ brandName: 'Acme Agency' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a malformed hex color', async () => {
    const app = await buildApp();
    const res = await app.request('/white-label', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ primaryColor: 'not-a-color' }),
    });
    expect(res.status).toBe(422);
  });

  it('upserts on an agency+ plan and is audit-logged', async () => {
    db.white_label_configs.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
      enabled: true,
      brand_name: create.brand_name,
      logo_url: null,
      primary_color: '#ff0000',
      secondary_color: null,
      custom_domain: null,
      support_email: null,
      hide_powered_by: false,
      custom_terms_url: null,
      custom_privacy_url: null,
    }));

    const app = await buildApp();
    const res = await app.request('/white-label', {
      method: 'PATCH',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ brandName: 'Acme Agency', primaryColor: '#ff0000' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brandName: string; primaryColor: string };
    expect(body.brandName).toBe('Acme Agency');
    expect(body.primaryColor).toBe('#ff0000');
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'settings.changed' }) }),
    );
  });
});
