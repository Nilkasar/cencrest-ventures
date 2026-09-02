import { describe, expect, it } from 'vitest';
import { applyBillingWebhookEvent, type SubscriptionState } from './webhook-state-machine.js';

const activeGrowth: SubscriptionState = { status: 'active', planSlug: 'growth', cancelledAt: null };
const NOW = new Date('2026-03-01T00:00:00.000Z');

describe('applyBillingWebhookEvent — docs/16-billing/BILLING_ARCHITECTURE.md "BILLING EVENTS → ACTIONS"', () => {
  it('subscription.created sets the plan and activates the org (row: "Set organization plan, update entitlements")', () => {
    const result = applyBillingWebhookEvent(
      { status: 'incomplete', planSlug: 'free', cancelledAt: null },
      { type: 'subscription.created', occurredAt: NOW, data: { planSlug: 'starter' } },
    );
    expect(result.nextState).toEqual({ status: 'active', planSlug: 'starter', cancelledAt: null });
    expect(result.orgStatus).toBe('active');
    expect(result.sideEffects).toContainEqual({ type: 'set_plan', planSlug: 'starter' });
  });

  it('subscription.updated changes the plan and logs (row: "Update plan, update entitlements, log")', () => {
    const result = applyBillingWebhookEvent(activeGrowth, {
      type: 'subscription.updated',
      occurredAt: NOW,
      data: { planSlug: 'pro' },
    });
    expect(result.nextState.planSlug).toBe('pro');
    expect(result.orgStatus).toBe('active');
    expect(result.sideEffects).toContainEqual({ type: 'set_plan', planSlug: 'pro' });
    expect(result.sideEffects).toContainEqual({ type: 'audit_log', action: 'billing.changed' });
  });

  it('subscription.updated with no planSlug in the payload keeps the current plan (defensive default)', () => {
    const result = applyBillingWebhookEvent(activeGrowth, {
      type: 'subscription.updated',
      occurredAt: NOW,
      data: {},
    });
    expect(result.nextState.planSlug).toBe('growth');
  });

  it(
    'subscription.cancelled marks the subscription canceled, restricts the org to free, and preserves the ' +
      'cancellation timestamp (BILLING_ARCHITECTURE.md "DATA RETENTION ON CANCELLATION": org.status = ' +
      "'cancelled', access immediately restricted to free tier)",
    () => {
      const result = applyBillingWebhookEvent(activeGrowth, {
        type: 'subscription.cancelled',
        occurredAt: NOW,
        data: {},
      });
      expect(result.nextState).toEqual({ status: 'canceled', planSlug: 'free', cancelledAt: NOW });
      expect(result.orgStatus).toBe('cancelled');
      expect(result.sideEffects).toContainEqual({ type: 'set_plan', planSlug: 'free' });
      expect(result.sideEffects).toContainEqual({ type: 'restrict_to_free' });
      expect(result.sideEffects).toContainEqual({ type: 'send_email', template: 'cancellation_notice' });
    },
  );

  it('subscription.cancelled never produces a delete-shaped side effect (non-negotiable: never hard-delete)', () => {
    const result = applyBillingWebhookEvent(activeGrowth, {
      type: 'subscription.cancelled',
      occurredAt: NOW,
      data: {},
    });
    for (const effect of result.sideEffects) {
      expect(effect.type).not.toMatch(/delete/i);
    }
  });

  it(
    'subscription.past_due (day 0 of the grace schedule) sends the first email and does NOT touch the plan — ' +
      'the epic\'s literal "does not downgrade immediately" requirement',
    () => {
      const result = applyBillingWebhookEvent(activeGrowth, {
        type: 'subscription.past_due',
        occurredAt: NOW,
        data: {},
      });
      expect(result.nextState).toEqual({ status: 'past_due', planSlug: 'growth', cancelledAt: null });
      expect(result.orgStatus).toBe('active');
      expect(result.sideEffects).toEqual([{ type: 'send_email', template: 'payment_failed_first' }]);
    },
  );

  it.each([
    [1 as const, 'payment_failed_first'],
    [2 as const, 'payment_failed_second'],
    [3 as const, 'payment_failed_final'],
  ])(
    'invoice.payment_failed attempt %d (day 0/3/7) sends the %s email, stays past_due, never changes the plan',
    (attempt, template) => {
      const fromPastDue: SubscriptionState = { status: 'past_due', planSlug: 'growth', cancelledAt: null };
      const result = applyBillingWebhookEvent(fromPastDue, {
        type: 'invoice.payment_failed',
        occurredAt: NOW,
        data: { attempt },
      });
      expect(result.nextState.status).toBe('past_due');
      expect(result.nextState.planSlug).toBe('growth');
      expect(result.orgStatus).toBe('active');
      expect(result.sideEffects).toEqual([{ type: 'send_email', template }]);
    },
  );

  it('invoice.payment_failed defaults to attempt 1 when the webhook payload omits it', () => {
    const result = applyBillingWebhookEvent(activeGrowth, {
      type: 'invoice.payment_failed',
      occurredAt: NOW,
      data: {},
    });
    expect(result.sideEffects).toEqual([{ type: 'send_email', template: 'payment_failed_first' }]);
  });

  it(
    'subscription.unpaid (day 10 equivalent) downgrades to free WITHOUT cancelling the org — ' +
      'BILLING_ARCHITECTURE.md: "Downgrade org to free tier... Customer can reactivate by updating payment method"',
    () => {
      const fromPastDue: SubscriptionState = { status: 'past_due', planSlug: 'growth', cancelledAt: null };
      const result = applyBillingWebhookEvent(fromPastDue, {
        type: 'subscription.unpaid',
        occurredAt: NOW,
        data: {},
      });
      expect(result.nextState.planSlug).toBe('free');
      expect(result.nextState.status).toBe('unpaid');
      // The load-bearing distinction from subscription.cancelled: the ORG
      // itself is not marked cancelled by a downgrade.
      expect(result.orgStatus).toBe('active');
      expect(result.sideEffects).toContainEqual({ type: 'set_plan', planSlug: 'free' });
      expect(result.sideEffects).toContainEqual({ type: 'restrict_to_free' });
      expect(result.sideEffects).toContainEqual({ type: 'send_email', template: 'downgrade_notice' });
    },
  );

  it('subscription.unpaid never produces a delete-shaped side effect', () => {
    const result = applyBillingWebhookEvent(activeGrowth, {
      type: 'subscription.unpaid',
      occurredAt: NOW,
      data: {},
    });
    for (const effect of result.sideEffects) {
      expect(effect.type).not.toMatch(/delete/i);
    }
  });

  it('invoice.payment_succeeded resumes active status and sends a receipt, without changing the plan tier', () => {
    const fromPastDue: SubscriptionState = { status: 'past_due', planSlug: 'growth', cancelledAt: null };
    const result = applyBillingWebhookEvent(fromPastDue, {
      type: 'invoice.payment_succeeded',
      occurredAt: NOW,
      data: {},
    });
    expect(result.nextState.status).toBe('active');
    expect(result.nextState.planSlug).toBe('growth');
    expect(result.orgStatus).toBe('active');
    expect(result.sideEffects).toEqual([{ type: 'send_email', template: 'payment_confirmed' }]);
  });

  it('is a pure function: calling it twice with identical inputs produces deep-equal results', () => {
    const event = { type: 'subscription.updated' as const, occurredAt: NOW, data: { planSlug: 'pro' as const } };
    const a = applyBillingWebhookEvent(activeGrowth, event);
    const b = applyBillingWebhookEvent(activeGrowth, event);
    expect(a).toEqual(b);
  });
});
