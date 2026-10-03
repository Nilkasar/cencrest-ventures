import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

/**
 * Epic 22 Phase 1 — unit tests for every Platform data route
 * (routes/platform/index.ts). The databases are mocked: `db` (request role:
 * auth, rate limits, role re-read, access-event insert, magic-link token) and
 * `platformDb` (cross-tenant reads, cancel writes). Real-database behaviour
 * is covered by scripts/platform-smoke.ts.
 */

const h = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
  });
  return {
    db: {
      users: { findUnique: vi.fn() },
      organizations: { findUnique: vi.fn() },
      platform_access_events: { createMany: vi.fn() },
      organization_rate_limits: { upsert: vi.fn() },
      magic_link_tokens: { create: vi.fn() },
      audit_events: { createMany: vi.fn(), create: vi.fn() },
    },
    platformDb: {
      $queryRawUnsafe: vi.fn(),
      organizations: model(),
      crawl_jobs: model(),
      ai_runs: model(),
      agent_runs: model(),
      snapshot_requests: model(),
      users: model(),
    },
    writeAuditEvent: vi.fn(),
    checkRls: vi.fn(),
    healthCheck: vi.fn(),
  };
});

vi.mock('@bebest/database', () => ({
  db: h.db,
  withOrgContext: vi.fn(),
  withUserContext: vi.fn(),
  checkRlsEnforcement: h.checkRls,
}));

vi.mock('@bebest/database/platform', () => {
  class PlatformDatabaseNotConfiguredError extends Error {}
  return {
    platformDb: h.platformDb,
    getPlatformDb: () => h.platformDb,
    PlatformDatabaseNotConfiguredError,
  };
});

vi.mock('../../lib/audit.js', () => ({ writeAuditEvent: h.writeAuditEvent }));

vi.mock('../../lib/ai-visibility/provider-registry.js', () => ({
  getDefaultAiProviderRegistry: () => ({ get: () => ({ healthCheck: h.healthCheck }) }),
}));

// Response bodies are asserted field by field; typing every shape here would
// duplicate the route types the assertions already pin down.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const STAFF = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'staff@bebestwithai.com',
  name: 'Staff',
  deleted_at: null,
};
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const sent: { to: string; magicLinkUrl: string }[] = [];
const emailSender = {
  sendMagicLink: vi.fn(async (p: { to: string; magicLinkUrl: string }) => {
    sent.push(p);
  }),
  sendInvitation: vi.fn(),
  sendSnapshotReady: vi.fn(),
  sendNotification: vi.fn(),
};

function platformRole(role: 'none' | 'support' | 'admin') {
  h.db.users.findUnique.mockImplementation(async (args: { select?: unknown }) =>
    args.select ? { platform_role: role, deleted_at: null } : STAFF,
  );
}

async function buildApp() {
  const { createPlatformRoutes } = await import('./index.js');
  const app = new Hono();
  app.route('/api/platform', createPlatformRoutes(emailSender));
  app.onError((err, c) => c.json({ error: 'Internal server error', message: err.message }, 500));
  return app;
}

async function req(app: Hono, method: string, path: string) {
  const { signAccessToken } = await import('../../lib/jwt.js');
  const token = await signAccessToken({ sub: STAFF.id, email: STAFF.email, org: null });
  return app.request(path, { method, headers: { authorization: `Bearer ${token}` } });
}

/** A `pagedQuery` result: one row per item plus `__total`, or the lone total row. */
function paged(rows: Record<string, unknown>[], total = rows.length) {
  return rows.length ? rows.map((r) => ({ __total: total, ...r })) : [{ __total: total, id: null }];
}

const ORIGINAL_PLATFORM_URL = process.env.PLATFORM_DATABASE_URL;

beforeEach(async () => {
  vi.clearAllMocks();
  sent.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env.PLATFORM_DATABASE_URL = 'postgresql://bebest_platform@localhost/test';
  h.db.platform_access_events.createMany.mockResolvedValue({ count: 1 });
  h.db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  h.db.magic_link_tokens.create.mockResolvedValue({});
  h.writeAuditEvent.mockResolvedValue(undefined);
  const { __setKeysForTesting } = await import('../../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);
});

afterEach(() => {
  if (ORIGINAL_PLATFORM_URL === undefined) delete process.env.PLATFORM_DATABASE_URL;
  else process.env.PLATFORM_DATABASE_URL = ORIGINAL_PLATFORM_URL;
});

afterAll(async () => {
  const { __setKeysForTesting } = await import('../../lib/jwt.js');
  __setKeysForTesting(null, null);
});

const SUPPORT_ROUTES: [string, string][] = [
  ['GET', '/api/platform/overview'],
  ['GET', '/api/platform/capabilities'],
  ['GET', '/api/platform/orgs'],
  ['GET', `/api/platform/orgs/${ORG_ID}`],
  ['GET', '/api/platform/users'],
  ['GET', `/api/platform/users/${USER_ID}`],
  ['GET', '/api/platform/agencies'],
  ['GET', `/api/platform/agencies/${ORG_ID}/clients`],
  ['GET', '/api/platform/jobs'],
  ['GET', '/api/platform/audit'],
  ['GET', '/api/platform/growth/snapshots'],
];
const ADMIN_ROUTES: [string, string][] = [
  ['POST', `/api/platform/users/${USER_ID}/magic-link`],
  ['POST', `/api/platform/jobs/crawl/${JOB_ID}/cancel`],
];

describe('Platform routes — gating', () => {
  it.each([...SUPPORT_ROUTES, ...ADMIN_ROUTES])('%s %s → 401 without a token', async (method, path) => {
    const app = await buildApp();
    expect((await app.request(path, { method })).status).toBe(401);
  });

  it.each([...SUPPORT_ROUTES, ...ADMIN_ROUTES])("%s %s → 403 for platform_role 'none', nothing audited, nothing read", async (method, path) => {
    platformRole('none');
    const app = await buildApp();
    const res = await req(app, method, path);
    expect(res.status).toBe(403);
    expect(h.db.platform_access_events.createMany).not.toHaveBeenCalled();
    expect(h.platformDb.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it.each(ADMIN_ROUTES)('%s %s → 403 for support (admin only)', async (method, path) => {
    platformRole('support');
    const app = await buildApp();
    expect((await req(app, method, path)).status).toBe(403);
    expect(h.platformDb.crawl_jobs.updateMany).not.toHaveBeenCalled();
    expect(emailSender.sendMagicLink).not.toHaveBeenCalled();
  });

  it.each(SUPPORT_ROUTES.filter(([, p]) => !p.endsWith('/capabilities')))(
    '%s %s → 503 when PLATFORM_DATABASE_URL is unset (after the role check)',
    async (method, path) => {
      delete process.env.PLATFORM_DATABASE_URL;
      platformRole('support');
      const app = await buildApp();
      const res = await req(app, method, path);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'Platform database not configured' });
      expect(h.platformDb.$queryRawUnsafe).not.toHaveBeenCalled();
    },
  );

  it('maps a PlatformDatabaseNotConfiguredError thrown by platformDb to 503 (backstop)', async () => {
    platformRole('support');
    const { PlatformDatabaseNotConfiguredError } = await import('@bebest/database/platform');
    h.platformDb.$queryRawUnsafe.mockRejectedValue(new PlatformDatabaseNotConfiguredError());
    const app = await buildApp();
    expect((await req(app, 'GET', '/api/platform/overview')).status).toBe(503);
  });

  it('records target_org_id for /orgs/:id and target_user_id for /users/:id', async () => {
    platformRole('support');
    h.platformDb.$queryRawUnsafe.mockResolvedValue([{ d: { org: null } }]);
    const app = await buildApp();
    await req(app, 'GET', `/api/platform/orgs/${ORG_ID}`);
    expect(h.db.platform_access_events.createMany.mock.calls[0]![0].data[0]).toMatchObject({
      target_org_id: ORG_ID,
      action: 'GET /api/platform/orgs/:id',
    });
    h.platformDb.$queryRawUnsafe.mockResolvedValue([{ d: { user: null } }]);
    await req(app, 'GET', `/api/platform/users/${USER_ID}`);
    expect(h.db.platform_access_events.createMany.mock.calls[1]![0].data[0]).toMatchObject({ target_user_id: USER_ID });
  });
});

describe('Pagination and validation', () => {
  beforeEach(() => platformRole('support'));

  it('clamps limit=500 to 100 and echoes it; binds limit/offset as parameters', async () => {
    h.platformDb.$queryRawUnsafe.mockResolvedValue(paged([], 0));
    const app = await buildApp();
    const res = await req(app, 'GET', '/api/platform/orgs?limit=500&offset=20');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0, limit: 100, offset: 20 });
    const args = h.platformDb.$queryRawUnsafe.mock.calls[0]!;
    expect(args.slice(-2)).toEqual([100, 20]);
  });

  it('defaults to limit 25 offset 0, and keeps total when the offset is past the end', async () => {
    h.platformDb.$queryRawUnsafe.mockResolvedValue(paged([], 7));
    const app = await buildApp();
    expect(await (await req(app, 'GET', '/api/platform/users?offset=50')).json()).toEqual({ items: [], total: 7, limit: 25, offset: 50 });
  });

  it.each([
    '/api/platform/orgs?limit=abc',
    '/api/platform/orgs?offset=-1',
    '/api/platform/orgs?kind=martian',
    '/api/platform/orgs?plan=platinum',
    '/api/platform/users?platformRole=root',
    '/api/platform/jobs?type=cron',
    '/api/platform/jobs?status=exploded',
    '/api/platform/jobs?orgId=nope',
    '/api/platform/audit?source=db',
    '/api/platform/audit?from=yesterday',
    '/api/platform/audit?userId=123',
    '/api/platform/growth/snapshots?status=done',
    `/api/platform/agencies/${ORG_ID}/clients?status=married`,
  ])('%s → 422', async (path) => {
    const app = await buildApp();
    expect((await req(app, 'GET', path)).status).toBe(422);
    expect(h.platformDb.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/platform/orgs/not-a-uuid'],
    ['GET', '/api/platform/users/not-a-uuid'],
    ['GET', '/api/platform/agencies/not-a-uuid/clients'],
    ['POST', '/api/platform/jobs/crawl/not-a-uuid/cancel'],
    ['POST', `/api/platform/jobs/cron/${JOB_ID}/cancel`],
    ['POST', '/api/platform/users/not-a-uuid/magic-link'],
  ])('%s %s → 404 for a malformed id', async (method, path) => {
    platformRole('admin');
    const app = await buildApp();
    expect((await req(app, method, path)).status).toBe(404);
  });

  it('escapes LIKE metacharacters in search terms and binds them', async () => {
    h.platformDb.$queryRawUnsafe.mockResolvedValue(paged([], 0));
    const app = await buildApp();
    await req(app, 'GET', `/api/platform/orgs?q=${encodeURIComponent('50%_off')}`);
    const [sql, ...values] = h.platformDb.$queryRawUnsafe.mock.calls[0]!;
    expect(values[0]).toBe('%50\\%\\_off%');
    expect(sql).not.toContain('50%');
  });
});

describe('Read routes', () => {
  beforeEach(() => platformRole('support'));

  it('GET /overview folds the KPI JSON into the documented shape', async () => {
    h.platformDb.$queryRawUnsafe.mockResolvedValue([
      {
        kpis: {
          orgTotal: 3,
          orgNew7d: 1,
          orgByKind: { customer: 2, agency: 1 },
          orgByPlan: { free: 2, none: 1 },
          orgByStatus: { active: 3 },
          users: { total: 5, active7d: 2, active30d: 3, new7d: 1, staff: 1 },
          aiToday: { total: 4, failed: 1 },
          ai7d: { completed: 6, failed: 2, running: 1 },
          agent7d: {},
          crawl7d: { completed: 1, cancelled: 1 },
          snap7d: { complete: 2 },
          stuck: { crawl: 1, ai_run: 0, agent_run: 2, snapshot: 0 },
          leads7d: { free_snapshot: 3, direct: 1 },
        },
      },
    ]);
    const app = await buildApp();
    const body = (await (await req(app, 'GET', '/api/platform/overview')).json()) as Json;
    expect(body.organizations).toEqual({ total: 3, byKind: { customer: 2, agency: 1 }, byPlan: { free: 2, none: 1 }, byStatus: { active: 3 }, new7d: 1 });
    expect(body.aiRuns).toEqual({ today: 4, todayFailed: 1, last7d: 9, byStatus7d: { completed: 6, failed: 2, running: 1 }, failureRate7d: 0.25 });
    expect(body.agentRuns.failureRate7d).toBeNull();
    expect(body.crawlJobs.failureRate7d).toBe(0);
    expect(body.stuckJobs).toEqual({ thresholdMinutes: 30, total: 3, byType: { crawl: 1, ai_run: 0, agent_run: 2, snapshot: 0 } });
    expect(body.leads).toEqual({ new7d: 4, bySource7d: { free_snapshot: 3, direct: 1 } });
    expect(h.platformDb.$queryRawUnsafe).toHaveBeenCalledTimes(1); // one round trip
  });

  it('GET /orgs/:id → 404 when the org does not exist; maps the detail document when it does', async () => {
    const app = await buildApp();
    h.platformDb.$queryRawUnsafe.mockResolvedValueOnce([{ d: { org: null } }]);
    expect((await req(app, 'GET', `/api/platform/orgs/${ORG_ID}`)).status).toBe(404);

    h.platformDb.$queryRawUnsafe.mockResolvedValueOnce([
      {
        d: {
          org: { id: ORG_ID, name: 'Acme', slug: 'acme', kind: 'customer', status: 'active', created_at: '2026-01-01T00:00:00Z', deleted_at: null },
          sub: null,
          members: [{ user_id: USER_ID, name: 'A', email: 'a@x.com', role: 'owner', platform_role: 'none', last_login_at: null, joined_at: '2026-01-01T00:00:00Z' }],
          brand: null,
          ai_runs: [],
          crawl_jobs: [],
          agent_runs: [],
          links: [
            {
              id: JOB_ID, agency_org_id: ORG_ID, status: 'active', access_level: 'full', relationship_type: 'managed',
              consented_at: null, revoked_at: null, created_at: '2026-01-02T00:00:00Z',
              agency: { id: ORG_ID, name: 'Acme', slug: 'acme', kind: 'agency' },
              client: { id: USER_ID, name: 'Client', slug: 'client', kind: 'customer' },
            },
          ],
          audit: [],
          usage: { competitors: 0, active_qs: null, ai_queries: 12, members: 1 },
        },
      },
    ]);
    const body = (await (await req(app, 'GET', `/api/platform/orgs/${ORG_ID}`)).json()) as Json;
    expect(body.plan.slug).toBe('free'); // no subscription → free, as lib/entitlements resolves it
    expect(body.usage.ai_queries_per_month).toEqual({ used: 12, limit: 50 });
    expect(body.usage.pages_analyzed.used).toBeNull();
    expect(body.members[0]).toMatchObject({ userId: USER_ID, role: 'owner' });
    expect(body.agencyLinks.asAgency[0].org.name).toBe('Client');
    expect(body.agencyLinks.asClient).toEqual([]);
  });

  it('GET /jobs builds a UNION over only the job types whose vocabulary has the requested status', async () => {
    h.platformDb.$queryRawUnsafe.mockResolvedValueOnce([]).mockResolvedValueOnce([{ n: 0 }]);
    const app = await buildApp();
    const res = await req(app, 'GET', '/api/platform/jobs?status=cancelled');
    expect(res.status).toBe(200);
    const sql = h.platformDb.$queryRawUnsafe.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM crawl_jobs');
    expect(sql).not.toContain('FROM ai_runs'); // ai_runs cannot be 'cancelled'
  });

  it('GET /jobs maps rows to PlatformJob with progress and cancellable', async () => {
    h.platformDb.$queryRawUnsafe
      .mockResolvedValueOnce([
        {
          type: 'crawl', id: JOB_ID, organization_id: ORG_ID, org_name: 'Acme', org_slug: 'acme', status: 'running',
          label: 'https://a.com', error: null, created_at: '2026-01-01T00:00:00Z', started_at: '2026-01-01T00:00:00Z',
          completed_at: null, done: 3, total: 10, failed: 1, stuck: true,
        },
      ])
      .mockResolvedValueOnce([{ n: 1 }]);
    const app = await buildApp();
    const body = (await (await req(app, 'GET', '/api/platform/jobs?stuck=true')).json()) as Json;
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ type: 'crawl', progress: { done: 3, total: 10, failed: 1 }, stuck: true, cancellable: true, organizationName: 'Acme' });
  });

  it('GET /capabilities works without PLATFORM_DATABASE_URL and reports it', async () => {
    delete process.env.PLATFORM_DATABASE_URL;
    const { __resetCapabilitiesCacheForTesting } = await import('./capabilities.js');
    __resetCapabilitiesCacheForTesting();
    h.healthCheck.mockResolvedValue(false);
    h.checkRls.mockResolvedValue({ role: 'bebest_app', bypassesRls: false, isSuperuser: false, hasBypassRls: false, ownedTenantTables: 0, leakedRowsUnderForeignContext: 0 });
    const app = await buildApp();
    const res = await req(app, 'GET', '/api/platform/capabilities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    const byKey = Object.fromEntries(body.capabilities.map((c: { key: string }) => [c.key, c]));
    expect(byKey.platform_view.status).toBe('blocked');
    expect(byKey.tenant_isolation.status).toBe('working');
    expect(byKey.background_jobs.status).toBe('partial'); // InMemoryJobQueue
    expect(byKey.publishing.status).toBe('stub'); // NullPublishTarget
    expect(byKey.billing.status).toBe('stub'); // NullPaymentProvider
    expect(body.summary.working + body.summary.partial + body.summary.blocked + body.summary.stub).toBe(body.capabilities.length);
    expect(body.cached).toBe(false);
  });

  it('GET /capabilities caches live checks for 60s (no second round of provider calls)', async () => {
    const { __resetCapabilitiesCacheForTesting } = await import('./capabilities.js');
    __resetCapabilitiesCacheForTesting();
    h.healthCheck.mockResolvedValue(true);
    h.checkRls.mockResolvedValue({ role: 'bebest_app', bypassesRls: false, isSuperuser: false, hasBypassRls: false, ownedTenantTables: 0, leakedRowsUnderForeignContext: 0 });
    h.platformDb.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    const app = await buildApp();
    await req(app, 'GET', '/api/platform/capabilities');
    const calls = h.healthCheck.mock.calls.length;
    const second = (await (await req(app, 'GET', '/api/platform/capabilities')).json()) as Json;
    expect(second.cached).toBe(true);
    expect(h.healthCheck.mock.calls.length).toBe(calls);
  });

  it('GET /capabilities time-boxes a hanging provider health check (~3s, reported as timed out)', async () => {
    const { __resetCapabilitiesCacheForTesting } = await import('./capabilities.js');
    __resetCapabilitiesCacheForTesting();
    h.healthCheck.mockReturnValue(new Promise(() => undefined)); // never resolves
    h.checkRls.mockResolvedValue({ role: 'bebest_app', bypassesRls: false, isSuperuser: false, hasBypassRls: false, ownedTenantTables: 0, leakedRowsUnderForeignContext: 0 });
    h.platformDb.$queryRawUnsafe.mockResolvedValue([{}]);
    const app = await buildApp();
    const started = Date.now();
    const body = (await (await req(app, 'GET', '/api/platform/capabilities')).json()) as Json;
    expect(Date.now() - started).toBeLessThan(5_000);
    const ai = body.capabilities.find((c: { key: string }) => c.key === 'ai_visibility');
    // Ollama has no key gate, so its detail shows the time box directly.
    expect(ai.dependencies.find((d: { key: string }) => d.key === 'ai.extraction').detail).toContain('did not answer within the time box');
    expect(ai.dependencies.find((d: { key: string }) => d.key === 'ai.extraction').ok).toBe(false);
  }, 10_000);
});

describe('POST /jobs/:type/:id/cancel (admin)', () => {
  beforeEach(() => platformRole('admin'));

  it.each([
    ['crawl', 'crawl_jobs', 'cancelled', { status: 'cancelled', error: 'Cancelled by platform staff' }],
    ['ai_run', 'ai_runs', 'failed', { status: 'failed', error: 'Cancelled by platform staff' }],
    ['agent_run', 'agent_runs', 'failed', { status: 'failed', error: 'Cancelled by platform staff' }],
    ['snapshot', 'snapshot_requests', 'failed', { status: 'failed', result_json: { error: 'Cancelled by platform staff' } }],
  ] as const)('%s → %s uses its own vocabulary (%s) and audits with org attribution', async (type, table, terminal, data) => {
    const model = h.platformDb[table];
    model.findUnique.mockResolvedValue(
      type === 'snapshot' ? { status: 'processing', converted_to_org_id: null } : { status: 'running', organization_id: ORG_ID },
    );
    model.updateMany.mockResolvedValue({ count: 1 });
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/platform/jobs/${type}/${JOB_ID}/cancel`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      type,
      id: JOB_ID,
      previousStatus: type === 'snapshot' ? 'processing' : 'running',
      status: terminal,
      error: 'Cancelled by platform staff',
    });
    const call = model.updateMany.mock.calls[0]![0];
    expect(call.data).toMatchObject(data);
    // Conditional on an active status — never overwrites a finished job.
    expect(call.where.id).toBe(JOB_ID);
    expect(call.where.status.in.length).toBe(2);
    expect(h.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: STAFF.id,
        organizationId: type === 'snapshot' ? null : ORG_ID,
        action: 'platform.job_cancelled',
        entityType: table,
        entityId: JOB_ID,
        actorRole: 'platform_admin',
        oldValue: { status: type === 'snapshot' ? 'processing' : 'running' },
      }),
    );
  });

  it('409 for a job that is already terminal — no write, no audit', async () => {
    h.platformDb.crawl_jobs.findUnique.mockResolvedValue({ status: 'completed', organization_id: ORG_ID });
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/platform/jobs/crawl/${JOB_ID}/cancel`);
    expect(res.status).toBe(409);
    expect(h.platformDb.crawl_jobs.updateMany).not.toHaveBeenCalled();
    expect(h.writeAuditEvent).not.toHaveBeenCalled();
  });

  it('409 when the job finished between the read and the conditional write', async () => {
    h.platformDb.ai_runs.findUnique
      .mockResolvedValueOnce({ status: 'running', organization_id: ORG_ID })
      .mockResolvedValueOnce({ status: 'completed', organization_id: ORG_ID });
    h.platformDb.ai_runs.updateMany.mockResolvedValue({ count: 0 });
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/platform/jobs/ai_run/${JOB_ID}/cancel`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: 'completed' });
    expect(h.writeAuditEvent).not.toHaveBeenCalled();
  });

  it('404 for an unknown job id', async () => {
    h.platformDb.agent_runs.findUnique.mockResolvedValue(null);
    const app = await buildApp();
    expect((await req(app, 'POST', `/api/platform/jobs/agent_run/${JOB_ID}/cancel`)).status).toBe(404);
  });
});

describe('POST /users/:id/magic-link (admin)', () => {
  beforeEach(() => platformRole('admin'));

  it('issues a token through the shared magic-link path, emails the user, audits, never returns the link', async () => {
    h.platformDb.users.findUnique.mockResolvedValue({ id: USER_ID, email: 'user@example.com', deleted_at: null });
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/platform/users/${USER_ID}/magic-link`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toEqual({ sent: true, userId: USER_ID, email: 'user@example.com' });
    expect(h.db.magic_link_tokens.create).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('user@example.com');
    expect(JSON.stringify(body)).not.toContain(sent[0]!.magicLinkUrl.split('token=')[1]!);
    expect(h.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform.magic_link_sent', entityId: USER_ID, organizationId: null, userId: STAFF.id }),
    );
  });

  it('404 for a deleted or unknown user, and sends nothing', async () => {
    h.platformDb.users.findUnique.mockResolvedValue({ id: USER_ID, email: 'u@x.com', deleted_at: new Date() });
    const app = await buildApp();
    expect((await req(app, 'POST', `/api/platform/users/${USER_ID}/magic-link`)).status).toBe(404);
    expect(emailSender.sendMagicLink).not.toHaveBeenCalled();
  });
});
