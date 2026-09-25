import { Hono } from 'hono';
import { db, withOrgContext } from '@bebest/database';
import { writeAuditEvent, writeAuditEventWithin } from '../lib/audit.js';
import {
  getPaymentProvider,
  UnsupportedWebhookEventError,
  type BillingWebhookEventType,
} from '../lib/billing/payment-provider.js';
import { applyBillingWebhookEvent, type SubscriptionState } from '../lib/billing/webhook-state-machine.js';
import {
  findSubscriptionByExternalCustomerId,
  requirePlan,
  setSubscriptionPlanWithin,
} from '../lib/billing/subscription-store.js';
import type { PlanTier } from '../lib/billing/plan-catalog.js';
import type { AppEnv } from '../types/context.js';

const billingWebhooksRoute = new Hono<AppEnv>();

/** Real Stripe sends `Stripe-Signature`; `x-billing-signature` is the
 * generic, provider-agnostic name `NullPaymentProvider`'s HMAC path (and its
 * test suite) uses. Both are read, in that order, so the SAME route and the
 * SAME idempotent state machine below serve a real Stripe endpoint and the
 * provider-agnostic contract — there is deliberately no second webhook path
 * beside this one. Whichever header is present is handed verbatim to the
 * configured provider's `constructWebhookEvent`, which owns verification. */
const STRIPE_SIGNATURE_HEADER = 'stripe-signature';
const SIGNATURE_HEADER = 'x-billing-signature';

// ── POST /api/webhooks/billing — signature-verified, routes to the state
// machine, idempotent (dedupe by event id). No auth middleware: the
// signature check IS the authentication for this endpoint (epic spec).
//
// Two properties this handler is built around, both of which it previously
// only appeared to have:
//
//   REPLAY SAFETY. The dedupe guard below keys off `processed_at`, so
//   `processed_at` must be committed in the SAME transaction as the effects it
//   claims are done. It used to be the last of four sequential writes, which
//   made a replay idempotent for the subscription's STATE (the same transition
//   re-applied) but not for its EFFECTS (audit rows, emails, and an
//   `organizations.update` re-applied over whatever had happened since).
//
//   ORDERING. `occurredAt` was passed to the state machine and never compared
//   to anything. Events are now applied on provider time, not arrival time —
//   see `subscriptions.last_billing_event_at`.
//
// Unchanged, deliberately: HMAC verification happens before anything is
// parsed, and an `UnsupportedWebhookEventError` is acknowledged with 200 and
// no row (nothing was applied, so there is no effect to dedupe later). ─────
billingWebhooksRoute.post('/', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header(STRIPE_SIGNATURE_HEADER) ?? c.req.header(SIGNATURE_HEADER) ?? '';

  let event;
  try {
    event = getPaymentProvider().constructWebhookEvent(rawBody, signature);
  } catch (err) {
    // A WELL-SIGNED event this platform has no transition for (Stripe sends
    // dozens of event types to an endpoint by default). Verification already
    // SUCCEEDED, so this is not a security event and must not be audited as
    // one — and it must be acknowledged with 200, or Stripe retries it for
    // days. No `billing_webhook_events` row is written: nothing was applied,
    // so there is no effect to dedupe against later.
    if (err instanceof UnsupportedWebhookEventError) {
      return c.json({ received: true, ignored: true, reason: 'unsupported_event_type' });
    }

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
          // When the PROVIDER says it happened, not when it reached us — the
          // ordering guard below decides against this value, so it is recorded
          // rather than left only in the payload blob.
          occurred_at: event.occurredAt,
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
      data: { processed_at: new Date(), skipped_reason: 'no_matching_subscription' },
    });
    return c.json({ received: true, ignored: true, reason: 'no_matching_subscription' });
  }

  const organizationId = subscription.organization_id;
  const eventRowId = eventRow.id;

  // Every plan row the state machine could possibly resolve to, read BEFORE
  // the transaction opens. `plans` is global reference data with no RLS, and
  // reading it from inside an open interactive transaction would borrow a
  // second pooled connection for the transaction's whole lifetime. The
  // reachable set is small and closed: whatever the row is on now, whatever
  // the event names, and `free` (every downgrade/cancellation target).
  const candidatePlanSlugs = new Set<PlanTier>([
    subscription.plans.slug as PlanTier,
    'free',
    ...(event.data.planSlug ? [event.data.planSlug as PlanTier] : []),
  ]);
  const plansBySlug = new Map(
    await Promise.all([...candidatePlanSlugs].map(async (slug) => [slug, await requirePlan(slug)] as const)),
  );

  // ── APPLY, ATOMICALLY ────────────────────────────────────────────────────
  //
  // The state transition, its side effects and the `processed_at` marker are
  // ONE transaction. They were four sequential writes with `processed_at`
  // last, which made replay idempotent for STATE but not for EFFECTS: a crash
  // (or a lost connection, or a serverless freeze) between the subscription
  // update and the `processed_at` write left the row looking unprocessed, so
  // the provider's retry sailed through the dedupe guard above and re-ran
  // `setSubscriptionPlan`, the `organizations.update` and every audit write —
  // by which time a LATER event may already have moved the subscription on.
  //
  // Everything below either all commits or none of it does, so a retry sees
  // either "already processed" (and returns immediately) or a subscription
  // untouched by this event (and applies it exactly once).
  //
  // `organizations` has no RLS (DECISIONS.md §1) and `billing_webhook_events`
  // deliberately has none either (0009_billing/rls.sql) — both are written
  // through the same `tx` anyway, because what matters here is the transaction
  // boundary, not the policy. Still not one `.delete()` call on this path.
  const outcome = await withOrgContext(organizationId, async (tx) => {
    // Serialize concurrent deliveries for THIS subscription. Two events for
    // the same customer can arrive at once; without the lock both would read
    // the same "current" state and the second would overwrite the first's
    // decision, which is the ordering guard below being defeated by a race
    // rather than by a stale delivery.
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscription.id}::uuid FOR UPDATE`;

    const fresh = await tx.subscriptions.findUniqueOrThrow({
      where: { id: subscription.id },
      include: { plans: true },
    });

    // ── ORDERING ─────────────────────────────────────────────────────────
    // Stripe does not guarantee delivery order, and its own retries make
    // reordering routine: a `payment_failed` that failed to deliver at 10:00
    // can arrive after the 10:05 `payment_succeeded`. Applied in arrival
    // order that downgrades a subscription which has already recovered.
    // Decided on the provider's `occurredAt` (`event.created`), never on
    // arrival time. STRICTLY older is refused; equal still applies, because
    // Stripe's timestamp has one-second resolution and inventing an order
    // for same-second events would be a guess.
    if (fresh.last_billing_event_at && event.occurredAt < fresh.last_billing_event_at) {
      await tx.billing_webhook_events.update({
        where: { id: eventRowId },
        data: { organization_id: organizationId, processed_at: new Date(), skipped_reason: 'superseded_by_newer_event' },
      });
      // Audited, not just logged: "a billing event was deliberately not
      // applied" is exactly the kind of thing someone reconciling an account
      // needs to be able to find.
      await writeAuditEventWithin(tx, {
        userId: null,
        organizationId,
        actorType: 'system',
        action: 'billing.webhook_superseded',
        entityType: 'subscription',
        entityId: subscription.id,
        result: 'success',
        details: {
          eventType: event.type,
          externalEventId: event.id,
          occurredAt: event.occurredAt.toISOString(),
          lastAppliedAt: fresh.last_billing_event_at.toISOString(),
          lastAppliedEventId: fresh.last_billing_event_id,
        },
      });
      return { applied: false as const };
    }

    const currentState: SubscriptionState = {
      status: fresh.status,
      planSlug: fresh.plans.slug as PlanTier,
      cancelledAt: fresh.cancelled_at,
    };

    const result = applyBillingWebhookEvent(currentState, {
      type: event.type as BillingWebhookEventType,
      occurredAt: event.occurredAt,
      data: {
        planSlug: event.data.planSlug as PlanTier | undefined,
        attempt: event.data.attempt,
      },
    });

    // Pre-loaded in the overwhelming majority of cases. The fallback covers
    // the race where a concurrent delivery moved the row to a plan that was
    // not in the candidate set computed before the lock: read it now rather
    // than rolling the event back over a plan lookup.
    const nextPlan = plansBySlug.get(result.nextState.planSlug) ?? (await requirePlan(result.nextState.planSlug));

    // Persist the new state in ONE `.update()` call, carrying the ordering
    // watermark in the SAME statement — the row cannot record a state without
    // recording which event produced it.
    await setSubscriptionPlanWithin(tx, subscription.id, nextPlan, {
      status: result.nextState.status,
      cancelled_at: result.nextState.cancelledAt,
      last_billing_event_at: event.occurredAt,
      last_billing_event_id: event.id,
    });

    await tx.organizations.update({
      where: { id: organizationId },
      data: { status: result.orgStatus },
    });

    for (const effect of result.sideEffects) {
      if (effect.type === 'audit_log') {
        await writeAuditEventWithin(tx, {
          userId: null,
          organizationId,
          actorType: 'system',
          action: effect.action,
          entityType: 'subscription',
          entityId: subscription.id,
          result: 'success',
          details: { eventType: event.type, externalEventId: event.id },
        });
      }
      // 'set_plan'/'restrict_to_free' are already reflected by the single
      // setSubscriptionPlanWithin()/organizations.update() calls above — no
      // separate action needed per effect. 'send_email' is handled AFTER the
      // commit: see below.
    }

    await tx.billing_webhook_events.update({
      where: { id: eventRowId },
      data: { organization_id: organizationId, processed_at: new Date() },
    });

    return {
      applied: true as const,
      emails: result.sideEffects.flatMap((effect) => (effect.type === 'send_email' ? [effect.template] : [])),
    };
  });

  if (!outcome.applied) {
    return c.json({ received: true, ignored: true, reason: 'superseded_by_newer_event' });
  }

  // EMAILS ARE NOT TRANSACTIONAL, and cannot be: sending is an external call
  // with no rollback. They are sent AFTER the commit deliberately — sending
  // before it risks telling a customer their payment failed for a transition
  // that then rolled back, and a crash here loses one notification rather than
  // re-sending it on every retry (the committed `processed_at` makes the retry
  // a no-op). A crash between the commit and this loop therefore drops the
  // email; the state is correct either way. Making dunning mail exactly-once
  // needs an outbox table, which is its own piece of work.
  for (const template of outcome.emails) {
    // Dev-mode substitute for real email delivery — same pattern
    // routes/orgs.ts's invitation flow already uses.
    // eslint-disable-next-line no-console -- dev-mode substitute for email delivery
    console.log(`[dev email] billing.${template} -> org ${organizationId}`);
  }

  return c.json({ received: true });
});

export default billingWebhooksRoute;
