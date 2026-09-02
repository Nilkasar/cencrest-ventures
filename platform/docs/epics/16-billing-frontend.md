# Epic 16 — Billing (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`), plus one small additive
backend endpoint in `platform/apps/api` (`@bebest/api`) that the epic's own
UI-surface requirement needed and the backend build hadn't exposed yet (see
"The one backend gap" below). Branch `rebuild/platform`. Nothing under
`api/`, `web-app/`, the repo-root marketing site, or `packages/database`
was touched. No git commands were run at any point (per this task's hard
constraint). No database connection was made, no real network call to any
payment provider or AI provider was made anywhere in this build.

## What was built

Settings > Billing (`/settings?tab=billing`) now wires directly into the
real Epic 16 routes — no fixture layer as source of truth, per the epic's
standing rule.

**`platform/apps/web/src/data/billing/`** — the data-access seam, same
shape as `data/ai-visibility/client.ts`/`data/query-universe/client.ts`:

- `types.ts` — wire shapes matching `apps/api/src/lib/billing/plan-catalog.ts`'s
  `PlanTier`/`PlanLimits` and `subscription-store.ts`'s
  `serializeSubscription` exactly (checked against the actual route code,
  not just the backend completion doc's prose example). `UsageMetricKey`
  mirrors the backend's `NumericPlanLimitKey` (the 9 numeric limits,
  `agents`/`white_label` excluded as booleans a usage bar can't apply to).
- `client.ts` — `listPlans()` (`GET /plans`), `getSubscription()`
  (`GET /orgs/me/subscription`), `listInvoices()`
  (`GET /orgs/me/subscription/invoices`), `changePlan(current, target)`
  (picks `/upgrade` or `/downgrade` by comparing tier index — never guesses
  wrong, so the request always hits the endpoint that will accept it), and
  `cancelSubscription()` (`POST .../cancel`). Two typed errors —
  `BillingForbiddenError` (403, non-owner) and `InvalidPlanTransitionError`
  (422 `not_an_upgrade`/`not_a_downgrade`, carries the backend's own
  message) — translated the same way `ai-visibility/client.ts`'s
  `AiQueryLimitError` translates its 402.

**`platform/apps/web/src/components/settings/`**:

- `usage-meter.tsx` — the "usage bars for every metered limit" the epic
  spec calls for, reusing the same register `competitors-view.tsx` (Epic 2)
  established for "at your limit" ("N of LIMIT tracked... LIMIT - N
  remaining"): a labeled bar that turns `warning` at ≥80% and `danger` at
  the limit, with an honest "Not tracked" state (no bar) for the five
  metrics `GET /subscription` reports `used: null` for — never a fabricated
  0%.
- `billing-panel.tsx` — current plan card (name, description, status badge,
  current-period date, cancel button), a usage grid split into the four
  really-counted metrics and the five limit-only ones, a plan grid (all 7
  tiers from `GET /plans`, current tier badged, upgrade/downgrade buttons
  determined by tier order), and an invoice history table. Mutating actions
  (`changePlan`/`cancelSubscription`) are disabled client-side for a
  non-owner (`currentUser.role !== "owner"`, the same fixture-backed role
  the Team tab already reads — Epic 0's session/auth wiring into the
  frontend hasn't landed yet, so this is a UI-level mirror of the real,
  authoritative server-side 403, not a replacement for it) with a visible
  note explaining why; the backend's own 403 is still what actually
  enforces it.

**`platform/apps/web/src/app/(app)/settings/page.tsx`** — the Billing
`TabsContent` now renders `<BillingPanel />` instead of `<ComingSoon
epic={16} .../>`. No new route was created (Epic 0's tab scaffolding
already existed, per this epic's instructions).

## The one backend gap, and the minimal fix

The epic spec's "UI surface" section explicitly calls for "invoice history
(from the `NullPaymentProvider`'s fake data until real Stripe is wired)."
Checking the actual backend code (not just the backend completion doc's
prose) turned up that `NullPaymentProvider.getInvoices` was implemented and
unit-tested (`payment-provider.test.ts`) but **no route ever called it** —
`routes/subscription.ts` had no `/invoices` endpoint at all, so there was
no way for a frontend to show invoice history without either fabricating
it client-side (a fixture layer, against this epic's standing rule) or
adding the one missing, purely additive route.

Added `GET /api/orgs/me/subscription/invoices` to
`apps/api/src/routes/subscription.ts`: same read-only permission level as
the existing `GET /` (`viewer`+, not owner-only — viewing history isn't a
mutation), resolves the org's subscription via the existing
`getOrCreateSubscription`, and returns `{ invoices: [] }` for an org that
never went through upgrade/downgrade (no `external_customer_id` yet — the
same state a real Stripe customer that was never created would be in)
rather than calling `getInvoices` with a fake id. No schema change, no new
migration, no `.delete()` call, no real network call — it calls the exact
same `getPaymentProvider()`/`NullPaymentProvider` singleton every other
billing route already uses. Added 3 tests to `subscription.test.ts`
(empty-list case, populated case, "any member can view" case). Full
`@bebest/api` suite rerun after the change: **482/482 passing** (479 from
the backend completion doc + the 3 new ones), 0 regressions —
`entitlements.test.ts` (28/28), `competitors.test.ts` (10/10),
`query-sets.test.ts` (21/21), `ai-runs.test.ts` (8/8) all still green.

## Verification

Ran at the monorepo root (`turbo run typecheck lint test build`, all 15
package tasks): **all green**. `@bebest/web`'s own `next build` compiles
and typechecks the new Billing panel and prerenders `/settings` as static
content, same as every other settings tab. `@bebest/api`'s full suite:
482/482 passed, 0 failed, 54 intentionally-`.skip` "NEEDS LIVE DB"
tenant-isolation todos (unrelated, pre-existing).

## End-to-end flow, traced from the frontend

1. `BillingPanel` loads `getSubscription()` + `listPlans()` +
   `listInvoices()` in parallel on mount (`useAsyncData`, the same
   loading/error/success pattern every other real-data screen in this app
   uses) — no fixture data anywhere in the path.
2. Usage bars render straight from `GET /subscription`'s real `usage`
   object — an org at its `competitors_tracked` limit shows a `danger`-red
   full bar and the same "you're at this plan's limit" language the epic's
   UI-surface note asks for, sourced from the real
   `subscriptions.plan_id -> plans.limits` join server-side (Epic 16
   backend's literal point), not a hardcoded map on the frontend.
3. Clicking "Upgrade to Growth" as the owner calls `changePlan('free',
   'growth')` -> `POST /orgs/me/subscription/upgrade` -> on success,
   `reload()` refetches `GET /subscription`, and the usage bars/plan grid
   immediately reflect the new tier (no caching layer on either side).
4. The same click as a non-owner: the button is disabled client-side (with
   the explanatory note above the plan grid) — and if that check were ever
   bypassed, the backend's real `requirePermission('manage_billing')` 403
   is caught by `BillingForbiddenError` and shown inline via `ErrorPanel`.
5. Choosing a lower tier calls `/downgrade` instead of `/upgrade`
   automatically (`changePlan`'s tier-index comparison) — never a manual
   choice the user could get backwards.
6. "Cancel subscription" — a `window.confirm` (same pattern
   `query-universe-view.tsx`'s archive action uses) naming exactly what
   happens ("move to Free immediately... nothing is deleted") before
   calling `POST .../cancel`; on success the plan card's status badge flips
   to "Canceled" and the cancelled-on date appears, sourced from the real
   response, not inferred client-side.
7. Invoice history renders `GET /invoices`' real (fake-data-backed,
   `NullPaymentProvider`) rows in a table, or an honest "No invoices yet"
   empty state for an org that never upgraded — never a fabricated invoice.

## What's not done (by design, matches the backend's own scope boundary)

- No real Stripe checkout/payment-method UI — the epic's own stated scope
  boundary is `NullPaymentProvider` only; there is nothing for a frontend
  to collect a card into yet.
- No cron-driven grace-period countdown shown in the UI (e.g. "day 3 of
  10") — the backend has no scheduled trigger for the failed-payment
  schedule yet (deferred to whichever later epic wires real background
  scheduling, per the backend completion doc), so there is no real date to
  render; the plan card's status badge (`past_due`/`unpaid`) is the honest
  signal available today.
- Epic 0's real session/auth wiring into the frontend hasn't landed, so
  `currentUser.role` (used only for the client-side owner gate, never for
  authorization) is still the Epic 0 fixture, same as the pre-existing Team
  tab — once real auth lands, both call sites pick up the real role for
  free.

## Files touched

- `platform/apps/web/src/data/billing/types.ts` (new)
- `platform/apps/web/src/data/billing/client.ts` (new)
- `platform/apps/web/src/components/settings/usage-meter.tsx` (new)
- `platform/apps/web/src/components/settings/billing-panel.tsx` (new)
- `platform/apps/web/src/app/(app)/settings/page.tsx` (edited — Billing tab
  now renders `BillingPanel`)
- `platform/apps/api/src/routes/subscription.ts` (edited — added
  `GET /invoices`)
- `platform/apps/api/src/routes/subscription.test.ts` (edited — added 3
  tests for the new route)
- `platform/docs/epics/16-billing-frontend.md` (this file)
