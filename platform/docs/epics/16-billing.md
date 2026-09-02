# Epic 16 — Billing (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends only on Epic 0 (orgs/RBAC) — independent of the SEO/GEO pipeline, buildable any time; scheduled now to keep a second build track fed in parallel with Epic 8.

## Why this epic

Every entitlement check built so far (Epic 2's competitor limit, Epic 5's query cap, Epic 7's AI-query cap) reads from `PLAN_LIMITS`/`checkUsageLimit` — a hardcoded map in `src/lib/entitlements.ts`, not the actual `plans`/`subscriptions`/`entitlements` tables `docs/06-database/SCHEMA.md` defines. This epic makes plans and entitlements **real, org-specific, and stored data**, per ADR/billing principle #1-3 in `docs/16-billing/BILLING_ARCHITECTURE.md`: "Prices are NOT hard-coded. Feature access is controlled by entitlements, not hard-coded conditionals. Usage limits are stored in plans.limits (JSONB), not hard-coded."

**Important scope boundary**: this epic does NOT wire a real Stripe integration — no live payment calls, per this build's own constraints (no real external network calls). It builds the `PaymentProvider` abstraction (`docs/16-billing/BILLING_ARCHITECTURE.md`'s interface) with a `NullPaymentProvider`/mock implementation, the full plans/subscriptions/entitlements data model, and the webhook-event-to-action state machine — all real and tested against fakes, with the actual Stripe adapter as a clearly-marked future integration point (same pattern as Epic 4's `NullSEODataProvider`).

## Domain model (`docs/06-database/SCHEMA.md` §6, already ported in Epic 0)

- `plans` — name/slug, `price_monthly`/`price_yearly` (nullable — null means custom/contact), `limits` (JSONB), `features` (JSONB), `active`.
- `subscriptions` — org's active plan, `external_id` (Stripe subscription ID, null until real Stripe is wired), `status`, period dates, `trial_ends_at`, `cancelled_at`.
- `usage_records` — metered usage per period (`ai_queries`, `pages_analyzed`, `snapshots`, etc.).

## Migrating existing entitlement checks onto real data

Every existing hardcoded `PLAN_LIMITS` entry (from Epics 2, 5, 7) becomes a seeded `plans.limits` row instead. `src/lib/entitlements.ts`'s `checkUsageLimit`/`resolvePlanLimits` functions keep their exact same call signature (so Epics 2/5/7's route code doesn't change) but now read `plans.limits` for the org's actual `subscriptions.plan_id` instead of a hardcoded map keyed by a plan-name string. This is a refactor of the *source* of the limits, not the enforcement mechanism — do not change how any existing route calls these functions.

Seed data must include the full 7-tier list from `docs/16-billing/BILLING_ARCHITECTURE.md` (free/starter/growth/pro/agency/managed/enterprise) with every `limits` key already established by prior epics (`competitors_tracked`, `ai_queries_per_month`, `queries_per_query_set`) plus the documented-but-not-yet-enforced ones (`pages_analyzed`, `snapshots_per_month`, `team_members`, `agents`, `agent_runs_per_month`, `autonomy_level_max`, `white_label`, `client_accounts`) so later epics (12+) have real data to gate against instead of inventing their own map.

## `PaymentProvider` abstraction (`docs/16-billing/BILLING_ARCHITECTURE.md`, implement the exact interface)

```typescript
interface PaymentProvider {
  createCustomer(email, name): Promise<ExternalCustomer>;
  createSubscription(customerId, planId): Promise<ExternalSubscription>;
  cancelSubscription(subscriptionId): Promise<void>;
  upgradeSubscription(subscriptionId, newPlanId): Promise<ExternalSubscription>;
  getInvoices(customerId): Promise<Invoice[]>;
  constructWebhookEvent(payload, signature): WebhookEvent;
}
```
Ship a `NullPaymentProvider` that behaves deterministically (generates fake external IDs, no network) so upgrade/downgrade/cancel flows are fully testable now. `constructWebhookEvent`'s signature-verification path should still be implemented for real (HMAC check against a configured secret) even though nothing calls it with real Stripe payloads yet — this is a security-relevant code path (`docs/08-security/SECURITY.md`: "webhook signatures verified before processing") worth building correctly from day one, tested against both a valid and a tampered fake signature.

## Billing event state machine (`docs/16-billing/BILLING_ARCHITECTURE.md`, implement exactly)

`subscription.created/updated/cancelled/past_due/unpaid`, `invoice.payment_succeeded/payment_failed` → the documented actions (set plan + entitlements, grace period, downgrade-not-delete). Build this as a pure function of `(currentState, event) -> nextState + sideEffects` so it's unit-testable against every documented transition without a real webhook ever arriving. The failed-payment day-0/3/7/10 grace period schedule is a real, testable state machine — build the transition logic now even though the actual scheduled trigger (a cron/job) is deferred to whichever later epic wires real background scheduling.

## Non-negotiable: never hard-delete on cancellation

`org.status = 'cancelled'` + access restricted to free-tier features; all data preserved (`docs/16-billing/BILLING_ARCHITECTURE.md`: "Customer data is NEVER hard-deleted on cancellation"). Enforce this as a code-level invariant (the cancellation path literally has no delete call) not just a documented intention.

## API surface

- `GET /plans` — public, lists active plans (for a pricing/upgrade UI).
- `GET /orgs/me/subscription` — current plan + status + usage-vs-limit for every metered resource.
- `POST /orgs/me/subscription/upgrade` (and downgrade/cancel) — owner-only (per `docs/08-security/SECURITY.md`'s "Manage billing: owner only"), audit-logged, goes through `PaymentProvider`.
- `POST /webhooks/billing` — signature-verified, routes to the state machine, idempotent (a replayed webhook must not double-apply an effect — dedupe by event ID).

## UI surface

Settings > Billing tab (already stubbed as a placeholder tab per Epic 0's frontend completion doc — read it first, wire real content into the existing tab rather than creating a new route). Shows current plan, usage bars for every metered limit (reusing whatever entitlement-limit-reached error UI pattern Epic 2/5 already established for a consistent "you're at your limit" experience), upgrade/downgrade actions, invoice history (from the `NullPaymentProvider`'s fake data until real Stripe is wired).

## End-to-end flow (qa-flow-tester must trace every step below, not just each table in isolation)

1. Seed the 7 plans — confirm `GET /plans` returns them with the exact `limits`/`features` shapes Epics 2/5/7 already expect (cross-check field names against those epics' existing `PLAN_LIMITS` usage — a mismatch here silently breaks three previously-VERIFIED epics).
2. An org on `free` hits Epic 2's competitor limit — confirm the rejection now reads the limit from the real seeded `plans.limits` row via the org's actual `subscriptions` row, not a hardcoded map — this is the literal point of the refactor; if `checkUsageLimit` still reads a hardcoded value even though `subscriptions`/`plans` tables now exist, the epic has failed at its one job.
3. `POST /orgs/me/subscription/upgrade` from free→growth (owner role) — confirm it calls `PaymentProvider.createSubscription` (fake), writes a real `subscriptions` row, and that Epic 2's competitor limit check immediately reflects the new tier on the next request (no caching staleness).
4. A non-owner (admin/analyst/editor/viewer) attempts the same upgrade — confirm 403.
5. Simulate a `subscription.past_due` webhook event (constructed with a valid fake signature) → confirm the state machine transitions correctly and does NOT downgrade immediately (day-0 grace period per the documented schedule); simulate the day-10 equivalent and confirm downgrade-to-free with data preserved (no row deleted anywhere in the org's data).
6. Simulate a tampered/invalid webhook signature — confirm it's rejected before any state change, and logged as a security-relevant event.
7. Cancel a subscription — confirm `org.status` changes, data is provably still queryable (read at least one row from an unrelated table, e.g. the org's `brands` row, immediately after cancellation), and no delete call exists anywhere in the cancellation code path.
8. Tenant isolation check across `subscriptions`/`usage_records` (`plans` is global reference data, not tenant-scoped).

## Definition of done

Standard DoD. A regression test proving Epics 2/5/7's existing entitlement call sites still pass with the new plans-table-backed implementation (do not just add new tests — rerun and confirm the old ones still hold, since this epic changes what they read from).
