import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return true; // handled separately below
    return value === undefined ? true : row[key] === value;
  });
}

let notificationRows: Array<Record<string, unknown>> = [];

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  notifications: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const or = where.OR as Array<Record<string, unknown>> | undefined;
      return notificationRows
        .filter((r) => matches(r, where))
        .filter((r) => !or || or.some((clause) => matches(r, clause)))
        .sort((a, b) => (b.created_at as Date).getTime() - (a.created_at as Date).getTime());
    }),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const or = where.OR as Array<Record<string, unknown>> | undefined;
      return notificationRows.filter((r) => matches(r, where)).filter((r) => !or || or.some((clause) => matches(r, clause))).length;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = notificationRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = notificationRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
  },
};

const tx = { ...db };

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: notifications } = await import('./notifications.js');
  const app = new Hono();
  app.route('/notifications', notifications);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

function makeNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'notif-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    type: 'report_ready',
    channel: 'in_app',
    title: 'Your report is ready',
    body: null,
    action_url: null,
    read_at: null,
    sent_at: new Date('2026-01-01T00:00:00.000Z'),
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  notificationRows = [];

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
});

describe('GET /notifications', () => {
  it('401s with no auth token', async () => {
    const app = await buildApp();
    const res = await app.request('/notifications');
    expect(res.status).toBe(401);
  });

  it('returns the caller\'s own per-user notifications', async () => {
    notificationRows = [makeNotification()];
    const app = await buildApp();
    const res = await app.request('/notifications', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe('notif-1');
    expect(body.total).toBe(1);
  });

  it('includes org-wide notifications (user_id: null) alongside the caller\'s own', async () => {
    notificationRows = [
      makeNotification({ id: 'notif-mine', user_id: 'user-1' }),
      makeNotification({ id: 'notif-orgwide', user_id: null, type: 'competitor_alert' }),
    ];
    const app = await buildApp();
    const res = await app.request('/notifications', { headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id).sort()).toEqual(['notif-mine', 'notif-orgwide']);
  });

  it('never returns another user\'s per-user notification', async () => {
    notificationRows = [makeNotification({ id: 'notif-other', user_id: 'user-2' })];
    const app = await buildApp();
    const res = await app.request('/notifications', { headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(0);
  });
});

describe('POST /notifications/:id/read', () => {
  it('marks the caller\'s own notification read and persists read_at', async () => {
    notificationRows = [makeNotification()];
    const app = await buildApp();
    const res = await app.request('/notifications/notif-1/read', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notification: { readAt: string | null } };
    expect(body.notification.readAt).not.toBeNull();
    expect(notificationRows[0]!.read_at).toBeInstanceOf(Date);
  });

  it('404s (not a leaking 403) for another user\'s notification', async () => {
    notificationRows = [makeNotification({ id: 'notif-other', user_id: 'user-2' })];
    const app = await buildApp();
    const res = await app.request('/notifications/notif-other/read', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('404s for an org-wide notification — marking it read is a documented scope boundary, not a silent global mark-read', async () => {
    notificationRows = [makeNotification({ id: 'notif-orgwide', user_id: null })];
    const app = await buildApp();
    const res = await app.request('/notifications/notif-orgwide/read', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('is idempotent — reading an already-read notification does not change its read_at', async () => {
    const firstRead = new Date('2026-01-05T00:00:00.000Z');
    notificationRows = [makeNotification({ read_at: firstRead })];
    const app = await buildApp();
    const res = await app.request('/notifications/notif-1/read', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as { notification: { readAt: string } };
    expect(new Date(body.notification.readAt).getTime()).toBe(firstRead.getTime());
  });
});
