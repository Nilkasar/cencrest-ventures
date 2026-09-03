import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const db = {
  leads: { create: vi.fn(), update: vi.fn() },
  snapshot_requests: { create: vi.fn(), findUnique: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};
const tx = { leads: db.leads };

vi.mock('@bebest/database', () => ({
  db,
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

const runFreeSnapshotPipeline = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/free-snapshot/orchestrator.js', () => ({ runFreeSnapshotPipeline }));

process.env.CRM_INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';

async function buildApp() {
  const { createSnapshotRoutes } = await import('./snapshot.js');
  const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn() };
  const app = new Hono();
  app.route('/snapshot', createSnapshotRoutes(emailSender));
  return { app, emailSender };
}

const VALID_BODY = {
  name: 'Ada Lovelace',
  email: 'ada@acme.example',
  company: 'Acme Inc',
  website: 'https://acme.example',
  category: 'CRM software',
  biggestCompetitor: 'Rival Inc',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  db.leads.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'lead-1', ...data }));
  db.leads.update.mockResolvedValue({});
  db.snapshot_requests.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'snap-db-id-1',
    status: 'pending',
    result_json: null,
    ...data,
  }));
});

describe('POST /snapshot', () => {
  it('429s and creates NO lead/snapshot row at all when the free-snapshot rate limit (1/hour/IP) is already exhausted', async () => {
    db.organization_rate_limits.upsert.mockResolvedValue({ count: 2 }); // already over the limit of 1
    const { app } = await buildApp();

    const res = await app.request('/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(429);
    expect(db.leads.create).not.toHaveBeenCalled();
    expect(db.snapshot_requests.create).not.toHaveBeenCalled();
    expect(runFreeSnapshotPipeline).not.toHaveBeenCalled();
  });

  it('rejects a non-public-http(s) website (SSRF guard reused exactly like routes/leads.ts) BEFORE creating a lead', async () => {
    const { app } = await buildApp();
    const res = await app.request('/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, website: 'http://169.254.169.254/latest/meta-data' }),
    });

    expect(res.status).toBe(422);
    expect(db.leads.create).not.toHaveBeenCalled();
  });

  it('creates the leads row (source: free_snapshot) BEFORE the snapshot_requests row and BEFORE the pipeline is scheduled, in that exact order', async () => {
    const callOrder: string[] = [];
    db.leads.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      callOrder.push('leads.create');
      return { id: 'lead-1', ...data };
    });
    db.snapshot_requests.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      callOrder.push('snapshot_requests.create');
      return { id: 'snap-db-id-1', ...data };
    });
    runFreeSnapshotPipeline.mockImplementation(async () => {
      callOrder.push('runFreeSnapshotPipeline');
    });

    const { app } = await buildApp();
    const res = await app.request('/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.message).toBe("Your snapshot is being prepared. We'll email you within 24 hours.");

    expect(db.leads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'free_snapshot', email: VALID_BODY.email, name: VALID_BODY.name }),
      }),
    );

    // The literal invariant this epic's DoD requires: the lead exists
    // before ANY of the crawl/queries/AI/SEO/report pipeline runs.
    await new Promise((resolve) => setImmediate(resolve));
    expect(callOrder).toEqual(['leads.create', 'snapshot_requests.create', 'runFreeSnapshotPipeline']);
  });

  it('never returns the snapshot_requests DB id — only an opaque token — and never returns the lead\'s id', async () => {
    const { app } = await buildApp();
    const res = await app.request('/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });

    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.token).toBe('string');
    expect(body.token).not.toBe('snap-db-id-1');
    expect(body.reportUrl).toContain(String(body.token));
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('leadId');
    expect(body).not.toHaveProperty('snapshotRequestId');

    // The DB row was created with only a HASH of the token, never the raw value.
    const createCall = db.snapshot_requests.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(createCall.data.token_hash).not.toBe(body.token);
    expect(createCall.data.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('passes the raw token (not the DB id) through to the orchestrator, so the emailed report link is buildable without ever re-reading the plaintext token from the database', async () => {
    const { app } = await buildApp();
    const res = await app.request('/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    const body = (await res.json()) as Record<string, unknown>;

    await new Promise((resolve) => setImmediate(resolve));
    expect(runFreeSnapshotPipeline).toHaveBeenCalledWith(
      'snap-db-id-1',
      body.token,
      expect.objectContaining({ company: 'Acme Inc', website: 'https://acme.example' }),
      expect.objectContaining({ emailSender: expect.anything() }),
    );
  });
});

describe('GET /snapshot/:token', () => {
  it('404s for an unknown token without leaking whether ANY snapshot exists', async () => {
    db.snapshot_requests.findUnique.mockResolvedValue(null);
    const { app } = await buildApp();
    const res = await app.request('/snapshot/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns a "still preparing" state for pending/processing, never the raw result_json', async () => {
    db.snapshot_requests.findUnique.mockResolvedValue({ status: 'processing', result_json: null });
    const { app } = await buildApp();
    const res = await app.request('/snapshot/some-token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('processing');
    expect(body).not.toHaveProperty('report');
  });

  it('returns the completed report once status is complete', async () => {
    db.snapshot_requests.findUnique.mockResolvedValue({ status: 'complete', result_json: { aiVisibility: { score: 42 } } });
    const { app } = await buildApp();
    const res = await app.request('/snapshot/some-token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('complete');
    expect(body.report).toEqual({ aiVisibility: { score: 42 } });
  });

  it('never leaks internal error detail from a failed pipeline run', async () => {
    db.snapshot_requests.findUnique.mockResolvedValue({ status: 'failed', result_json: { error: 'stack trace with secrets' } });
    const { app } = await buildApp();
    const res = await app.request('/snapshot/some-token');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect(JSON.stringify(body)).not.toContain('secrets');
  });

  it('looks the token up by its hash, never by the raw path param directly', async () => {
    db.snapshot_requests.findUnique.mockResolvedValue(null);
    const { app } = await buildApp();
    await app.request('/snapshot/some-raw-token-value');

    const where = db.snapshot_requests.findUnique.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(where.where.token_hash).not.toBe('some-raw-token-value');
    expect(where.where.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
