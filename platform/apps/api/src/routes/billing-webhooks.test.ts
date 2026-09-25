import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const FREE_PLAN = { id: 'plan-free', slug: 'free', name: 'Free', limits: {}, features: {}, active: true };
const GROWTH_PLAN = { id: 'plan-growth', slug: 'growth', name: 'Growth', limits: {}, features: {}, active: true };

function freshSubscriptionRow(): Record<string, unknown> {
  return {
    id: 'sub-1',
    organization_id: 'org-1',
    plan_id: GROWTH_PLAN.id,
    plan: 'growth',
    status: 'active',
    current_period_start: null,
    current_period_end: null,
    trial_ends_at: null,
    cancelled_at: null,
    external_customer_id: 'cus_1',
    external_id: 'sub_ext_1',
    last_billing_event_at: null,
    last_billing_event_id: null,
    plans: GROWTH_PLAN,
  };
}

// ── A STATEFUL, TRANSACTIONAL fake `@bebest/database`. ────────────────────
//
// The spy-only version this file used could not express the defect that
// matters here: "a crash between the side effects and the `processed_at`
// write must not leave half an event applied" is a statement about ROLLBACK,
// and a `vi.fn()` that records calls has nothing to roll back. So the mocks
// are still `vi.fn()` (every existing `toHaveBeenCalledWith` assertion keeps
// working) but they now read and write a real store, and `withOrgContext`
// snapshots that store and RESTORES it if its callback throws — which is what
// the single interactive transaction in the route does in Postgres.
interface Store {
  subscription: Record<string, unknown>;
  org: { id: string; status: string };
  eventRows: Record<string, Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
}

let store: Store;
let eventRowSeq = 0;

function resetStore(): void {
  store = {
    subscription: freshSubscriptionRow(),
    org: { id: 'org-1', status: 'active' },
    eventRows: {},
    auditRows: [],
  };
  eventRowSeq = 0;
}
resetStore();

function eventRowById(id: string): Record<string, unknown> | undefined {
  return Object.values(store.eventRows).find((row) => row.id === id);
}

const db = {
  organizations: { update: vi.fn() },
  subscriptions: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  plans: { findUnique: vi.fn() },
  billing_webhook_events: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  audit_events: { create: vi.fn() },
  // The `SELECT ... FOR UPDATE` that serializes concurrent deliveries for one
  // subscription. Nothing to simulate in-process; asserted as "was locked".
  $queryRaw: vi.fn(),
};

function installStoreBackedMocks(): void {
  db.subscriptions.findFirst.mockImplementation(async () => store.subscription);
  db.subscriptions.findUniqueOrThrow.mockImplementation(async () => store.subscription);
  db.subscriptions.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    Object.assign(store.subscription, data);
    if (typeof data.plan === 'string') {
      store.subscription.plans = data.plan === 'free' ? FREE_PLAN : GROWTH_PLAN;
    }
    return store.subscription;
  });
  db.organizations.update.mockImplementation(async ({ data }: { data: { status: string } }) => {
    store.org.status = data.status;
    return store.org;
  });
  db.plans.findUnique.mockImplementation(async ({ where: { slug } }: { where: { slug: string } }) =>
    slug === 'free' ? FREE_PLAN : slug === 'growth' ? GROWTH_PLAN : null,
  );
  db.billing_webhook_events.findUnique.mockImplementation(
    async ({ where: { external_event_id } }: { where: { external_event_id: string } }) =>
      store.eventRows[external_event_id] ?? null,
  );
  db.billing_webhook_events.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const key = String(data.external_event_id);
    // Models the real UNIQUE constraint on `external_event_id` — the route
    // relies on the insert failing to resolve a concurrent double delivery.
    if (store.eventRows[key]) throw new Error('duplicate key value violates unique constraint');
    const row = { id: `webhook-row-${++eventRowSeq}`, organization_id: null, processed_at: null, skipped_reason: null, ...data };
    store.eventRows[key] = row;
    return row;
  });
  db.billing_webhook_events.update.mockImplementation(
    async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = eventRowById(id);
      if (!row) throw new Error(`billing_webhook_events ${id} not found`);
      Object.assign(row, data);
      return row;
    },
  );
  db.audit_events.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    store.auditRows.push(data);
    return data;
  });
  db.$queryRaw.mockResolvedValue([{ id: 'sub-1' }]);
}

vi.mock('@bebest/database', () => ({
  db,
  // A real transaction: the callback's writes are discarded if it throws.
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => {
    const snapshot = structuredClone(store);
    try {
      return await fn(db);
    } catch (err) {
      store = snapshot;
      throw err;
    }
  }),
}));

async function buildApp() {
  const { default: billingWebhooks } = await import('./billing-webhooks.js');
  const app = new Hono();
  app.route('/webhooks/billing', billingWebhooks);
  return app;
}

async function signedRequest(app: Hono, body: object, secret = 'test-secret') {
  const { signWebhookPayload } = await import('../lib/billing/payment-provider.js');
  const payload = JSON.stringify(body);
  const signature = signWebhookPayload(payload, secret);
  return app.request('/webhooks/billing', {
    method: 'POST',
    headers: { 'x-billing-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.BILLING_WEBHOOK_SECRET = 'test-secret';
  resetStore();
  installStoreBackedMocks();
});

describe('POST /webhooks/billing — signature verification', () => {
  it('rejects a tampered signature BEFORE any state change, and logs it as a security event', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({ id: 'evt_1', type: 'subscription.past_due', data: {} });
    const res = await app.request('/webhooks/billing', {
      method: 'POST',
      headers: { 'x-billing-signature': 'deadbeef'.repeat(8), 'content-type': 'application/json' },
      body: payload,
    });
    expect(res.status).toBe(400);
    expect(db.subscriptions.update).not.toHaveBeenCalled();
    expect(db.organizations.update).not.toHaveBeenCalled();
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'billing.webhook_rejected', result: 'failure' }) }),
    );
  });

  it('accepts a validly signed event and applies the state transition', async () => {
    const app = await buildApp();
    const res = await signedRequest(app, {
      id: 'evt_2',
      type: 'subscription.past_due',
      data: { externalCustomerId: 'cus_1' },
    });
    expect(res.status).toBe(200);
    expect(db.subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'past_due' }) }),
    );
    // Day 0 — no plan change.
    expect(db.subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan_id: GROWTH_PLAN.id }) }),
    );
  });
});

describe('POST /webhooks/billing — idempotency (dedupe by event id)', () => {
  it('does not double-apply a replayed event id', async () => {
    const app = await buildApp();
    await signedRequest(app, { id: 'evt_replay', type: 'subscription.past_due', data: { externalCustomerId: 'cus_1' } });
    expect(db.subscriptions.update).toHaveBeenCalledTimes(1);

    // Simulate the replay: the row now looks processed.
    db.billing_webhook_events.findUnique.mockResolvedValue({ id: 'webhook-row-1', processed_at: new Date() });

    const res = await signedRequest(app, { id: 'evt_replay', type: 'subscription.past_due', data: { externalCustomerId: 'cus_1' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    // Still only the one call from the first delivery.
    expect(db.subscriptions.update).toHaveBeenCalledTimes(1);
  });
});

// ── ATOMICITY: replay must be idempotent for EFFECTS, not just for state ──
//
// The dedupe guard keys off `processed_at`. When `processed_at` was the last of
// four sequential writes, a crash anywhere before it left the event looking
// unprocessed with its effects already applied — so the provider's retry
// re-ran the transition, the org update and every audit write, potentially over
// a state a LATER event had since set. These two cases pin the fix: either the
// whole event lands or none of it does.
describe('POST /webhooks/billing — crash between the side effects and processed_at', () => {
  const CANCEL_EVENT = { id: 'evt_crash', type: 'subscription.cancelled', data: { externalCustomerId: 'cus_1' } };

  it('rolls the whole event back, then applies it EXACTLY ONCE on the retry', async () => {
    const app = await buildApp();

    // Crash precisely in the reported window: the state change and the audit
    // rows have been written, the `processed_at` marker has not.
    db.billing_webhook_events.update.mockRejectedValueOnce(new Error('connection reset'));

    const first = await signedRequest(app, CANCEL_EVENT);
    expect(first.status).toBe(500);

    // NOTHING survived the crash — not the plan, not the org status, not the
    // audit row. (Before the fix, all three had already been committed.)
    expect(store.subscription.plan).toBe('growth');
    expect(store.subscription.status).toBe('active');
    expect(store.org.status).toBe('active');
    expect(store.auditRows.filter((row) => row.action === 'billing.changed')).toHaveLength(0);
    // The event row itself is the one thing that must persist (it is inserted
    // outside the transaction, so the retry can still dedupe on it) — and it
    // is correctly still unprocessed.
    expect(store.eventRows.evt_crash?.processed_at).toBeNull();

    // The provider retries. The guard lets it through, which is correct now:
    // the first attempt left nothing behind.
    const second = await signedRequest(app, CANCEL_EVENT);
    expect(second.status).toBe(200);

    expect(store.subscription.plan).toBe('free');
    expect(store.subscription.status).toBe('canceled');
    expect(store.org.status).toBe('cancelled');
    // EXACTLY ONE of each effect across both deliveries.
    expect(store.auditRows.filter((row) => row.action === 'billing.changed')).toHaveLength(1);
    expect(store.eventRows.evt_crash?.processed_at).not.toBeNull();
  });

  it('a third delivery after a successful apply changes nothing at all', async () => {
    const app = await buildApp();
    await signedRequest(app, CANCEL_EVENT);
    const applied = { ...store.subscription };

    const replay = await signedRequest(app, CANCEL_EVENT);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect(store.subscription).toEqual(applied);
    expect(store.auditRows.filter((row) => row.action === 'billing.changed')).toHaveLength(1);
  });
});

// ── ORDERING: provider time, not arrival time ─────────────────────────────
//
// Stripe does not guarantee delivery order, and its retries actively reorder
// events. `occurredAt` used to be handed to the state machine and compared
// against nothing at all.
describe('POST /webhooks/billing — out-of-order deliveries', () => {
  const T_EARLY = '2026-03-01T10:00:00.000Z';
  const T_LATE = '2026-03-01T10:05:00.000Z';

  it('an OLDER payment_failed arriving after a NEWER healthy event does not downgrade the subscription', async () => {
    const app = await buildApp();

    // 10:05 — payment succeeded; the subscription is healthy.
    const healthy = await signedRequest(app, {
      id: 'evt_succeeded',
      type: 'invoice.payment_succeeded',
      occurredAt: T_LATE,
      data: { externalCustomerId: 'cus_1' },
    });
    expect(healthy.status).toBe(200);
    expect(store.subscription.status).toBe('active');

    // 10:00 — the failure Stripe could not deliver earlier, arriving now.
    const stale = await signedRequest(app, {
      id: 'evt_failed_stale',
      type: 'invoice.payment_failed',
      occurredAt: T_EARLY,
      data: { externalCustomerId: 'cus_1', attempt: 3 },
    });

    // Acknowledged (or Stripe retries it for days) but NOT applied.
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ received: true, ignored: true, reason: 'superseded_by_newer_event' });
    expect(store.subscription.status).toBe('active');
    expect(store.subscription.last_billing_event_id).toBe('evt_succeeded');

    // The skip is recorded on the event row and audited — a billing event that
    // deliberately changed nothing still has to be explainable.
    expect(store.eventRows.evt_failed_stale?.skipped_reason).toBe('superseded_by_newer_event');
    expect(store.eventRows.evt_failed_stale?.processed_at).not.toBeNull();
    expect(store.auditRows.some((row) => row.action === 'billing.webhook_superseded')).toBe(true);
  });

  it('still applies events that arrive in order, and same-second events (Stripe resolution) are not blocked', async () => {
    const app = await buildApp();

    await signedRequest(app, {
      id: 'evt_pastdue',
      type: 'subscription.past_due',
      occurredAt: T_EARLY,
      data: { externalCustomerId: 'cus_1' },
    });
    expect(store.subscription.status).toBe('past_due');

    // Same `occurredAt` — Stripe's `event.created` has one-second resolution,
    // so a tie is resolved by arrival order rather than refused.
    const sameSecond = await signedRequest(app, {
      id: 'evt_succeeded_same_second',
      type: 'invoice.payment_succeeded',
      occurredAt: T_EARLY,
      data: { externalCustomerId: 'cus_1' },
    });
    expect(sameSecond.status).toBe(200);
    expect(store.subscription.status).toBe('active');

    // And a genuinely later event applies normally.
    const later = await signedRequest(app, {
      id: 'evt_unpaid_later',
      type: 'subscription.unpaid',
      occurredAt: T_LATE,
      data: { externalCustomerId: 'cus_1' },
    });
    expect(later.status).toBe(200);
    expect(store.subscription.plan).toBe('free');
  });

  it('takes the per-subscription row lock before reading the state it decides against', async () => {
    const app = await buildApp();
    await signedRequest(app, { id: 'evt_lock', type: 'subscription.past_due', data: { externalCustomerId: 'cus_1' } });
    // Concurrent deliveries for one customer are real; without the lock two
    // would read the same "current" state and the ordering guard would be
    // defeated by a race rather than by a stale delivery.
    expect(db.$queryRaw).toHaveBeenCalled();
  });
});

describe('POST /webhooks/billing — failed-payment grace period schedule', () => {
  it('subscription.past_due (day 0) does NOT downgrade the plan', async () => {
    const app = await buildApp();
    await signedRequest(app, { id: 'evt_day0', type: 'subscription.past_due', data: { externalCustomerId: 'cus_1' } });
    const updateCall = db.subscriptions.update.mock.calls[0]?.[0];
    expect(updateCall.data.plan_id).toBe(GROWTH_PLAN.id); // unchanged
    expect(updateCall.data.status).toBe('past_due');
  });

  it('subscription.unpaid (day 10 equivalent) downgrades to free and marks the org still active (not cancelled)', async () => {
    const app = await buildApp();
    await signedRequest(app, { id: 'evt_day10', type: 'subscription.unpaid', data: { externalCustomerId: 'cus_1' } });
    const updateCall = db.subscriptions.update.mock.calls[0]?.[0];
    expect(updateCall.data.plan_id).toBe(FREE_PLAN.id);
    const orgUpdateCall = db.organizations.update.mock.calls[0]?.[0];
    expect(orgUpdateCall.data.status).toBe('active');
  });
});

describe('POST /webhooks/billing — cancellation (non-negotiable: never hard-delete)', () => {
  it('subscription.cancelled downgrades to free AND marks the org cancelled', async () => {
    const app = await buildApp();
    await signedRequest(app, { id: 'evt_cancel', type: 'subscription.cancelled', data: { externalCustomerId: 'cus_1' } });

    const updateCall = db.subscriptions.update.mock.calls[0]?.[0];
    expect(updateCall.data.plan_id).toBe(FREE_PLAN.id);
    expect(updateCall.data.status).toBe('canceled');

    const orgUpdateCall = db.organizations.update.mock.calls[0]?.[0];
    expect(orgUpdateCall.data.status).toBe('cancelled');

    // No `.delete` mock exists anywhere in this file's `db` object — a
    // `.delete()` call in the route would throw "not a function", not
    // silently succeed.
  });
});

describe('POST /webhooks/billing — unresolvable events', () => {
  it('acknowledges (200) but does not fabricate a transition when no subscription matches the external customer id', async () => {
    db.subscriptions.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await signedRequest(app, {
      id: 'evt_unknown',
      type: 'subscription.past_due',
      data: { externalCustomerId: 'cus_does_not_exist' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ignored?: boolean }).ignored).toBe(true);
    expect(db.subscriptions.update).not.toHaveBeenCalled();
  });
});

// ── Real Stripe deliveries through this SAME route and state machine ──────
// The point of these cases is that there is no second webhook path: a real
// `Stripe-Signature` header, verified by `StripeProvider`, drives exactly the
// idempotency + state-machine machinery the cases above exercise through
// `NullPaymentProvider`'s HMAC.
describe('POST /webhooks/billing — real Stripe deliveries', () => {
  const WEBHOOK_SECRET = 'whsec_route_test';

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { __setPaymentProviderForTesting } = await import('../lib/billing/payment-provider.js');
    __setPaymentProviderForTesting(undefined);
  });

  afterEach(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { __setPaymentProviderForTesting } = await import('../lib/billing/payment-provider.js');
    __setPaymentProviderForTesting(undefined);
  });

  function stripeSubscriptionEvent(eventId: string, status = 'past_due') {
    return {
      id: eventId,
      object: 'event',
      created: 1_700_000_000,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_ext_1',
          object: 'subscription',
          customer: 'cus_1',
          status,
          items: {
            data: [
              {
                id: 'si_1',
                current_period_start: 1_700_000_000,
                current_period_end: 1_702_592_000,
                price: { id: 'price_growth', lookup_key: 'growth', metadata: {} },
              },
            ],
          },
        },
      },
    };
  }

  async function stripeRequest(app: Hono, body: object, secret = WEBHOOK_SECRET) {
    const { default: Stripe } = await import('stripe');
    const payload = JSON.stringify(body);
    const signature = new Stripe('sk_test_not_a_real_key').webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    return app.request('/webhooks/billing', {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
  }

  it('accepts a real Stripe-Signature delivery and applies the mapped transition', async () => {
    const app = await buildApp();
    const res = await stripeRequest(app, stripeSubscriptionEvent('evt_stripe_1', 'past_due'));

    expect(res.status).toBe(200);
    // `customer.subscription.updated` + status past_due -> subscription.past_due,
    // which the state machine says must NOT change the plan (day 0).
    expect(db.subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'past_due', plan: 'growth' }),
      }),
    );
  });

  it('rejects a Stripe delivery signed with the wrong endpoint secret, before any state change', async () => {
    const app = await buildApp();
    const res = await stripeRequest(app, stripeSubscriptionEvent('evt_stripe_bad'), 'whsec_wrong');

    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('invalid_signature');
    expect(db.subscriptions.update).not.toHaveBeenCalled();
    expect(db.organizations.update).not.toHaveBeenCalled();
    expect(db.billing_webhook_events.create).not.toHaveBeenCalled();
    // Logged as a security-relevant event.
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'billing.webhook_rejected', result: 'failure' }),
      }),
    );
  });

  it('is idempotent across a Stripe retry of the same event id — the effect is applied exactly once', async () => {
    const app = await buildApp();
    const event = stripeSubscriptionEvent('evt_stripe_retry', 'past_due');

    const first = await stripeRequest(app, event);
    expect(first.status).toBe(200);
    expect(db.subscriptions.update).toHaveBeenCalledTimes(1);

    // Stripe redelivers the identical event; the row is now processed.
    db.billing_webhook_events.findUnique.mockResolvedValue({
      id: 'webhook-row-1',
      external_event_id: 'evt_stripe_retry',
      processed_at: new Date(),
    });

    const second = await stripeRequest(app, event);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
    // Still exactly one — no double-applied subscription change.
    expect(db.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  it('200-acks a well-signed Stripe event type the platform has no transition for, without auditing it as a rejection', async () => {
    const app = await buildApp();
    const res = await stripeRequest(app, {
      id: 'evt_charge_1',
      object: 'event',
      created: 1_700_000_000,
      type: 'charge.succeeded',
      data: { object: { id: 'ch_1', object: 'charge' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true, reason: 'unsupported_event_type' });
    expect(db.billing_webhook_events.create).not.toHaveBeenCalled();
    expect(db.subscriptions.update).not.toHaveBeenCalled();
    expect(db.audit_events.create).not.toHaveBeenCalled();
  });
});
