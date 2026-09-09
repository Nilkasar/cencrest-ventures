import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  integrations: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
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
  integrations: db.integrations,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: integrations } = await import('./integrations.js');
  const app = new Hono();
  app.route('/integrations', integrations);
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
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
});

describe('POST /integrations/:provider/connect', () => {
  it('400s for an unsupported provider slug', async () => {
    const app = await buildApp();
    const res = await app.request('/integrations/bing_webmaster/connect', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(400);
    expect(db.integrations.upsert).not.toHaveBeenCalled();
  });

  it('connects google_search_console, storing only a tagged mock token, never a real one — and never returns config_enc', async () => {
    db.integrations.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
      id: 'integ-1',
      integration_type: 'gsc',
      status: 'connected',
      connected_at: new Date(),
      disconnected_at: null,
      last_synced_at: null,
      ...create,
    }));

    const app = await buildApp();
    const res = await app.request('/integrations/google_search_console/connect', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider).toBe('google_search_console');
    expect(body.status).toBe('connected');
    expect(body).not.toHaveProperty('config_enc');
    expect(body).not.toHaveProperty('accessTokenEnc');

    const [[callArgs]] = db.integrations.upsert.mock.calls as [[{ create: { config_enc: { accessTokenEnc: string } } }]];
    expect(callArgs.create.config_enc.accessTokenEnc).toMatch(/^mock:/); // clearly tagged, never a real token
  });

  it('403s for a viewer (below manage_integrations)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/integrations/google_search_console/connect', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /integrations', () => {
  it('lists connections without ever including config_enc', async () => {
    db.integrations.findMany.mockResolvedValue([
      {
        id: 'integ-1',
        integration_type: 'gsc',
        status: 'connected',
        connected_at: new Date(),
        disconnected_at: null,
        last_synced_at: null,
        config_enc: { accessTokenEnc: 'mock:secret' },
      },
    ]);
    const app = await buildApp();
    const res = await app.request('/integrations', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0]!.provider).toBe('google_search_console');
    expect(body[0]).not.toHaveProperty('config_enc');
  });
});

describe('POST /integrations/:provider/disconnect', () => {
  it('404s when nothing is connected yet', async () => {
    db.integrations.findUnique.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/integrations/google_search_console/disconnect', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(404);
  });

  it('disconnects and clears config_enc (no stale mock credential left behind)', async () => {
    db.integrations.findUnique.mockResolvedValue({ id: 'integ-1', status: 'connected', deleted_at: null });
    db.integrations.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'integ-1',
      integration_type: 'gsc',
      last_synced_at: null,
      ...data,
    }));

    const app = await buildApp();
    const res = await app.request('/integrations/google_search_console/disconnect', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('disconnected');
    expect(db.integrations.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'disconnected', config_enc: {} }) }),
    );
  });
});
