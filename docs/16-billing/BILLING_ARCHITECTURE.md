# BILLING ARCHITECTURE — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

---

## PRINCIPLES

1. Prices are NOT hard-coded. All pricing is stored in the `plans` table.
2. Feature access is controlled by `entitlements`, not hard-coded conditionals.
3. Usage limits are stored in `plans.limits` (JSONB), not hard-coded.
4. Payment provider is abstracted — switching from Stripe to Paddle requires changing one adapter.
5. Customer data is NEVER deleted on cancellation. Downgrade, don't delete.
6. Failed payments result in grace period + downgrade, not immediate lockout.

---

## PLAN TIERS

These are the INTENDED tiers. Prices are UNDECIDED. Do not implement with fixed prices.

| Tier | Target Customer | Core Value |
|---|---|---|
| **Free** | Any company | AI Visibility Snapshot — understand current state |
| **Starter** | SMBs | Ongoing monitoring — track changes over time |
| **Growth** | Growing B2B | Full SEO + GEO intelligence — understand and act |
| **Pro** | Category leaders | AI Growth Autopilot — full recommendation + draft loop |
| **Agency** | Agencies | Multi-client management + white-label |
| **Managed** | Enterprise lite | Human + AI service hybrid |
| **Enterprise** | Large organizations | Custom SLAs + dedicated support |

### Plan Limits (examples — not final)

```json
{
  "free": {
    "ai_queries_per_month": 50,
    "competitors_tracked": 2,
    "pages_analyzed": 10,
    "snapshots_per_month": 1,
    "team_members": 1,
    "integrations": [],
    "agents": false,
    "white_label": false
  },
  "starter": {
    "ai_queries_per_month": 500,
    "competitors_tracked": 5,
    "pages_analyzed": 100,
    "snapshots_per_month": 4,
    "team_members": 3,
    "agents": false,
    "white_label": false
  },
  "growth": {
    "ai_queries_per_month": 2000,
    "competitors_tracked": 10,
    "pages_analyzed": 500,
    "team_members": 5,
    "agents": true,
    "agent_runs_per_month": 10,
    "white_label": false
  },
  "pro": {
    "ai_queries_per_month": 10000,
    "competitors_tracked": 20,
    "pages_analyzed": 2000,
    "team_members": 10,
    "agents": true,
    "agent_runs_per_month": 50,
    "autonomy_level_max": 3,
    "white_label": false
  },
  "agency": {
    "client_accounts": 20,
    "ai_queries_per_month": 50000,
    "white_label": true,
    "autonomy_level_max": 3
  }
}
```

---

## PAYMENT PROVIDER ABSTRACTION

```typescript
interface PaymentProvider {
  name: string;
  
  // Subscription management
  createCustomer(email: string, name: string): Promise<ExternalCustomer>;
  createSubscription(customerId: string, planId: string): Promise<ExternalSubscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  upgradeSubscription(subscriptionId: string, newPlanId: string): Promise<ExternalSubscription>;
  
  // Invoices
  getInvoices(customerId: string): Promise<Invoice[]>;
  
  // Webhook handling
  constructWebhookEvent(payload: Buffer, signature: string): WebhookEvent;
}

class StripeProvider implements PaymentProvider { ... }
class PaddleProvider implements PaymentProvider { ... }
```

---

## BILLING EVENTS → ACTIONS

| Webhook Event | Action |
|---|---|
| `subscription.created` | Set organization plan, update entitlements |
| `subscription.updated` | Update plan, update entitlements, log |
| `subscription.cancelled` | Mark as cancelled, set end-of-period date |
| `subscription.past_due` | Send payment failure email, start grace period |
| `subscription.unpaid` | Downgrade to free tier, notify |
| `invoice.payment_succeeded` | Mark subscription active, send receipt |
| `invoice.payment_failed` | Send failure email (3 attempts before downgrade) |

---

## ENTITLEMENT ENFORCEMENT

Every API endpoint that provides paid features checks entitlements:

```typescript
// Middleware
async function requireEntitlement(feature: string) {
  const plan = await getOrgPlan(req.organizationId);
  if (!plan.features[feature]) {
    throw new PaymentRequiredError(`${feature} is not available on your current plan`);
  }
}

// Usage limits
async function checkUsageLimit(metric: string, increment: number = 1) {
  const plan = await getOrgPlan(req.organizationId);
  const used = await getUsageThisPeriod(req.organizationId, metric);
  const limit = plan.limits[metric];
  if (limit !== null && used + increment > limit) {
    throw new UsageLimitExceededError(`${metric} limit reached for this period`);
  }
  await recordUsage(req.organizationId, metric, increment);
}
```

---

## FAILED PAYMENT HANDLING

```
Day 0: Payment fails
  → Send "payment failed" email with update card link
  → Mark subscription as past_due
  
Day 3: Retry payment
  → If success: resume normally, send confirmation
  → If fail: send second email
  
Day 7: Final retry
  → If success: resume normally
  → If fail: send final warning
  
Day 10: Downgrade
  → Downgrade org to free tier
  → Send downgrade notification
  → Customer data preserved (soft delete)
  → Customer can reactivate by updating payment method
```

---

## DATA RETENTION ON CANCELLATION

Customer data is NEVER hard-deleted on cancellation.

```
Customer cancels:
  → subscription.cancelled event
  → org.status = 'cancelled'
  → org.cancellation_date set
  → Access immediately restricted to free tier features
  → All data preserved in database
  → After 90 days: data flagged for potential archival
  → After 1 year: data may be archived to cold storage
  → Customer can request data export at any time
  → Customer can request data deletion (GDPR right to erasure)
```
