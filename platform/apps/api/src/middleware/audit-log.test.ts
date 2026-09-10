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

    const res = await app.request('/orgs/acme/members/22222222-2222-4222-8222-222222222222', { method: 'POST' });
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
      entityId: '22222222-2222-4222-8222-222222222222',
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

    const res = await app.request('/orgs/acme/members/22222222-2222-4222-8222-222222222222', { method: 'POST' });
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

  // `audit_events.entity_id` is a UUID column. It used to receive the
  // literal string 'unknown' whenever a route had no `:id`, which Postgres
  // rejects — and `writeAuditEvent` swallows its own failures, so those
  // events wrote no row at all instead of failing loudly.
  describe('entity id resolution', () => {
    it('writes null rather than a placeholder when there is no entity', async () => {
      const { auditLog } = await import('./audit-log.js');
      const app = new Hono<AppEnv>();

      app.post(
        '/webhooks/billing',
        auditLog({ action: 'billing.webhook_received', entityType: 'webhook', actorType: 'system' }),
        (c) => c.json({ ok: true }),
      );

      await app.request('/webhooks/billing', { method: 'POST' });
      expect(writeAuditEventMock.mock.calls[0]?.[0].entityId).toBeNull();
    });

    it('drops a route param that is not a UUID instead of handing it to the database', async () => {
      const { auditLog } = await import('./audit-log.js');
      const app = new Hono<AppEnv>();

      app.post(
        '/things/:id',
        auditLog({ action: 'thing.updated', entityType: 'thing' }),
        (c) => c.json({ ok: true }),
      );

      await app.request('/things/not-a-uuid', { method: 'POST' });
      expect(writeAuditEventMock.mock.calls[0]?.[0].entityId).toBeNull();
    });

    it('falls back to the acting user for user-entity events like login', async () => {
      const { auditLog } = await import('./audit-log.js');
      const app = new Hono<AppEnv>();

      app.post(
        '/logout',
        async (c, next) => {
          c.set('user', {
            id: '33333333-3333-4333-8333-333333333333',
            email: 'a@example.com',
            name: 'Ada',
            tokenOrgId: null,
          });
          await next();
        },
        auditLog({ action: 'auth.logout', entityType: 'user' }),
        (c) => c.json({ ok: true }),
      );

      await app.request('/logout', { method: 'POST' });
      expect(writeAuditEventMock.mock.calls[0]?.[0].entityId).toBe(
        '33333333-3333-4333-8333-333333333333',
      );
    });
  });
});
