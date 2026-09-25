import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const FREE_PLAN = { id: 'plan-free', slug: 'free', name: 'Free', limits: {}, features: {}, active: true };
const GROWTH_PLAN = { id: 'plan-growth', slug: 'growth', name: 'Growth', limits: {}, features: {}, active: true };

const subscriptionRow = {
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
  plans: GROWTH_PLAN,
};

const db = {
  organizations: { update: vi.fn() },
  subscriptions: { findFirst: vi.fn(), update: vi.fn() },
  plans: { findUnique: vi.fn() },
  billing_webhook_events: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

vi.mock('@bebest/database', () => ({
  db,
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
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
  db.audit_events.create.mockResolvedValue({});
  db.billing_webhook_events.findUnique.mockResolvedValue(null);
  db.billing_webhook_events.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'webhook-row-1',
    processed_at: null,
    ...data,
  }));
  db.billing_webhook_events.update.mockResolvedValue({});
  db.subscriptions.findFirst.mockResolvedValue(subscriptionRow);
  db.subscriptions.update.mockResolvedValue({ ...subscriptionRow });
  db.organizations.update.mockResolvedValue({ id: 'org-1', status: 'active' });
  db.plans.findUnique.mockImplementation(async ({ where: { slug } }: { where: { slug: string } }) =>
    slug === 'free' ? FREE_PLAN : slug === 'growth' ? GROWTH_PLAN : null,
  );
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
