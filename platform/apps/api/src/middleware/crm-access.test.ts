import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const organizationsFindUnique = vi.fn();
const membershipsFindFirst = vi.fn();

vi.mock('@bebest/database', () => ({
  db: {
    organizations: { findUnique: organizationsFindUnique },
  },
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({ memberships: { findFirst: membershipsFindFirst } }),
  ),
}));

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222';

function fakeAuth(tokenOrgId: string | null) {
  return async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('user', { id: 'user-1', email: 'a@example.com', name: 'Ada', tokenOrgId });
    await next();
  };
}

describe('requireCrmAccess', () => {
  const ORIGINAL = process.env.CRM_INTERNAL_ORG_ID;

  beforeEach(() => {
    organizationsFindUnique.mockReset();
    membershipsFindFirst.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRM_INTERNAL_ORG_ID;
    else process.env.CRM_INTERNAL_ORG_ID = ORIGINAL;
  });

  it('500s when CRM_INTERNAL_ORG_ID is not configured', async () => {
    delete process.env.CRM_INTERNAL_ORG_ID;
    const { requireCrmAccess } = await import('./crm-access.js');

    const app = new Hono();
    app.get('/crm/leads', fakeAuth(INTERNAL_ORG_ID), requireCrmAccess('viewer'), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/crm/leads');
    expect(res.status).toBe(500);
  });

  it("403s when the caller's token org is not the internal operations org", async () => {
    process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG_ID;
    organizationsFindUnique.mockResolvedValue({
      id: OTHER_ORG_ID,
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue({ role: 'owner' });
    const { requireCrmAccess } = await import('./crm-access.js');

    const app = new Hono();
    app.get('/crm/leads', fakeAuth(OTHER_ORG_ID), requireCrmAccess('viewer'), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/crm/leads');
    expect(res.status).toBe(403);
  });

  it('409s when the caller has not selected any org yet (delegates to requireOrgFromToken)', async () => {
    process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG_ID;
    const { requireCrmAccess } = await import('./crm-access.js');

    const app = new Hono();
    app.get('/crm/leads', fakeAuth(null), requireCrmAccess('viewer'), (c) => c.json({ ok: true }));

    const res = await app.request('/crm/leads');
    expect(res.status).toBe(409);
  });

  it('passes through when the caller is a member of the internal org at a sufficient role', async () => {
    process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG_ID;
    organizationsFindUnique.mockResolvedValue({
      id: INTERNAL_ORG_ID,
      slug: 'bebest-internal',
      name: 'BeBest Internal',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue({ role: 'analyst' });
    const { requireCrmAccess } = await import('./crm-access.js');

    const app = new Hono();
    app.get('/crm/leads', fakeAuth(INTERNAL_ORG_ID), requireCrmAccess('viewer'), (c) =>
      c.json(c.get('org')),
    );

    const res = await app.request('/crm/leads');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { role: string }).role).toBe('analyst');
  });

  it('403s when the role is below the required minimum, even in the internal org', async () => {
    process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG_ID;
    organizationsFindUnique.mockResolvedValue({
      id: INTERNAL_ORG_ID,
      slug: 'bebest-internal',
      name: 'BeBest Internal',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue({ role: 'viewer' });
    const { requireCrmAccess } = await import('./crm-access.js');

    const app = new Hono();
    app.get('/crm/leads', fakeAuth(INTERNAL_ORG_ID), requireCrmAccess('admin'), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/crm/leads');
    expect(res.status).toBe(403);
  });
});
