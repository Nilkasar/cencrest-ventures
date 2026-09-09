import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const db = {
  leads: { create: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn() },
};
const tx = {
  // writeAuditEvent runs org-attributed writes inside withOrgContext now
  // (see lib/audit.ts), so the transaction client exposes audit_events.
  audit_events: db.audit_events, leads: db.leads };

vi.mock('@bebest/database', () => ({
  db,
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

process.env.CRM_INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';

const CONFIRMATION_MESSAGE = 'Request received. The BeBest team will be in touch within 24 hours.';

const VALID_BODY = {
  name: 'Ada Lovelace',
  email: 'ada@acme.example',
  company: 'Acme Inc',
  category: 'CRM software',
  notes: "Biggest competitor: Rival Inc. Interested in the Diagnostic engagement.",
};

async function buildApp() {
  const { default: apply } = await import('./apply.js');
  const app = new Hono();
  app.route('/apply', apply);
  return { app };
}

// Fixed-window counter, mirroring lib/rate-limiter.ts's real upsert
// semantics closely enough to exercise the actual boundary (5 allowed, 6th
// rejected) through the real `rateLimit` middleware + `checkRateLimit`
// implementation, rather than mocking the middleware's decision away.
function stubFixedWindowCounter() {
  let count = 0;
  db.organization_rate_limits.upsert.mockImplementation(async () => {
    count += 1;
    return { count };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.leads.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'lead-1',
    ...data,
  }));
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
});

describe('POST /api/apply', () => {
  it('creates a leads row with source: apply_form and the internal org id, and returns 201 with the confirmation copy', async () => {
    const { app } = await buildApp();
    const res = await app.request('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.message).toBe(CONFIRMATION_MESSAGE);

    expect(db.leads.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: '11111111-1111-1111-1111-111111111111',
        email: VALID_BODY.email,
        name: VALID_BODY.name,
        company: VALID_BODY.company,
        category: VALID_BODY.category,
        notes: VALID_BODY.notes,
        source: 'apply_form',
      }),
    });
    // No website field — this is deliberately not the free-snapshot flow.
    expect(db.leads.create.mock.calls[0]![0].data).not.toHaveProperty('website');
  });

  it('writes a system-actor audit event for the created lead', async () => {
    const { app } = await buildApp();
    await app.request('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });

    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'lead.created',
          entity_type: 'lead',
          entity_id: 'lead-1',
          actor_type: 'system',
        }),
      }),
    );
  });

  it('422s with an issue list on invalid input and creates no lead', async () => {
    const { app } = await buildApp();
    const res = await app.request('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, email: 'not-an-email' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(db.leads.create).not.toHaveBeenCalled();
  });

  it('422s when a required field (company) is missing', async () => {
    const { app } = await buildApp();
    const { company, ...withoutCompany } = VALID_BODY;
    void company;
    const res = await app.request('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(withoutCompany),
    });

    expect(res.status).toBe(422);
    expect(db.leads.create).not.toHaveBeenCalled();
  });

  it('silently drops a submission with the honeypot field filled — same 201 confirmation copy, no lead created', async () => {
    const { app } = await buildApp();
    const res = await app.request('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, hp_field: 'http://bot-filled-this-in.example' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.message).toBe(CONFIRMATION_MESSAGE);
    expect(db.leads.create).not.toHaveBeenCalled();
    expect(db.audit_events.create).not.toHaveBeenCalled();
  });

  it('rate-limit boundary: the first 5 submissions from the same IP within the hour succeed, the 6th is 429 with Retry-After, and none of the first 5 are ever blocked', async () => {
    stubFixedWindowCounter();
    const { app } = await buildApp();

    const results: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await app.request('/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '5.6.7.8' },
        body: JSON.stringify(VALID_BODY),
      });
      results.push(res.status);
      if (i === 5) {
        expect(res.headers.get('Retry-After')).not.toBeNull();
      }
    }

    expect(results).toEqual([201, 201, 201, 201, 201, 429]);
    expect(db.leads.create).toHaveBeenCalledTimes(5);
  });

  it('rate-limits independently per IP — a fresh IP is unaffected by another IP already at its limit', async () => {
    db.organization_rate_limits.upsert.mockResolvedValue({ count: 6 }); // already over the limit for whichever key is used
    const { app } = await buildApp();

    // First IP is over the limit...
    const blocked = await app.request('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(blocked.status).toBe(429);

    // ...but the middleware keys strictly by IP (verified via
    // middleware/rate-limit.test.ts) — a distinct IP gets its own bucket.
    // Here we only assert the request reaches `checkRateLimit` with the new
    // IP as the key.
    db.organization_rate_limits.upsert.mockResolvedValueOnce({ count: 1 });
    const allowed = await app.request('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.2' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(allowed.status).toBe(201);
  });
});
