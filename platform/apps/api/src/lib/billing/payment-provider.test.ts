import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  NullPaymentProvider,
  InvalidWebhookSignatureError,
  WebhookSecretNotConfiguredError,
  signWebhookPayload,
  getPaymentProvider,
  __setPaymentProviderForTesting,
} from './payment-provider.js';

const ORIGINAL_SECRET = process.env.BILLING_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.BILLING_WEBHOOK_SECRET = 'test-webhook-secret';
});

afterEach(() => {
  process.env.BILLING_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

describe('NullPaymentProvider — determinism (no network, no randomness)', () => {
  const provider = new NullPaymentProvider();

  it('createCustomer produces the same id for the same email every time', async () => {
    const a = await provider.createCustomer('owner@example.com', 'Ada');
    const b = await provider.createCustomer('owner@example.com', 'Ada Lovelace');
    expect(a.id).toBe(b.id);
  });

  it('createCustomer produces different ids for different emails', async () => {
    const a = await provider.createCustomer('a@example.com', 'A');
    const b = await provider.createCustomer('b@example.com', 'B');
    expect(a.id).not.toBe(b.id);
  });

  it('createSubscription returns an id deterministic in (customerId, planId)', async () => {
    const a = await provider.createSubscription('cus_1', 'plan_growth');
    const b = await provider.createSubscription('cus_1', 'plan_growth');
    expect(a.id).toBe(b.id);
    expect(a.status).toBe('active');
    expect(a.currentPeriodEnd.getTime()).toBeGreaterThan(a.currentPeriodStart.getTime());
  });

  it('upgradeSubscription keeps the same external subscription id, changes planId', async () => {
    const result = await provider.upgradeSubscription('sub_123', 'plan_pro');
    expect(result.id).toBe('sub_123');
    expect(result.planId).toBe('plan_pro');
  });

  it('cancelSubscription resolves without throwing for any id (no network, no state)', async () => {
    await expect(provider.cancelSubscription('sub_anything')).resolves.toBeUndefined();
  });

  it('getInvoices returns fake, deterministic invoice data (epic spec: UI surface)', async () => {
    const a = await provider.getInvoices('cus_1');
    const b = await provider.getInvoices('cus_1');
    expect(a).toHaveLength(1);
    expect(a[0]?.id).toBe(b[0]?.id);
    expect(a[0]?.status).toBe('paid');
  });
});

describe('NullPaymentProvider.constructWebhookEvent — signature verification', () => {
  const provider = new NullPaymentProvider();
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'subscription.created',
    occurredAt: '2026-01-01T00:00:00.000Z',
    data: { externalCustomerId: 'cus_1', planSlug: 'growth' },
  });

  it('accepts a validly signed payload and parses it into a WebhookEvent', () => {
    const signature = signWebhookPayload(payload, 'test-webhook-secret');
    const event = provider.constructWebhookEvent(payload, signature);
    expect(event).toEqual({
      id: 'evt_1',
      type: 'subscription.created',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      data: { externalCustomerId: 'cus_1', planSlug: 'growth' },
    });
  });

  it('rejects a tampered payload signed under a different signature (bit-flipped payload, same signature)', () => {
    const signature = signWebhookPayload(payload, 'test-webhook-secret');
    const tamperedPayload = payload.replace('subscription.created', 'subscription.cancelled');
    expect(() => provider.constructWebhookEvent(tamperedPayload, signature)).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('rejects a payload signed with the wrong secret', () => {
    const wrongSignature = signWebhookPayload(payload, 'a-completely-different-secret');
    expect(() => provider.constructWebhookEvent(payload, wrongSignature)).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('rejects a garbage (non-hex, wrong-length) signature without throwing an unrelated error', () => {
    expect(() => provider.constructWebhookEvent(payload, 'not-a-real-signature')).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('rejects an empty signature', () => {
    expect(() => provider.constructWebhookEvent(payload, '')).toThrow(InvalidWebhookSignatureError);
  });

  it('verifies the signature BEFORE parsing — a tampered payload never reaches JSON.parse', () => {
    const signature = signWebhookPayload(payload, 'test-webhook-secret');
    // Not valid JSON at all — if signature verification ran after parsing,
    // this would throw a JSON parse error instead of a signature error.
    const notJson = 'not json at all';
    expect(() => provider.constructWebhookEvent(notJson, signature)).toThrow(InvalidWebhookSignatureError);
  });

  it('throws WebhookSecretNotConfiguredError when BILLING_WEBHOOK_SECRET is unset', () => {
    delete process.env.BILLING_WEBHOOK_SECRET;
    const signature = signWebhookPayload(payload, 'irrelevant');
    expect(() => provider.constructWebhookEvent(payload, signature)).toThrow(
      WebhookSecretNotConfiguredError,
    );
  });

  it('rejects a well-signed payload missing required id/type fields', () => {
    const malformed = JSON.stringify({ data: {} });
    const signature = signWebhookPayload(malformed, 'test-webhook-secret');
    expect(() => provider.constructWebhookEvent(malformed, signature)).toThrow(
      /missing required "id"\/"type"/,
    );
  });
});

describe('getPaymentProvider', () => {
  afterEach(() => __setPaymentProviderForTesting(undefined));

  it('returns a NullPaymentProvider singleton', () => {
    const a = getPaymentProvider();
    const b = getPaymentProvider();
    expect(a).toBe(b);
    expect(a.name).toBe('null_provider');
  });
});
