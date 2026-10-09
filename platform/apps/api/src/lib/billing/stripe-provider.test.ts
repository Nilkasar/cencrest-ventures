/**
 * `StripeProvider` (defined in `payment-provider.ts` alongside the contract
 * it implements — see that file's header for why it is not a sibling module).
 *
 * **Zero outbound network calls.** Two techniques, both deliberate:
 *   - Webhook tests use a REAL `StripeProvider`. `stripe.webhooks.
 *     constructEvent` and `generateTestHeaderString` are pure local crypto —
 *     constructing a `Stripe` client with a fake key makes no request, so
 *     these tests exercise Stripe's actual signature verification (v1
 *     HMAC-SHA256 over `timestamp.payload` plus the replay window) rather
 *     than a re-implementation of it. That is the whole point: verifying a
 *     mock of a signature check proves nothing.
 *   - API-call tests inject a hand-written fake client through the
 *     constructor's second parameter.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import {
  StripeProvider,
  NullPaymentProvider,
  InvalidWebhookSignatureError,
  WebhookSecretNotConfiguredError,
  UnsupportedWebhookEventError,
  StripePriceNotFoundError,
  createPaymentProviderFromEnv,
  getPaymentProvider,
  __setPaymentProviderForTesting,
} from './payment-provider.js';

const WEBHOOK_SECRET = 'whsec_test_secret';

const ORIGINAL = {
  stripeKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhook: process.env.STRIPE_WEBHOOK_SECRET,
  billingWebhook: process.env.BILLING_WEBHOOK_SECRET,
};

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.BILLING_WEBHOOK_SECRET;
});

afterEach(() => {
  __setPaymentProviderForTesting(undefined);
  for (const [key, value] of [
    ['STRIPE_SECRET_KEY', ORIGINAL.stripeKey],
    ['STRIPE_WEBHOOK_SECRET', ORIGINAL.stripeWebhook],
    ['BILLING_WEBHOOK_SECRET', ORIGINAL.billingWebhook],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** A real client, never used to make a request — only for its local
 * `webhooks` crypto helpers. */
const signingClient = new Stripe('sk_test_not_a_real_key');

function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return signingClient.webhooks.generateTestHeaderString({ payload, secret });
}

function subscriptionPayload(
  overrides: {
    id?: string;
    eventId?: string;
    eventType?: string;
    status?: string;
    lookupKey?: string | null;
    planSlugMetadata?: string;
  } = {},
) {
  return JSON.stringify({
    id: overrides.eventId ?? 'evt_sub_1',
    object: 'event',
    created: 1_700_000_000,
    type: overrides.eventType ?? 'customer.subscription.updated',
    data: {
      object: {
        id: overrides.id ?? 'sub_live_1',
        object: 'subscription',
        customer: 'cus_live_1',
        status: overrides.status ?? 'active',
        items: {
          object: 'list',
          data: [
            {
              id: 'si_1',
              object: 'subscription_item',
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
              price: {
                id: 'price_abc',
                object: 'price',
                lookup_key: overrides.lookupKey === null ? null : (overrides.lookupKey ?? 'growth'),
                metadata: overrides.planSlugMetadata ? { plan_slug: overrides.planSlugMetadata } : {},
              },
            },
          ],
        },
      },
    },
  });
}

function invoicePayload(overrides: { eventType?: string; attemptCount?: number; eventId?: string } = {}) {
  return JSON.stringify({
    id: overrides.eventId ?? 'evt_inv_1',
    object: 'event',
    created: 1_700_000_500,
    type: overrides.eventType ?? 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_live_1',
        object: 'invoice',
        customer: 'cus_live_1',
        status: 'open',
        currency: 'usd',
        total: 4900,
        created: 1_700_000_400,
        attempt_count: overrides.attemptCount ?? 1,
        parent: { subscription_details: { subscription: 'sub_live_1' } },
      },
    },
  });
}

function provider(): StripeProvider {
  return new StripeProvider({ secretKey: 'sk_test_not_a_real_key' });
}

// ── Factory: never hard-fails, falls back to Null when unconfigured ───────

describe('createPaymentProviderFromEnv / getPaymentProvider', () => {
  it('falls back to NullPaymentProvider when STRIPE_SECRET_KEY is not set', () => {
    const result = createPaymentProviderFromEnv();
    expect(result).toBeInstanceOf(NullPaymentProvider);
    expect(result.name).toBe('null_provider');
  });

  it('returns a StripeProvider when STRIPE_SECRET_KEY is set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
    const result = createPaymentProviderFromEnv();
    expect(result).toBeInstanceOf(StripeProvider);
    expect(result.name).toBe('stripe');
  });

  it('never throws at construction when Stripe is only partially configured (no webhook secret)', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => createPaymentProviderFromEnv()).not.toThrow();
  });

  it('getPaymentProvider caches one instance for the process', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
    expect(getPaymentProvider()).toBe(getPaymentProvider());
  });
});

// ── Webhook signature verification (real Stripe crypto) ──────────────────

describe('StripeProvider.constructWebhookEvent — signature verification', () => {
  it('accepts a correctly signed payload', () => {
    const payload = subscriptionPayload();
    const event = provider().constructWebhookEvent(payload, sign(payload));
    expect(event.id).toBe('evt_sub_1');
  });

  it('rejects a signature produced with the wrong secret', () => {
    const payload = subscriptionPayload();
    const badSignature = sign(payload, 'whsec_a_different_secret');
    expect(() => provider().constructWebhookEvent(payload, badSignature)).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('rejects a tampered payload signed against the original', () => {
    const original = subscriptionPayload();
    const signature = sign(original);
    const tampered = original.replace('"growth"', '"enterprise"');
    expect(tampered).not.toBe(original);
    expect(() => provider().constructWebhookEvent(tampered, signature)).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('rejects a missing / empty / malformed signature header', () => {
    const payload = subscriptionPayload();
    for (const signature of ['', 'garbage', 't=1,v1=deadbeef']) {
      expect(() => provider().constructWebhookEvent(payload, signature)).toThrow(
        InvalidWebhookSignatureError,
      );
    }
  });

  it('throws WebhookSecretNotConfiguredError — not a signature error — when no secret is configured at all', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.BILLING_WEBHOOK_SECRET;
    const payload = subscriptionPayload();
    expect(() => provider().constructWebhookEvent(payload, sign(payload))).toThrow(
      WebhookSecretNotConfiguredError,
    );
  });

  it('honours BILLING_WEBHOOK_SECRET as a fallback (GO_LIVE.md §2 variable name)', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.BILLING_WEBHOOK_SECRET = 'whsec_legacy_name';
    const payload = subscriptionPayload();
    const event = provider().constructWebhookEvent(payload, sign(payload, 'whsec_legacy_name'));
    expect(event.id).toBe('evt_sub_1');
  });
});

// ── Stripe event -> the platform's 7-event vocabulary ────────────────────

describe('StripeProvider.constructWebhookEvent — event mapping', () => {
  function parse(payload: string) {
    return provider().constructWebhookEvent(payload, sign(payload));
  }

  it('maps customer.subscription.created, carrying the plan slug from the Price lookup_key', () => {
    const event = parse(subscriptionPayload({ eventType: 'customer.subscription.created' }));
    expect(event.type).toBe('subscription.created');
    expect(event.data).toEqual({
      externalCustomerId: 'cus_live_1',
      externalSubscriptionId: 'sub_live_1',
      planSlug: 'growth',
    });
    expect(event.occurredAt.toISOString()).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('maps customer.subscription.updated by the subscription status', () => {
    expect(parse(subscriptionPayload({ status: 'active', eventId: 'evt_a' })).type).toBe('subscription.updated');
    expect(parse(subscriptionPayload({ status: 'past_due', eventId: 'evt_b' })).type).toBe('subscription.past_due');
    expect(parse(subscriptionPayload({ status: 'unpaid', eventId: 'evt_c' })).type).toBe('subscription.unpaid');
    expect(parse(subscriptionPayload({ status: 'canceled', eventId: 'evt_d' })).type).toBe('subscription.cancelled');
  });

  it('maps customer.subscription.deleted to subscription.cancelled regardless of status', () => {
    const event = parse(subscriptionPayload({ eventType: 'customer.subscription.deleted', status: 'active' }));
    expect(event.type).toBe('subscription.cancelled');
  });

  it('falls back to metadata.plan_slug when the Price has no lookup_key', () => {
    const event = parse(subscriptionPayload({ lookupKey: null, planSlugMetadata: 'pro' }));
    expect(event.data.planSlug).toBe('pro');
  });

  it('omits planSlug entirely for a Price whose key is not a real plan tier — never guesses', () => {
    const event = parse(subscriptionPayload({ lookupKey: 'legacy_2019_special' }));
    expect(event.data.planSlug).toBeUndefined();
  });

  it('maps invoice.payment_succeeded without an attempt number', () => {
    const event = parse(invoicePayload({ eventType: 'invoice.payment_succeeded' }));
    expect(event.type).toBe('invoice.payment_succeeded');
    expect(event.data.attempt).toBeUndefined();
    expect(event.data.externalSubscriptionId).toBe('sub_live_1');
  });

  it('clamps invoice.payment_failed attempt_count into the state machine 1/2/3 schedule', () => {
    expect(parse(invoicePayload({ attemptCount: 1, eventId: 'e1' })).data.attempt).toBe(1);
    expect(parse(invoicePayload({ attemptCount: 2, eventId: 'e2' })).data.attempt).toBe(2);
    expect(parse(invoicePayload({ attemptCount: 3, eventId: 'e3' })).data.attempt).toBe(3);
    expect(parse(invoicePayload({ attemptCount: 9, eventId: 'e4' })).data.attempt).toBe(3);
  });

  it('throws UnsupportedWebhookEventError for a well-signed event type this platform has no transition for', () => {
    const payload = JSON.stringify({
      id: 'evt_unknown',
      object: 'event',
      created: 1_700_000_000,
      type: 'charge.succeeded',
      data: { object: { id: 'ch_1', object: 'charge' } },
    });
    expect(() => provider().constructWebhookEvent(payload, sign(payload))).toThrow(
      UnsupportedWebhookEventError,
    );
    // Crucially NOT a signature error — the route must 200-ack these, not 400.
    expect(() => provider().constructWebhookEvent(payload, sign(payload))).not.toThrow(
      InvalidWebhookSignatureError,
    );
  });
});

// ── API calls, against an injected fake client (no network) ───────────────

interface FakeStripe {
  customers: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  prices: { list: ReturnType<typeof vi.fn> };
  subscriptions: {
    create: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  invoices: { list: ReturnType<typeof vi.fn> };
}

function fakeStripe(): FakeStripe {
  return {
    customers: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn() },
    prices: { list: vi.fn().mockResolvedValue({ data: [] }) },
    subscriptions: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
    invoices: { list: vi.fn().mockResolvedValue({ data: [] }) },
  };
}

function withFake(fake: FakeStripe): StripeProvider {
  return new StripeProvider({ secretKey: 'sk_test_not_a_real_key' }, fake as unknown as Stripe);
}

const STRIPE_SUBSCRIPTION = {
  id: 'sub_live_1',
  customer: 'cus_live_1',
  status: 'active',
  items: {
    data: [
      {
        id: 'si_1',
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        price: { id: 'price_abc', lookup_key: 'growth', metadata: {} },
      },
    ],
  },
};

describe('StripeProvider — customers', () => {
  it('reuses an existing Stripe customer for the same email instead of creating a duplicate', async () => {
    const fake = fakeStripe();
    fake.customers.list.mockResolvedValue({
      data: [{ id: 'cus_existing', email: 'owner@example.com', name: 'Ada' }],
    });

    const customer = await withFake(fake).createCustomer('owner@example.com', 'Ada');

    expect(customer.id).toBe('cus_existing');
    expect(fake.customers.create).not.toHaveBeenCalled();
  });

  it('creates a customer when none exists for that email', async () => {
    const fake = fakeStripe();
    fake.customers.create.mockResolvedValue({ id: 'cus_new', email: 'new@example.com', name: 'Grace' });

    const customer = await withFake(fake).createCustomer('new@example.com', 'Grace');

    expect(customer).toEqual({ id: 'cus_new', email: 'new@example.com', name: 'Grace' });
    expect(fake.customers.create).toHaveBeenCalledWith({ email: 'new@example.com', name: 'Grace' });
  });
});

describe('StripeProvider — plan/price resolution (no price or amount in code)', () => {
  it('resolves a plan slug to a Stripe Price by lookup_key', async () => {
    const fake = fakeStripe();
    fake.prices.list.mockResolvedValue({ data: [{ id: 'price_growth_monthly' }] });
    fake.subscriptions.create.mockResolvedValue(STRIPE_SUBSCRIPTION);

    await withFake(fake).createSubscription('cus_live_1', 'growth');

    expect(fake.prices.list).toHaveBeenCalledWith({ lookup_keys: ['growth'], active: true, limit: 1 });
    expect(fake.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_live_1', items: [{ price: 'price_growth_monthly' }] }),
    );
  });

  it('passes a raw price_… id straight through without a lookup', async () => {
    const fake = fakeStripe();
    fake.subscriptions.create.mockResolvedValue(STRIPE_SUBSCRIPTION);

    await withFake(fake).createSubscription('cus_live_1', 'price_explicit');

    expect(fake.prices.list).not.toHaveBeenCalled();
  });

  it('falls back to metadata.plan_slug when no Price carries a lookup_key', async () => {
    const fake = fakeStripe();
    fake.prices.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: 'price_meta', metadata: { plan_slug: 'pro' } }] });
    fake.subscriptions.create.mockResolvedValue(STRIPE_SUBSCRIPTION);

    await withFake(fake).createSubscription('cus_live_1', 'pro');

    expect(fake.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ price: 'price_meta' }] }),
    );
  });

  it('throws a named, actionable error when no Stripe Price exists for the plan', async () => {
    const fake = fakeStripe();
    await expect(withFake(fake).createSubscription('cus_live_1', 'agency')).rejects.toThrow(
      StripePriceNotFoundError,
    );
  });
});

describe('StripeProvider — subscriptions', () => {
  it('reads the billing period from the subscription item (post-"basil" Stripe API shape)', async () => {
    const fake = fakeStripe();
    fake.prices.list.mockResolvedValue({ data: [{ id: 'price_growth' }] });
    fake.subscriptions.create.mockResolvedValue(STRIPE_SUBSCRIPTION);

    const result = await withFake(fake).createSubscription('cus_live_1', 'growth');

    expect(result.currentPeriodStart.toISOString()).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(result.currentPeriodEnd.toISOString()).toBe(new Date(1_702_592_000 * 1000).toISOString());
    expect(result.planId).toBe('growth');
    expect(result.customerId).toBe('cus_live_1');
  });

  it('reads the billing period from the subscription itself (pre-"basil" shape)', async () => {
    const fake = fakeStripe();
    fake.prices.list.mockResolvedValue({ data: [{ id: 'price_growth' }] });
    fake.subscriptions.create.mockResolvedValue({
      id: 'sub_old',
      customer: 'cus_live_1',
      status: 'active',
      current_period_start: 1_600_000_000,
      current_period_end: 1_602_592_000,
      items: { data: [{ id: 'si_1', price: { id: 'price_growth', lookup_key: 'growth', metadata: {} } }] },
    });

    const result = await withFake(fake).createSubscription('cus_live_1', 'growth');

    expect(result.currentPeriodStart.toISOString()).toBe(new Date(1_600_000_000 * 1000).toISOString());
    expect(result.currentPeriodEnd.toISOString()).toBe(new Date(1_602_592_000 * 1000).toISOString());
  });

  it('upgrade swaps the existing item onto the new Price, keeping the same subscription id', async () => {
    const fake = fakeStripe();
    fake.prices.list.mockResolvedValue({ data: [{ id: 'price_pro' }] });
    fake.subscriptions.retrieve.mockResolvedValue(STRIPE_SUBSCRIPTION);
    fake.subscriptions.update.mockResolvedValue({
      ...STRIPE_SUBSCRIPTION,
      items: {
        data: [
          {
            id: 'si_1',
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
            price: { id: 'price_pro', lookup_key: 'pro', metadata: {} },
          },
        ],
      },
    });

    const result = await withFake(fake).upgradeSubscription('sub_live_1', 'pro');

    expect(fake.subscriptions.update).toHaveBeenCalledWith(
      'sub_live_1',
      expect.objectContaining({ items: [{ id: 'si_1', price: 'price_pro' }], cancel_at_period_end: false }),
    );
    expect(result.id).toBe('sub_live_1');
    expect(result.planId).toBe('pro');
  });
});

describe('StripeProvider.cancelSubscription — cancellation must never destroy data or silently no-op', () => {
  it('cancels at Stripe', async () => {
    const fake = fakeStripe();
    fake.subscriptions.cancel.mockResolvedValue({ id: 'sub_live_1', status: 'canceled' });

    await expect(withFake(fake).cancelSubscription('sub_live_1')).resolves.toBeUndefined();
    expect(fake.subscriptions.cancel).toHaveBeenCalledWith('sub_live_1');
  });

  it('treats an already-gone subscription as success (idempotent) so a downgrade is never blocked', async () => {
    const fake = fakeStripe();
    fake.subscriptions.cancel.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'No such subscription: sub_gone',
        code: 'resource_missing',
      }),
    );

    await expect(withFake(fake).cancelSubscription('sub_gone')).resolves.toBeUndefined();
  });

  it('rethrows any other Stripe failure — swallowing it would leave a LIVE subscription billing the customer', async () => {
    const fake = fakeStripe();
    fake.subscriptions.cancel.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'Stripe is down' }),
    );

    await expect(withFake(fake).cancelSubscription('sub_live_1')).rejects.toThrow('Stripe is down');
  });
});

describe('StripeProvider.getInvoices', () => {
  it('maps real Stripe invoices onto the Invoice contract, normalising draft -> open and the currency', async () => {
    const fake = fakeStripe();
    fake.invoices.list.mockResolvedValue({
      data: [
        { id: 'in_1', customer: 'cus_live_1', total: 4900, currency: 'usd', status: 'paid', created: 1_700_000_000 },
        { id: 'in_2', customer: 'cus_live_1', total: 4900, currency: 'usd', status: 'draft', created: 1_700_000_100 },
        { id: 'in_3', customer: 'cus_live_1', total: 0, currency: 'eur', status: 'void', created: 1_700_000_200 },
      ],
    });

    const invoices = await withFake(fake).getInvoices('cus_live_1');

    expect(invoices.map((i) => i.status)).toEqual(['paid', 'open', 'void']);
    expect(invoices[0]?.currency).toBe('USD');
    expect(invoices[2]?.currency).toBe('EUR');
    expect(invoices[0]?.amountCents).toBe(4900);
    expect(fake.invoices.list).toHaveBeenCalledWith({ customer: 'cus_live_1', limit: 100 });
  });

  it('returns an empty list for a customer with no invoices — never a fabricated one', async () => {
    await expect(withFake(fakeStripe()).getInvoices('cus_none')).resolves.toEqual([]);
  });
});
