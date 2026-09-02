/**
 * Epic 16 (Billing) — the billing webhook event-to-action state machine,
 * `docs/16-billing/BILLING_ARCHITECTURE.md`'s "BILLING EVENTS → ACTIONS"
 * table and "FAILED PAYMENT HANDLING" day-0/3/7/10 schedule, implemented as
 * a pure function of `(currentState, event) -> { nextState, sideEffects }`
 * (epic brief, verbatim) so every documented transition is unit-testable
 * without a real webhook ever arriving.
 *
 * **Day-0/3/7/10 schedule -> event mapping** (the epic brief's literal
 * requirement — read this before changing any transition below):
 *   - Day 0 (payment fails)  -> `subscription.past_due` (Stripe fires this
 *     alongside the first `invoice.payment_failed`; both land the
 *     subscription in `past_due` without touching the plan).
 *   - Day 3 (first retry)    -> `invoice.payment_failed` with `attempt: 2`.
 *   - Day 7 (final retry)    -> `invoice.payment_failed` with `attempt: 3`.
 *   - Day 10 (downgrade)     -> `subscription.unpaid` — the ONLY event in
 *     this table that actually changes the plan. Days 0/3/7 all send an
 *     email and change nothing else — the epic's own explicit test
 *     requirement ("does NOT downgrade immediately" at day 0, "confirm
 *     downgrade-to-free" at day 10) is a property of which event carries
 *     the `set_plan`/`restrict_to_free` side effects, not of time having
 *     passed — the actual day-counting cron is deferred to a later epic
 *     (epic brief, verbatim), so this function never reads a clock.
 *
 * `subscription.unpaid` is a DOWNGRADE, not a CANCELLATION — the doc's own
 * words ("Customer can reactivate by updating payment method") describe an
 * org that is still subscribed (now to `free`), not one whose `org.status`
 * becomes `'cancelled'`. Only `subscription.cancelled` sets `orgStatus:
 * 'cancelled'` — see `docs/16-billing/BILLING_ARCHITECTURE.md`'s "DATA
 * RETENTION ON CANCELLATION" section, which is specifically about a
 * customer CANCELLING, a different, deliberate customer action from a
 * payment merely failing four times.
 *
 * This module never deletes anything — it does not even touch a database;
 * it returns data describing what should happen, for
 * `routes/billing-webhooks.ts` to apply via `.update()` calls only. That
 * route file, not this one, is what the epic's "no delete call anywhere in
 * the cancellation path" invariant is ultimately checked against, but the
 * invariant starts here: `BillingSideEffect` has no `delete_*` variant at
 * all, so there is nothing a caller could even accidentally wire to a
 * delete.
 */

import type { subscription_status } from '@bebest/database';
import type { PlanTier } from './plan-catalog.js';
import type { BillingWebhookEventType } from './payment-provider.js';

export interface SubscriptionState {
  status: subscription_status;
  planSlug: PlanTier;
  cancelledAt: Date | null;
}

export interface BillingStateMachineEvent {
  type: BillingWebhookEventType;
  occurredAt: Date;
  data: {
    planSlug?: PlanTier;
    attempt?: 1 | 2 | 3;
  };
}

export type BillingSideEffect =
  | { type: 'set_plan'; planSlug: PlanTier }
  | { type: 'restrict_to_free' }
  | {
      type: 'send_email';
      template:
        | 'payment_failed_first'
        | 'payment_failed_second'
        | 'payment_failed_final'
        | 'payment_confirmed'
        | 'downgrade_notice'
        | 'cancellation_notice';
    }
  | { type: 'audit_log'; action: string };

export interface BillingStateMachineResult {
  nextState: SubscriptionState;
  /** Coarse org-level access flag — `docs/16-billing/BILLING_ARCHITECTURE.md`'s
   * literal `org.status = 'cancelled'`. Distinct from `nextState.status`
   * (the subscription lifecycle stage) — see this file's header comment on
   * why `subscription.unpaid` changes the plan but NOT this flag. */
  orgStatus: 'active' | 'cancelled';
  sideEffects: BillingSideEffect[];
}

const FREE_PLAN: PlanTier = 'free';

/**
 * Pure — no I/O, no clock read (`event.occurredAt` is supplied by the
 * caller), same `currentState` + same `event` always produces the same
 * result. The caller (`routes/billing-webhooks.ts`) is responsible for
 * loading `currentState` from the real `subscriptions` row before calling
 * this, and applying `nextState`/`orgStatus`/`sideEffects` after.
 */
export function applyBillingWebhookEvent(
  currentState: SubscriptionState,
  event: BillingStateMachineEvent,
): BillingStateMachineResult {
  switch (event.type) {
    // "subscription.created -> Set organization plan, update entitlements."
    case 'subscription.created': {
      const planSlug = event.data.planSlug ?? currentState.planSlug;
      return {
        nextState: { status: 'active', planSlug, cancelledAt: null },
        orgStatus: 'active',
        sideEffects: [{ type: 'set_plan', planSlug }],
      };
    }

    // "subscription.updated -> Update plan, update entitlements, log."
    case 'subscription.updated': {
      const planSlug = event.data.planSlug ?? currentState.planSlug;
      return {
        nextState: { ...currentState, planSlug },
        orgStatus: 'active',
        sideEffects: [
          { type: 'set_plan', planSlug },
          { type: 'audit_log', action: 'billing.changed' },
        ],
      };
    }

    // "subscription.cancelled -> Mark as cancelled, set end-of-period date"
    // + "DATA RETENTION ON CANCELLATION": org.status = 'cancelled', access
    // immediately restricted to free tier, all data preserved.
    case 'subscription.cancelled': {
      return {
        nextState: { status: 'canceled', planSlug: FREE_PLAN, cancelledAt: event.occurredAt },
        orgStatus: 'cancelled',
        sideEffects: [
          { type: 'set_plan', planSlug: FREE_PLAN },
          { type: 'restrict_to_free' },
          { type: 'send_email', template: 'cancellation_notice' },
          { type: 'audit_log', action: 'billing.changed' },
        ],
      };
    }

    // "subscription.past_due -> Send payment failure email, start grace
    // period." Day 0 of the schedule — deliberately does NOT touch the
    // plan (epic brief's literal test requirement).
    case 'subscription.past_due': {
      return {
        nextState: { ...currentState, status: 'past_due' },
        orgStatus: 'active',
        sideEffects: [{ type: 'send_email', template: 'payment_failed_first' }],
      };
    }

    // "subscription.unpaid -> Downgrade to free tier, notify." Day 10 — the
    // only event that actually changes the plan on this path. Org stays
    // 'active' (not 'cancelled') — see header comment.
    case 'subscription.unpaid': {
      return {
        nextState: { status: 'unpaid', planSlug: FREE_PLAN, cancelledAt: null },
        orgStatus: 'active',
        sideEffects: [
          { type: 'set_plan', planSlug: FREE_PLAN },
          { type: 'restrict_to_free' },
          { type: 'send_email', template: 'downgrade_notice' },
        ],
      };
    }

    // "invoice.payment_succeeded -> Mark subscription active, send
    // receipt." Resumes billing; does not by itself restore a plan a prior
    // `subscription.unpaid` downgraded — a real plan restoration is its own
    // later `subscription.updated` event (Stripe would not retroactively
    // know which plan to restore from payment success alone either).
    case 'invoice.payment_succeeded': {
      return {
        nextState: { ...currentState, status: 'active' },
        orgStatus: 'active',
        sideEffects: [{ type: 'send_email', template: 'payment_confirmed' }],
      };
    }

    // "invoice.payment_failed -> Send failure email (3 attempts before
    // downgrade)." Days 0/3/7 — attempt 1/2/3. None of these downgrade;
    // day 10's actual downgrade is the separate `subscription.unpaid` event
    // above. Defaults to attempt 1 if the caller omits it.
    case 'invoice.payment_failed': {
      const attempt = event.data.attempt ?? 1;
      const template =
        attempt >= 3 ? 'payment_failed_final' : attempt === 2 ? 'payment_failed_second' : 'payment_failed_first';
      return {
        nextState: { ...currentState, status: 'past_due' },
        orgStatus: 'active',
        sideEffects: [{ type: 'send_email', template }],
      };
    }

    default: {
      // Exhaustiveness check — if `BillingWebhookEventType` ever grows a
      // new member without a case here, this is a compile error, not a
      // silently-ignored webhook.
      const _exhaustive: never = event.type;
      throw new Error(`Unhandled billing webhook event type: ${String(_exhaustive)}`);
    }
  }
}
