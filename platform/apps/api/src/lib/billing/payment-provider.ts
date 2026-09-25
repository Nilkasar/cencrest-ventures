/**
 * `PaymentProvider` — the abstraction `docs/16-billing/BILLING_ARCHITECTURE.md`'s
 * "PAYMENT PROVIDER ABSTRACTION" section defines, transcribed here verbatim
 * (method names + `ExternalCustomer`/`ExternalSubscription`/`Invoice`/
 * `WebhookEvent` shapes) so nothing downstream needs a second, slightly-
 * different copy of this contract. Same discipline `lib/seo/seo-data-
 * provider.ts` (Epic 4) already established for its own provider seam —
 * this file mirrors that one's shape closely on purpose.
 *
 * Routes call `getPaymentProvider()` (bottom of this file), never
 * `new NullPaymentProvider()` directly, so wiring in a real `StripeProvider`
 * later (BILLING_ARCHITECTURE.md's own example — `class StripeProvider
 * implements PaymentProvider`) is a one-function change.
 *
 * **Why a single factory function, not a full registry class**
 * (`packages/ai-provider/src/registry.ts`): same reasoning
 * `seo-data-provider.ts` gives — this epic ships exactly ONE real
 * implementation (`NullPaymentProvider`); there is no routing table to
 * encode yet.
 *
 * **Scope boundary** (epic spec, "Important scope boundary"): this epic
 * does NOT wire a real Stripe integration — no live payment calls, per this
 * build's own "no real network calls to any payment provider" constraint.
 * `NullPaymentProvider` makes zero network calls and generates deterministic
 * fake external ids (a pure function of its inputs — no `Math.random`, no
 * `Date.now()` — so the same call always produces the same id, which is
 * what "deterministic" concretely buys the test suite below).
 *
 * `constructWebhookEvent`'s signature-verification path IS real (HMAC-SHA256
 * against `BILLING_WEBHOOK_SECRET`) even though nothing calls it with a real
 * Stripe payload yet — `docs/08-security/SECURITY.md`: "webhook signatures
 * verified before processing" is a security-relevant code path worth
 * building correctly from day one (epic spec, verbatim).
 *
 * **Update (go-live): the scope boundary above is now lifted.** The
 * "one-function change" this header predicted has been made — `StripeProvider`
 * below is a real, network-backed implementation of this exact contract, and
 * `createPaymentProviderFromEnv()` selects it when `STRIPE_SECRET_KEY` is
 * set. `NullPaymentProvider` is unchanged and remains the fallback whenever
 * it is not, which is what keeps local dev, CI and every existing test in
 * this file's suite running with zero Stripe configuration. Nothing above
 * this line (the interface, the four data shapes, the seven-event union,
 * `signWebhookPayload`, the HMAC path) was redesigned to accommodate it.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import { PLAN_TIERS, type PlanTier } from './plan-catalog.js';

export interface ExternalCustomer {
  id: string;
  email: string;
  name: string;
}

export interface ExternalSubscription {
  id: string;
  customerId: string;
  planId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export interface Invoice {
  id: string;
  customerId: string;
  amountCents: number;
  currency: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  createdAt: Date;
}

/**
 * The seven webhook event types `docs/16-billing/BILLING_ARCHITECTURE.md`'s
 * "BILLING EVENTS → ACTIONS" table documents, transcribed verbatim as a
 * closed union rather than a bare `string` — every consumer (the state
 * machine, the webhook route) can then exhaustively switch over this type.
 */
export type BillingWebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.past_due'
  | 'subscription.unpaid'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed';

export interface BillingWebhookEventData {
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  /** Present on `subscription.created`/`subscription.updated` — which real
   * plan slug the external subscription now points at. */
  planSlug?: string;
  /** Present on `invoice.payment_failed` — which retry attempt this is in
   * BILLING_ARCHITECTURE.md's "FAILED PAYMENT HANDLING" day-0/3/7 schedule
   * (day 0 = 1st attempt/first failure, day 3 = 2nd, day 7 = 3rd/final).
   * Day 10's actual downgrade is its own separate `subscription.unpaid`
   * event, not a 4th attempt number — see `webhook-state-machine.ts`'s
   * header comment for the full event-to-day mapping. */
  attempt?: 1 | 2 | 3;
}

export interface WebhookEvent {
  /** The external event id — `webhook-state-machine.ts`'s caller
   * (`routes/billing-webhooks.ts`) dedupes on this for idempotency. */
  id: string;
  type: BillingWebhookEventType;
  occurredAt: Date;
  data: BillingWebhookEventData;
}

export interface PaymentProvider {
  readonly name: string;

  createCustomer(email: string, name: string): Promise<ExternalCustomer>;
  createSubscription(customerId: string, planId: string): Promise<ExternalSubscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  upgradeSubscription(subscriptionId: string, newPlanId: string): Promise<ExternalSubscription>;

  getInvoices(customerId: string): Promise<Invoice[]>;

  /** Verifies `signature` against `payload` (HMAC-SHA256, see
   * `signWebhookPayload` below for how a valid one is produced) BEFORE
   * parsing anything out of `payload` — a tampered payload must never reach
   * `JSON.parse`, let alone the state machine. Throws
   * `InvalidWebhookSignatureError` on any mismatch. */
  constructWebhookEvent(payload: string, signature: string): WebhookEvent;
}

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super('Webhook signature verification failed');
    this.name = 'InvalidWebhookSignatureError';
  }
}

export class WebhookSecretNotConfiguredError extends Error {
  constructor() {
    super(
      'BILLING_WEBHOOK_SECRET is not set. Configure it in the environment before accepting billing webhooks.',
    );
    this.name = 'WebhookSecretNotConfiguredError';
  }
}

/** Read fresh from `process.env` on every call (not cached at module load —
 * same reasoning as `lib/internal-org.ts`), so a test can set/unset it
 * per-case without needing a module reset. Fails closed (throws) rather
 * than falling back to a baked-in dev secret if unset — the JWT keypair
 * (`lib/jwt.ts`) uses the identical fail-closed pattern for the same class
 * of secret. */
function getWebhookSecret(): string {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) throw new WebhookSecretNotConfiguredError();
  return secret;
}

/** Produces a valid signature for `payload` under the configured (or
 * explicitly passed, for tests) secret — the exact counterpart
 * `constructWebhookEvent` verifies against. Exported so
 * `payment-provider.test.ts` (valid case) and any future real
 * `StripeProvider` adapter's own tests can construct one without
 * duplicating the HMAC call. */
export function signWebhookPayload(payload: string, secret: string = getWebhookSecret()): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function verifySignature(payload: string, signature: string): void {
  const secret = getWebhookSecret();
  const expected = Buffer.from(signWebhookPayload(payload, secret), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    throw new InvalidWebhookSignatureError();
  }
  // `timingSafeEqual` throws on mismatched lengths instead of returning
  // `false` — checked explicitly first so a tampered signature of a
  // different length fails the same way (an error) as one of the same
  // length, rather than crashing this function differently depending on
  // attacker input length.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new InvalidWebhookSignatureError();
  }
}

/** Deterministic id generator — a pure function of its inputs (a SHA-256
 * digest, truncated), never `Math.random()`/`Date.now()`. The same
 * `(prefix, ...parts)` call always produces the same fake external id,
 * which is what "deterministic" concretely buys: a test can assert an exact
 * value, and calling `createCustomer` twice with the same email/name is
 * idempotent at the id level (matches how a real provider would also
 * usually treat "customer already exists for this email" as an upsert, not
 * a fresh row every time). */
function deterministicId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The always-available, no-network default (epic spec: "Ship a
 * NullPaymentProvider that behaves deterministically... so upgrade/
 * downgrade/cancel flows are fully testable now"). Never calls out to any
 * real payment network — every method is a pure/local computation.
 */
export class NullPaymentProvider implements PaymentProvider {
  readonly name = 'null_provider';

  async createCustomer(email: string, name: string): Promise<ExternalCustomer> {
    return { id: deterministicId('null_cus', email.toLowerCase()), email, name };
  }

  async createSubscription(customerId: string, planId: string): Promise<ExternalSubscription> {
    const now = new Date();
    return {
      id: deterministicId('null_sub', customerId, planId),
      customerId,
      planId,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + THIRTY_DAYS_MS),
    };
  }

  /** No-op — this provider holds no state of its own to mutate (the real
   * subscription record of truth is the caller's own `subscriptions` table
   * row); a real `StripeProvider` would make the actual cancel-at-provider
   * API call here. Never throws for an unknown id — cancellation must never
   * become a reason a downgrade fails partway through. */
  async cancelSubscription(_subscriptionId: string): Promise<void> {
    // Intentionally empty — see doc comment above.
  }

  async upgradeSubscription(subscriptionId: string, newPlanId: string): Promise<ExternalSubscription> {
    const now = new Date();
    return {
      id: subscriptionId,
      customerId: deterministicId('null_cus', subscriptionId),
      planId: newPlanId,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + THIRTY_DAYS_MS),
    };
  }

  /** Fake invoice history — epic spec's "UI surface": "invoice history
   * (from the NullPaymentProvider's fake data until real Stripe is
   * wired)." One deterministic paid invoice, not a fabricated multi-month
   * history — enough for the frontend to render a real list without this
   * provider inventing a business history that never happened. */
  async getInvoices(customerId: string): Promise<Invoice[]> {
    const now = new Date();
    return [
      {
        id: deterministicId('null_inv', customerId, now.toISOString().slice(0, 7)),
        customerId,
        amountCents: 0,
        currency: 'USD',
        status: 'paid',
        createdAt: now,
      },
    ];
  }

  constructWebhookEvent(payload: string, signature: string): WebhookEvent {
    verifySignature(payload, signature);

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Error('Webhook payload is not valid JSON');
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== 'string' ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      throw new Error('Webhook payload is missing required "id"/"type" fields');
    }

    const record = parsed as { id: string; type: string; occurredAt?: string; data?: BillingWebhookEventData };
    return {
      id: record.id,
      type: record.type as BillingWebhookEventType,
      occurredAt: record.occurredAt ? new Date(record.occurredAt) : new Date(),
      data: record.data ?? {},
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// StripeProvider — the real, network-backed implementation. Lives in this
// file (not a sibling module) deliberately: it needs `InvalidWebhookSignature
// Error`/`WebhookSecretNotConfiguredError` as runtime values and
// `getPaymentProvider()` needs the class, so splitting it out would create a
// genuine ESM import cycle for zero benefit.
//
// **Nothing about prices is encoded here.** Money lives in Stripe (the
// `Price` objects) and in the `plans` table (`price_monthly`/`price_yearly`,
// `limits`, `features`). This adapter only ever resolves a *plan slug* to a
// Stripe Price by that Price's `lookup_key` (or its
// `metadata.plan_slug`) — so changing a price is a Stripe dashboard change,
// never a deploy. Entitlements are untouched: `lib/entitlements.ts` keeps
// reading `plans.limits` JSONB, and this class never looks at them.
//
// **Configuration a human must do in Stripe** (see GO_LIVE.md §3): create
// one recurring Price per paid tier and set its `lookup_key` to the plan
// slug exactly as it appears in `plan-catalog.ts` (`starter`, `growth`,
// `pro`, `agency`, `managed`, `enterprise`). `free` needs no Price — it is
// never sent to Stripe.
// ─────────────────────────────────────────────────────────────────────────

/** A well-signed Stripe event whose type this platform has no transition
 * for (Stripe sends dozens by default). Distinct from
 * `InvalidWebhookSignatureError` because the caller must treat it
 * completely differently: acknowledge with 200 so Stripe stops retrying,
 * rather than 400 + a security audit row. Signature verification has
 * already SUCCEEDED by the time this is thrown. */
export class UnsupportedWebhookEventError extends Error {
  readonly stripeEventType: string;

  constructor(stripeEventType: string) {
    super(`Unsupported Stripe webhook event type: ${stripeEventType}`);
    this.name = 'UnsupportedWebhookEventError';
    this.stripeEventType = stripeEventType;
  }
}

export class StripePriceNotFoundError extends Error {
  constructor(planSlug: string) {
    super(
      `No active Stripe Price found for plan "${planSlug}". Create a recurring Price in Stripe with lookup_key="${planSlug}" (or metadata.plan_slug="${planSlug}").`,
    );
    this.name = 'StripePriceNotFoundError';
  }
}

export interface StripeProviderConfig {
  secretKey: string;
  /** Optional at construction — read fresh from the environment on every
   * `constructWebhookEvent` call when omitted, so a missing endpoint secret
   * fails closed at REQUEST time (a 400 on one webhook) rather than at boot
   * (a dead process). Same fail-closed-but-never-at-boot discipline
   * `getWebhookSecret()` above already uses. */
  webhookSecret?: string;
}

/** Reads Stripe's endpoint secret fresh from `process.env` (not cached at
 * module load — identical reasoning to `getWebhookSecret()` above).
 * `STRIPE_WEBHOOK_SECRET` is preferred; `BILLING_WEBHOOK_SECRET` is honoured
 * as a fallback so a deployment already configured against GO_LIVE.md §2's
 * original variable name keeps working. */
function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) throw new WebhookSecretNotConfiguredError();
  return secret;
}

/** Stripe expandable fields are `string | Object | null`. */
function idOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/** Reads a numeric field off an arbitrary Stripe object without `any`.
 * Needed because Stripe moved `current_period_start`/`current_period_end`
 * from `Subscription` onto `SubscriptionItem` in the 2025-06-30 (`basil`)
 * API version, and moved an invoice's subscription id under
 * `parent.subscription_details`. Reading both shapes defensively means this
 * adapter keeps working across that boundary instead of silently producing
 * `Invalid Date` / a missing subscription id on one side of it. */
function numberField(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function nested(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/** The billing period the platform stores on `subscriptions.current_period_*`.
 * Falls back to "now + 30 days" only if Stripe returned neither shape, so a
 * period is never persisted as an invalid date. */
function subscriptionPeriod(subscription: Stripe.Subscription): { start: Date; end: Date } {
  const item = subscription.items?.data?.[0];
  const startEpoch =
    numberField(item, 'current_period_start') ??
    numberField(subscription, 'current_period_start') ??
    numberField(subscription, 'start_date');
  const endEpoch =
    numberField(item, 'current_period_end') ?? numberField(subscription, 'current_period_end');

  const start = startEpoch === undefined ? new Date() : new Date(startEpoch * 1000);
  const end = endEpoch === undefined ? new Date(start.getTime() + THIRTY_DAYS_MS) : new Date(endEpoch * 1000);
  return { start, end };
}

/** Which plan a Stripe subscription currently points at, expressed the way
 * the rest of this codebase speaks about plans: the slug. `lookup_key`
 * first (the documented convention above), then `metadata.plan_slug`.
 * Returns `undefined` for a Price configured with neither — the caller then
 * leaves `planSlug` off the event entirely and the state machine keeps the
 * current plan rather than guessing. */
function planSlugOf(subscription: Stripe.Subscription): PlanTier | undefined {
  const price = subscription.items?.data?.[0]?.price;
  const candidate =
    price?.lookup_key ??
    (typeof price?.metadata?.plan_slug === 'string' ? price.metadata.plan_slug : undefined);
  if (!candidate) return undefined;
  return (PLAN_TIERS as readonly string[]).includes(candidate) ? (candidate as PlanTier) : undefined;
}

/** `ExternalSubscription.planId` — the slug when the Price carries one, else
 * the raw Stripe price id, so the field is never an empty string. */
function externalPlanIdOf(subscription: Stripe.Subscription): string {
  return planSlugOf(subscription) ?? subscription.items?.data?.[0]?.price?.id ?? '';
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  // Pre-`basil`: `invoice.subscription`. `basil`+: `invoice.parent.
  // subscription_details.subscription`.
  return (
    idOf(nested(invoice, 'subscription')) ??
    idOf(nested(nested(nested(invoice, 'parent'), 'subscription_details'), 'subscription'))
  );
}

function toExternalSubscription(subscription: Stripe.Subscription): ExternalSubscription {
  const { start, end } = subscriptionPeriod(subscription);
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer) ?? '',
    planId: externalPlanIdOf(subscription),
    status: subscription.status,
    currentPeriodStart: start,
    currentPeriodEnd: end,
  };
}

const INVOICE_STATUS: Record<string, Invoice['status']> = {
  paid: 'paid',
  open: 'open',
  draft: 'open',
  void: 'void',
  uncollectible: 'uncollectible',
};

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';

  private readonly stripe: Stripe;
  private readonly configuredWebhookSecret?: string;

  constructor(config: StripeProviderConfig, stripeClient?: Stripe) {
    this.configuredWebhookSecret = config.webhookSecret;
    this.stripe =
      stripeClient ??
      new Stripe(config.secretKey, {
        // No `apiVersion` pin on purpose: the SDK sends the version its own
        // types were generated against, so runtime and types can never
        // disagree. Pinning to a string this SDK build predates is how an
        // adapter starts silently reading fields Stripe no longer sends.
        maxNetworkRetries: 2,
        timeout: 20_000,
        appInfo: { name: 'BeBest', url: 'https://bebestwithai.com' },
      });
  }

  /** Resolves whatever the caller calls a "plan" into a Stripe Price id.
   * Accepts a raw `price_…` id (passed straight through) or a plan slug
   * (looked up by `lookup_key`, then by `metadata.plan_slug`). No price or
   * amount is ever read from code — see this section's header comment. */
  private async resolvePriceId(planId: string): Promise<string> {
    if (planId.startsWith('price_')) return planId;

    const byLookupKey = await this.stripe.prices.list({
      lookup_keys: [planId],
      active: true,
      limit: 1,
    });
    const found = byLookupKey.data[0];
    if (found) return found.id;

    // Fallback for an account whose Prices were created without
    // `lookup_key` (it cannot be added retroactively to an existing Price).
    const active = await this.stripe.prices.list({ active: true, limit: 100 });
    const byMetadata = active.data.find((price) => price.metadata?.plan_slug === planId);
    if (byMetadata) return byMetadata.id;

    throw new StripePriceNotFoundError(planId);
  }

  /** Reuses an existing Stripe customer for the same email rather than
   * creating a duplicate — matching `NullPaymentProvider`'s deliberate
   * "same email always yields the same id" behaviour, and avoiding the
   * classic duplicate-customer mess when a retried upgrade calls this
   * twice. */
  async createCustomer(email: string, name: string): Promise<ExternalCustomer> {
    const existing = await this.stripe.customers.list({ email, limit: 1 });
    const found = existing.data[0];
    if (found) {
      return { id: found.id, email: found.email ?? email, name: found.name ?? name };
    }

    const created = await this.stripe.customers.create({ email, name });
    return { id: created.id, email: created.email ?? email, name: created.name ?? name };
  }

  async createSubscription(customerId: string, planId: string): Promise<ExternalSubscription> {
    const price = await this.resolvePriceId(planId);
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price }],
      // The customer may not have a usable payment method attached yet. With
      // `default_incomplete` Stripe creates the subscription in
      // `incomplete` status and leaves its first invoice awaiting payment
      // instead of throwing — the subscription only becomes `active` once
      // that invoice is paid, which arrives here as a real
      // `invoice.payment_succeeded` webhook. See this file's "remaining
      // gap" note: nothing in the `PaymentProvider` contract can hand a
      // card-collection secret back to the frontend, so a brand-new paid
      // subscription stays `incomplete` until payment is collected out of
      // band.
      payment_behavior: 'default_incomplete',
      proration_behavior: 'create_prorations',
    });
    return toExternalSubscription(subscription);
  }

  /** Cancels at Stripe immediately. Swallows ONLY `resource_missing` (the
   * subscription is already gone at Stripe — cancelling again is a no-op,
   * and per this codebase's non-negotiable, cancellation must never be the
   * reason a downgrade fails). Every other Stripe error is rethrown on
   * purpose: silently swallowing a transport failure here would leave a
   * LIVE subscription billing a customer who asked to cancel. The caller
   * (`routes/subscription.ts`) then fails the request, which is retryable —
   * and it still contains no `.delete()` on any table, so no customer data
   * is destroyed either way. */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing') {
        return;
      }
      throw err;
    }
  }

  /** Swaps the existing subscription item onto the new Price, keeping the
   * same Stripe subscription id (same observable behaviour as
   * `NullPaymentProvider.upgradeSubscription`). Also used for downgrades —
   * `routes/subscription.ts`'s `changePlan` calls this for both directions,
   * which is correct: a plan change at Stripe is one operation. */
  async upgradeSubscription(subscriptionId: string, newPlanId: string): Promise<ExternalSubscription> {
    const price = await this.resolvePriceId(newPlanId);
    const existing = await this.stripe.subscriptions.retrieve(subscriptionId);
    const itemId = existing.items?.data?.[0]?.id;

    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: itemId ? [{ id: itemId, price }] : [{ price }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    });
    return toExternalSubscription(updated);
  }

  async getInvoices(customerId: string): Promise<Invoice[]> {
    const list = await this.stripe.invoices.list({ customer: customerId, limit: 100 });
    return list.data.map((invoice) => ({
      id: invoice.id ?? '',
      customerId: idOf(invoice.customer) ?? customerId,
      amountCents: invoice.total,
      currency: invoice.currency.toUpperCase(),
      status: INVOICE_STATUS[invoice.status ?? 'draft'] ?? 'open',
      createdAt: new Date(invoice.created * 1000),
    }));
  }

  /** Real Stripe signature verification (`Stripe-Signature`: v1 HMAC-SHA256
   * over `timestamp.payload`, with a replay-window check), translated into
   * this file's existing `InvalidWebhookSignatureError` /
   * `WebhookSecretNotConfiguredError` vocabulary so
   * `routes/billing-webhooks.ts` needs no provider-specific branch and the
   * one existing idempotent state machine stays the only path. Synchronous,
   * exactly like the interface declares — Stripe's `constructEvent` is too. */
  constructWebhookEvent(payload: string, signature: string): WebhookEvent {
    const secret = this.configuredWebhookSecret ?? getStripeWebhookSecret();

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeSignatureVerificationError) {
        throw new InvalidWebhookSignatureError();
      }
      throw err;
    }

    const occurredAt = new Date(event.created * 1000);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const planSlug = planSlugOf(subscription);
        return {
          id: event.id,
          type: mapSubscriptionEventType(event.type, subscription.status),
          occurredAt,
          data: {
            externalCustomerId: idOf(subscription.customer),
            externalSubscriptionId: subscription.id,
            ...(planSlug ? { planSlug } : {}),
          },
        };
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        // Stripe's `attempt_count` grows past 3; the state machine's
        // day-0/3/7 schedule only distinguishes 1/2/3, so clamp rather
        // than widen that union.
        const attemptCount = numberField(invoice, 'attempt_count') ?? 1;
        const attempt = (attemptCount >= 3 ? 3 : attemptCount <= 1 ? 1 : 2) as 1 | 2 | 3;
        return {
          id: event.id,
          type: event.type,
          occurredAt,
          data: {
            externalCustomerId: idOf(invoice.customer),
            externalSubscriptionId: invoiceSubscriptionId(invoice),
            ...(event.type === 'invoice.payment_failed' ? { attempt } : {}),
          },
        };
      }

      default:
        // Well-signed, but nothing in `BillingWebhookEventType` covers it.
        throw new UnsupportedWebhookEventError(event.type);
    }
  }
}

/** Stripe has no distinct `past_due`/`unpaid` event — both arrive as a
 * `customer.subscription.updated` carrying the new `status`, so the mapping
 * has to read it. `docs/16-billing/BILLING_ARCHITECTURE.md`'s seven-event
 * vocabulary (and `webhook-state-machine.ts`'s day-0/3/7/10 schedule) is
 * preserved exactly; only the translation lives here. */
function mapSubscriptionEventType(
  stripeType: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
  status: Stripe.Subscription.Status,
): BillingWebhookEventType {
  if (stripeType === 'customer.subscription.deleted') return 'subscription.cancelled';
  if (stripeType === 'customer.subscription.created') return 'subscription.created';
  if (status === 'past_due') return 'subscription.past_due';
  if (status === 'unpaid') return 'subscription.unpaid';
  if (status === 'canceled') return 'subscription.cancelled';
  return 'subscription.updated';
}

let cachedProvider: PaymentProvider | undefined;

/**
 * Builds the provider the process should use from the environment.
 *
 * `STRIPE_SECRET_KEY` present -> the real `StripeProvider`.
 * Absent -> `NullPaymentProvider`, unchanged.
 *
 * **Never throws.** A missing/partial Stripe configuration must not be able
 * to kill the process at boot — local dev, CI and the test suite all run
 * with no Stripe key at all and must keep working. A missing *webhook*
 * secret likewise fails closed at request time (a 400 on that one webhook,
 * via `WebhookSecretNotConfiguredError`), never at startup.
 */
export function createPaymentProviderFromEnv(): PaymentProvider {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return new NullPaymentProvider();
  // `webhookSecret` deliberately omitted so `constructWebhookEvent` reads it
  // fresh from the environment per call (see `getStripeWebhookSecret`).
  return new StripeProvider({ secretKey });
}

/** The one function route code should call — never `new NullPaymentProvider()`
 * or `new StripeProvider(...)` directly (see this file's header comment on
 * why there is no registry class yet). Returns a process-lifetime singleton;
 * both implementations are stateless per request, so there is nothing gained
 * by constructing a fresh one each time. */
export function getPaymentProvider(): PaymentProvider {
  if (!cachedProvider) cachedProvider = createPaymentProviderFromEnv();
  return cachedProvider;
}

/** Test-only hook: lets a test inject a different `PaymentProvider` (e.g. a
 * spy wrapping `NullPaymentProvider`) instead of the process-wide singleton.
 * Never called from application code. Mirrors `lib/jwt.ts`'s
 * `__setKeysForTesting` naming/shape precedent. */
export function __setPaymentProviderForTesting(provider: PaymentProvider | undefined): void {
  cachedProvider = provider;
}
