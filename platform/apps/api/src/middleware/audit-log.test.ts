import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../types/context.js';

const writeAuditEventMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/audit.js', () => ({
  writeAuditEvent: writeAuditEventMock,
}));

describe('auditLog middleware', () => {
  beforeEach(() => {
    writeAuditEventMock.mockClear();
  });

  it('logs result: success for a 2xx response, with actor/org from context', async () => {
    const { auditLog } = await import('./audit-log.js');
    const app = new Hono<AppEnv>();

    app.post(
      '/orgs/:slug/members/:id',
      async (c, next) => {
        c.set('user', { id: 'user-1', email: 'a@example.com', name: 'Ada', tokenOrgId: null });
        c.set('org', { organizationId: 'org-1', name: 'Acme', slug: 'acme', role: 'admin' });
        await next();
      },
      auditLog({ action: 'membership.role_changed', entityType: 'membership' }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/orgs/acme/members/user-2', { method: 'POST' });
    expect(res.status).toBe(200);

    expect(writeAuditEventMock).toHaveBeenCalledTimes(1);
    const call = writeAuditEventMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      userId: 'user-1',
      organizationId: 'org-1',
      actorType: 'user',
      actorRole: 'admin',
      action: 'membership.role_changed',
      entityType: 'membership',
      entityId: 'user-2',
      result: 'success',
    });
  });

  it('logs result: failure for a non-2xx/3xx response', async () => {
    const { auditLog } = await import('./audit-log.js');
    const app = new Hono<AppEnv>();

    app.post(
      '/orgs/:slug/members/:id',
      auditLog({ action: 'membership.role_changed', entityType: 'membership' }),
      (c) => c.json({ error: 'nope' }, 403),
    );

    const res = await app.request('/orgs/acme/members/user-2', { method: 'POST' });
    expect(res.status).toBe(403);

    const call = writeAuditEventMock.mock.calls[0]?.[0];
    expect(call.result).toBe('failure');
  });

  it('does not throw when user/org were never set on the request (e.g. failed login)', async () => {
    const { auditLog } = await import('./audit-log.js');
    const app = new Hono<AppEnv>();

    app.post(
      '/login',
      auditLog({ action: 'auth.login_failed', entityType: 'user' }),
      (c) => c.json({ error: 'invalid' }, 401),
    );

    const res = await app.request('/login', { method: 'POST' });
    expect(res.status).toBe(401);

    const call = writeAuditEventMock.mock.calls[0]?.[0];
    expect(call.userId).toBeNull();
    expect(call.organizationId).toBeNull();
    expect(call.result).toBe('failure');
  });
});
