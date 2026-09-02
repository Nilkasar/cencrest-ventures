import { Hono } from 'hono';
import { db } from '@bebest/database';
import { writeAuditEvent } from '../lib/audit.js';
import { getPaymentProvider, type BillingWebhookEventType } from '../lib/billing/payment-provider.js';
import { applyBillingWebhookEvent, type SubscriptionState } from '../lib/billing/webhook-state-machine.js';
import { findSubscriptionByExternalCustomerId, setSubscriptionPlan } from '../lib/billing/subscription-store.js';
import type { PlanTier } from '../lib/billing/plan-catalog.js';
import type { AppEnv } from '../types/context.js';

const billingWebhooksRoute = new Hono<AppEnv>();

/** Real Stripe uses `stripe-signature`; a generic, provider-agnostic header
 * name is used here to match the `PaymentProvider` abstraction — a future
 * `StripeProvider` reads whichever header its own SDK expects internally,
 * this route only ever deals with the abstraction's `constructWebhookEvent`. */
const SIGNATURE_HEADER = 'x-billing-signature';

// ── POST /api/webhooks/billing — signature-verified, routes to the state
// machine, idempotent (dedupe by event id). No auth middleware: the
// signature check IS the authentication for this endpoint (epic spec). ────
billingWebhooksRoute.post('/', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header(SIGNATURE_HEADER) ?? '';

  let event;
  try {
    event = getPaymentProvider().constructWebhookEvent(rawBody, signature);
  } catch (err) {
    // Rejected BEFORE any state change — logged as a security-relevant
    // event (epic spec's end-to-end flow step 6), not silently dropped.
    await writeAuditEvent({
      userId: null,
      organizationId: null,
      actorType: 'system',
      action: 'billing.webhook_rejected',
      entityType: 'billing_webhook_event',
      entityId: 'unknown',
      result: 'failure',
      details: { reason: err instanceof Error ? err.message : String(err) },
    });
    return c.json({ error: 'invalid_signature' }, 400);
  }

  // Idempotency — a replayed webhook must not double-apply an effect
  // (epic spec, verbatim). `external_event_id` is unique; a second delivery
  // of the same event id either already has `processed_at` set (return
  // immediately) or is racing an in-flight first delivery (the unique
  // constraint on create rejects the duplicate insert either way).
  const existingEventRow = await db.billing_webhook_events.findUnique({
    where: { external_event_id: event.id },
  });
  if (existingEventRow?.processed_at) {
    return c.json({ received: true, duplicate: true });
  }

  let eventRow = existingEventRow;
  if (!eventRow) {
    try {
      eventRow = await db.billing_webhook_events.create({
        data: {
          external_event_id: event.id,
          event_type: event.type,
          payload: JSON.parse(rawBody),
        },
      });
    } catch {
      // Lost the create race against a concurrent delivery of the same
      // event id — the other delivery owns processing it.
      return c.json({ received: true, duplicate: true });
    }
  }

  const subscription = event.data.externalCustomerId
    ? await findSubscriptionByExternalCustomerId(event.data.externalCustomerId)
    : null;

  if (!subscription) {
    // No matching subscription yet (e.g. a test/malformed event, or one
    // that arrived before the corresponding `createCustomer` call
    // persisted its id) — acknowledge so the sender doesn't retry forever,
    // but do not fabricate a state transition against nothing.
    await db.billing_webhook_events.update({
      where: { id: eventRow.id },
      data: { processed_at: new Date() },
    });
    return c.json({ received: true, ignored: true, reason: 'no_matching_subscription' });
  }

  const currentState: SubscriptionState = {
    status: subscription.status,
    planSlug: subscription.plans.slug as PlanTier,
    cancelledAt: subscription.cancelled_at,
  };

  const result = applyBillingWebhookEvent(currentState, {
    type: event.type as BillingWebhookEventType,
    occurredAt: event.occurredAt,
    data: {
      planSlug: event.data.planSlug as PlanTier | undefined,
      attempt: event.data.attempt,
    },
  });

  // Persist the new state in ONE `.update()` call — never `.delete()`
  // anywhere on this path (the epic's non-negotiable, checked here at the
  // one place a webhook can change a subscription's plan/status).
  await setSubscriptionPlan(subscription.organization_id, subscription.id, result.nextState.planSlug, {
    status: result.nextState.status,
    cancelled_at: result.nextState.cancelledAt,
  });

  // organizations has no RLS (DECISIONS.md §1) — plain `db.update()`, never
  // `.delete()`, matching routes/subscription.ts's cancel handler exactly.
  await db.organizations.update({
    where: { id: subscription.organization_id },
    data: { status: result.orgStatus },
  });

  for (const effect of result.sideEffects) {
    if (effect.type === 'send_email') {
      // Dev-mode substitute for real email delivery — same pattern
      // routes/orgs.ts's invitation flow already uses.
      // eslint-disable-next-line no-console -- dev-mode substitute for email delivery
      console.log(`[dev email] billing.${effect.template} -> org ${subscription.organization_id}`);
    } else if (effect.type === 'audit_log') {
      await writeAuditEvent({
        userId: null,
        organizationId: subscription.organization_id,
        actorType: 'system',
        action: effect.action,
        entityType: 'subscription',
        entityId: subscription.id,
        result: 'success',
        details: { eventType: event.type, externalEventId: event.id },
      });
    }
    // 'set_plan'/'restrict_to_free' are already reflected by the single
    // setSubscriptionPlan()/organizations.update() calls above — no
    // separate action needed per effect.
  }

  await db.billing_webhook_events.update({
    where: { id: eventRow.id },
    data: { organization_id: subscription.organization_id, processed_at: new Date() },
  });

  return c.json({ received: true });
});

export default billingWebhooksRoute;
