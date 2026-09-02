import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requirePermission } from './rbac.js';
import type { AppEnv, OrgContext } from '../types/context.js';

function withOrg(org: OrgContext | null) {
  return async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    if (org) c.set('org', org);
    await next();
  };
}

function buildApp(org: OrgContext | null) {
  const app = new Hono<AppEnv>();
  app.get('/billing', withOrg(org), requirePermission('manage_billing'), (c) =>
    c.json({ ok: true }),
  );
  app.post(
    '/content/:id/approve',
    withOrg(org),
    requirePermission('approve_content', (c) => ({ isOwnResource: c.req.query('mine') === '1' })),
    (c) => c.json({ ok: true }),
  );
  return app;
}

describe('requirePermission middleware', () => {
  it('403s when there is no org context at all (misconfiguration safety net)', async () => {
    const app = buildApp(null);
    const res = await app.request('/billing');
    expect(res.status).toBe(403);
  });

  it('denies an admin trying to manage billing (owner-only)', async () => {
    const app = buildApp({ organizationId: 'o1', name: 'Acme', slug: 'acme', role: 'admin' });
    const res = await app.request('/billing');
    expect(res.status).toBe(403);
  });

  it('allows an owner to manage billing', async () => {
    const app = buildApp({ organizationId: 'o1', name: 'Acme', slug: 'acme', role: 'owner' });
    const res = await app.request('/billing');
    expect(res.status).toBe(200);
  });

  it('lets an editor approve their own content but not someone else\'s', async () => {
    const app = buildApp({ organizationId: 'o1', name: 'Acme', slug: 'acme', role: 'editor' });

    const ownRes = await app.request('/content/1/approve?mine=1', { method: 'POST' });
    expect(ownRes.status).toBe(200);

    const otherRes = await app.request('/content/1/approve?mine=0', { method: 'POST' });
    expect(otherRes.status).toBe(403);
  });
});
