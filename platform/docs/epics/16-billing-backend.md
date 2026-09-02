# Epic 16 — Billing (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root marketing
site was modified. **Frontend is not built** — a separate agent wires the
Settings > Billing tab against the real routes documented below.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run (schema-only, `DATABASE_URL` set to a dummy value
so the CLI has something to parse — no connection attempted). No `migrate`,
`db push`, or `db pull` was run, per the hard constraint.

**No real network call to any payment provider was made anywhere in this
build**, including in tests — `NullPaymentProvider` is the only
implementation, makes zero network calls, and generates deterministic fake
external ids (a pure hash of its inputs, never `Math.random`/`Date.now`).

**This build ran concurrently with another agent's Epic 8 (Competitive
Intelligence) work in the same repo.** Both landed schema additions and
`app.ts`/`client.ts`/`index.ts`/`entitlements.ts`/`rbac.ts` edits in
overlapping windows. Every shared file was re-read immediately before each
edit here and both sets of changes merged cleanly — verified by re-running
`prisma validate`/`generate`, `tsc --noEmit`, `eslint`, and the full test
suite for `@bebest/database` and `@bebest/api` (via `turbo run
typecheck|lint|test` at the monorepo root) after the fact, not assumed. No
migration-folder-numbering collision: Epic 8 needed no new RLS/checks
migration folder of its own (its additions were nullable columns on
existing tables), so this epic's migration is the first `0009_*`,
`0009_billing`.

---

## The core tension this epic hit, and how it was resolved (read this first)

The epic brief requires two things that are, on the surface, in conflict:

1. `resolvePlanLimits`/`checkUsageLimit` in `lib/entitlements.ts` must now
   read from the REAL `plans`/`subscriptions` tables, not a hardcoded map.
2. Epics 2/5/7's existing `lib/entitlements.test.ts` — **28 tests, kept
   completely unmodified** — must still pass. That file mocks
   `@bebest/database` down to exactly `{ withOrgContext }`, with
   `tx.subscriptions.findUnique` stubbed to resolve a bare `{ plan: 'free' }`
   object that predates `plan_id`/the `plans` relation existing at all.

**Resolution:** `resolvePlanLimits` now queries `tx.subscriptions.findUnique(
{ ..., include: { plans: true } })`. In production (or against any test that
mocks the joined shape), `subscription.plans` is the real row and its
`limits` JSONB is what gets returned — **this is the primary, and only
intended, path**. Only when no joined `plans` row is present (which, in
practice, means exactly one thing: a mock stub written before this epic
existed) does the code fall back to `PLAN_CATALOG[subscription.plan]` — the
identical data `apps/api/src/scripts/seed-plans.ts` inserts into the real
`plans` table, not a second, independently-drifting hardcoded map. Every
number in `PLAN_CATALOG` for the three regression-critical keys
(`competitors_tracked`/`queries_per_query_set`/`ai_queries_per_month`)
matches the old `PLAN_LIMITS` map exactly, which is why the frozen test file
passes unmodified: it is testing the fallback path, and the fallback path
was built to be indistinguishable, value-for-value, from a freshly-seeded
database. See `lib/entitlements.ts`'s own header comment for the full
reasoning, and `lib/billing/plan-catalog.ts`'s header for why that catalog
lives in `apps/api`, not `@bebest/database` (short version: the catalog is
one of the two things `entitlements.ts` needs at module load that the
frozen mock doesn't provide — importing it from the mocked package would
break all 28 tests immediately).

`checkUsageLimit`'s `metric` parameter type narrowed from `keyof PlanLimits`
to `NumericPlanLimitKey` (`PlanLimits` minus `agents`/`white_label`, which
are booleans a numeric-limit check can't apply to). Every existing call site
(`competitors.ts`, `query-sets.ts`, `ai-runs.ts`) passes a literal string
that is still a valid `NumericPlanLimitKey`, so nothing there changed.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

Schema changes (`prisma/schema.prisma`, migration
`prisma/migrations/0009_billing/`):

- **`plans` (new table)** — `slug`/`name`/`description`, `price_monthly`/
  `price_yearly` (`Int?`, cents, matching `docs/06-database/SCHEMA.md` §6's
  literal DDL types) — **always `NULL` for all seven seeded rows**, not just
  the two "custom" tiers: `docs/16-billing/BILLING_ARCHITECTURE.md` says
  outright "Prices are UNDECIDED. Do not implement with fixed prices," a
  literal instruction, not a gap. `limits`/`features` (JSONB), `active`.
  Global reference data, no `organization_id`, no RLS (same treatment as
  `ai_providers`/`ai_models` — see `0009_billing/rls.sql`'s header for the
  full reasoning).
- **`subscriptions` (existing table, extended)** — added `plan_id` (NOT
  NULL FK -> `plans.id`, `Restrict`), `external_customer_id` (renamed from
  `stripe_customer_id`, provider-agnostic), `external_id` (renamed from
  `stripe_subscription_id`, matches SCHEMA.md's literal field name),
  `trial_ends_at`, `cancelled_at`. **Kept** the pre-existing `plan` VARCHAR
  column (still CHECK-constrained by `chk_subscriptions_plan`, unchanged) as
  a denormalized cache of `plans.slug`, synced on every write by
  `lib/billing/subscription-store.ts`'s `setSubscriptionPlan` — the one
  function that ever changes it — specifically so it can never drift from
  `plan_id`. This is the one deliberate deviation from SCHEMA.md's literal
  DDL; see the schema's own doc comment on the column for the full
  reasoning (short version: it's what keeps the frozen regression suite's
  mock shape working).
- **`billing_webhook_events` (new table)** — `external_event_id` (unique,
  the idempotency key), `event_type`, nullable `organization_id` (resolved
  only after the payload is parsed), `payload` (JSONB, the raw event),
  `processed_at`. No RLS — same "no tenant context exists yet" reasoning
  DECISIONS.md §7b already documents for `invitations`.
- **`organizations.status`** (new column, `VARCHAR(20)` + CHECK
  `active|cancelled`) — the ported schema (Epic 0) had no status concept on
  organizations at all; `docs/16-billing/BILLING_ARCHITECTURE.md`'s "DATA
  RETENTION ON CANCELLATION" section requires `org.status = 'cancelled'`
  literally. Deliberately does **not** add a parallel `cancellation_date`
  column the doc also mentions — the org's own `subscriptions.cancelled_at`
  already carries that exact timestamp (1:1 relationship), and a second
  column holding the same value could only ever drift from it.
- **`subscription_status` enum** gains `unpaid` — BILLING_ARCHITECTURE.md
  documents `subscription.unpaid` (day-10 downgrade) as distinct from
  `subscription.cancelled`: "Customer can reactivate by updating payment
  method" describes a still-subscribed (now free) org, not a cancelled one.
  Reusing `past_due` for this would collide two documented, differently-
  handled states into one value.

`prisma/migrations/0009_billing/checks.sql` — `chk_plans_slug` (the seven
tiers), `chk_organizations_status`. `rls.sql` — deliberately contains no
`CREATE POLICY` statements; its header documents exactly why (`plans`/
`billing_webhook_events` are the two tables that don't get one, and why
`subscriptions`/`usage_records` don't need new policies for the column
additions above).

Two new exported types from `client.ts`/`index.ts`: `plans`, `subscriptions`
(this one was never exported before this epic, despite the model existing
since Epic 0), `usage_records`, `usage_metric`, `billing_webhook_events`.

### `platform/apps/api` (`@bebest/api`)

**`lib/billing/plan-catalog.ts`** — the 7-tier catalog
(free/starter/growth/pro/agency/managed/enterprise), transcribed verbatim
from `docs/16-billing/BILLING_ARCHITECTURE.md`'s "PLAN TIERS" table and
"Plan Limits" JSON example. Every documented-but-not-yet-enforced key the
epic brief calls out is present: `pages_analyzed`, `snapshots_per_month`,
`team_members`, `agent_runs_per_month`, `autonomy_level_max`,
`client_accounts`, plus the two boolean feature flags `agents`/
`white_label`. Every gap in the source doc's own JSON example (most tiers
don't list every key) is filled with `null` (unlimited) using the exact same
"documented placeholder, not a real product claim" precedent
`entitlements.ts` already established for `agency`/`managed`/`enterprise`'s
undocumented numbers — each one has an inline comment explaining which case
it is.

**`lib/billing/payment-provider.ts`** — the `PaymentProvider` interface
(`createCustomer`/`createSubscription`/`cancelSubscription`/
`upgradeSubscription`/`getInvoices`/`constructWebhookEvent`), transcribed
verbatim from BILLING_ARCHITECTURE.md, plus `NullPaymentProvider`. Signature
verification is real: HMAC-SHA256 (`node:crypto`) against
`BILLING_WEBHOOK_SECRET`, `timingSafeEqual` for the comparison, length-
checked first so a wrong-length tampered signature fails the same way as a
right-length one. Throws `WebhookSecretNotConfiguredError` (fail-closed,
same pattern as `lib/jwt.ts`'s missing-keypair error) if the secret isn't
configured, and `InvalidWebhookSignatureError` on any mismatch — checked
BEFORE `JSON.parse` ever runs on the payload. 15 unit tests, including both
a validly-signed and multiple tampered-signature cases (wrong signature,
wrong secret, garbage/wrong-length signature, empty signature, and a
non-JSON payload that must still fail as a signature error, not a parse
error, proving the ordering).

**`lib/billing/webhook-state-machine.ts`** — `applyBillingWebhookEvent
(currentState, event) -> { nextState, orgStatus, sideEffects }`, a pure
function (no I/O, no internal clock read) implementing
BILLING_ARCHITECTURE.md's "BILLING EVENTS → ACTIONS" table exactly. The
day-0/3/7/10 grace-period schedule maps to events, not to elapsed time (the
actual cron is deferred, per the brief): day 0 = `subscription.past_due`,
days 3/7 = `invoice.payment_failed` with `attempt: 2`/`3`, day 10 =
`subscription.unpaid` — the only event that changes the plan on that path.
`subscription.cancelled` is the only event that sets `orgStatus: 'cancelled'`
— `subscription.unpaid` downgrades to free but leaves the org `'active'`
(a real, load-bearing distinction: "customer can reactivate," per the doc).
14 unit tests, one per documented transition plus two explicit "no
delete-shaped side effect exists" assertions and a purity check.

**`lib/billing/subscription-store.ts`** — the only module that ever calls
`.create()`/`.update()` on a `subscriptions` row or reads `plans`.
`getOrCreateSubscription` bootstraps a free-tier row for an org that never
had one (org creation itself, `routes/orgs.ts`, is unchanged — the epic
brief's "keep existing route code unchanged" rule). `setSubscriptionPlan`
keeps `plan_id` and the denormalized `plan` string in sync by construction.
Contains **zero `.delete()` calls**, checked by inspection and by the route
tests below (mocked `db` objects have no `delete` method defined at all —
an accidental delete call would throw, not silently pass).

**`routes/plans.ts`** — `GET /api/plans`, public, no auth. Response: an
array of `{ slug, name, description, priceMonthlyCents, priceYearlyCents,
limits, features }`, sorted free→enterprise. Falls back to `PLAN_CATALOG`
(same values a seed would insert) if the `plans` table is empty.

**`routes/subscription.ts`**, mounted at `/api/orgs/me/subscription`:

- `GET /` — any member (`viewer`+). Response:
  ```json
  {
    "plan": { "slug": "growth", "name": "Growth", "description": "...", "priceMonthlyCents": null, "priceYearlyCents": null, "limits": { "...": "..." }, "features": {} },
    "subscription": { "status": "active", "currentPeriodStart": "...", "currentPeriodEnd": "...", "trialEndsAt": null, "cancelledAt": null },
    "usage": {
      "competitors_tracked": { "used": 3, "limit": 10 },
      "queries_per_query_set": { "used": 120, "limit": 500 },
      "ai_queries_per_month": { "used": 40, "limit": 2000 },
      "team_members": { "used": 4, "limit": 5 },
      "pages_analyzed": { "used": null, "limit": 500 },
      "snapshots_per_month": { "used": null, "limit": null },
      "agent_runs_per_month": { "used": null, "limit": 10 },
      "autonomy_level_max": { "used": null, "limit": null },
      "client_accounts": { "used": null, "limit": null }
    }
  }
  ```
  The first four `usage` metrics are REAL counts (reusing Epic 2/5/7's exact
  counting logic — `competitors.count`, the active `query_sets.query_count`,
  `countAiQueriesThisMonth`, plus a new but trivial `memberships.count` for
  `team_members`). The remaining five report `used: null` — honestly "not
  tracked yet," never a fabricated zero, because no agent/snapshot/autonomy
  feature exists yet to count against.
- `POST /upgrade`, `POST /downgrade` — owner-only
  (`requirePermission('manage_billing')`, the exact pre-existing
  `PERMISSION_MATRIX` entry from Epic 0, reused, not duplicated), audit-
  logged (`billing.changed`). Body `{ "planSlug": "growth" }`. Each rejects
  (422) if the target isn't actually higher/lower than the current tier.
  Calls `PaymentProvider.createCustomer`/`createSubscription`/
  `upgradeSubscription` as appropriate, then persists via
  `setSubscriptionPlan`. A non-owner gets 403 (epic end-to-end flow step 4).
- `POST /cancel` — owner-only, audit-logged. Calls
  `PaymentProvider.cancelSubscription` (if an external subscription exists),
  downgrades the `subscriptions` row to the `free` plan (`status:
  'canceled'`, `cancelled_at` set), and sets `organizations.status =
  'cancelled'`. **No `.delete()` call anywhere in this handler** — verified
  by a test whose mocked `db` has no `delete` method on `organizations`/
  `subscriptions` at all.

**`routes/billing-webhooks.ts`**, mounted at `/api/webhooks/billing` — `POST
/`, no `requireAuth` (the signature check IS the authentication, per the
epic spec). Reads the raw body + `x-billing-signature` header, calls
`PaymentProvider.constructWebhookEvent`. On failure: audit-logged as
`billing.webhook_rejected` (`result: 'failure'`, new entry added to
`lib/audit.ts`'s `ALWAYS_AUDITED_ACTIONS`) and rejected with 400, **before
any state change**. On success: dedupes by `external_event_id` against
`billing_webhook_events` (a second delivery of an already-`processed_at`
event returns `{ received: true, duplicate: true }` without touching
`subscriptions`/`organizations` again); resolves the org via
`findSubscriptionByExternalCustomerId` (plain `db`, no tenant context yet —
same reasoning as `invitations`); runs the state machine; persists
`nextState` via `setSubscriptionPlan` and `orgStatus` via
`organizations.update` (both plain `.update()`, never `.delete()`); applies
`send_email` (dev-mode `console.log`, same substitute `routes/orgs.ts`'s
invitation flow already uses) and `audit_log` side effects; marks the event
row `processed_at`. Response: `{ "received": true }` (or `{ "received":
true, "duplicate": true }` / `{ "received": true, "ignored": true, "reason":
"no_matching_subscription" }`).

**`scripts/seed-plans.ts`** (`pnpm --filter @bebest/api run seed:plans`) —
upserts `PLAN_CATALOG` into the real `plans` table by `slug`, idempotent.
**Not run** as part of this build (no database connections were made at
all).

---

## Regression proof — Epics 2/5/7's existing entitlement tests

Ran explicitly, unmodified, after the refactor:

- `src/lib/entitlements.test.ts` — **28/28 passed** (the exact file the
  brief names).
- `src/routes/competitors.test.ts` — **10/10 passed** (Epic 2's
  `competitors_tracked` call site).
- `src/routes/query-sets.test.ts` — **21/21 passed** (Epic 5's
  `queries_per_query_set` call site).
- `src/routes/ai-runs.test.ts` — **8/8 passed** (Epic 7's
  `ai_queries_per_month` call site).

Full monorepo verification after the merge with concurrent Epic 8 work
(`turbo run typecheck|lint|test` at the `platform/` root, plus `turbo run
build --filter=@bebest/api --filter=@bebest/database`): **all green**,
**479 tests passed** across `@bebest/api` (0 failed, 54 intentionally-`.skip`
"NEEDS LIVE DB" tenant-isolation todos, unrelated to this epic), plus
`@bebest/database`'s own 7-test suite.

## End-to-end flow — traced against the spec's numbered list

1. `GET /plans` returns the 7 seeded tiers with the exact `limits` shape
   Epics 2/5/7 expect (`plans.test.ts`) — done, verified.
2. An org on `free` hitting Epic 2's competitor limit now resolves its limit
   via the real `subscriptions.plan_id -> plans.limits` join, not a
   hardcoded map (`entitlements.ts`'s primary path) — done. **Not verified
   against a live database** (no DB connection permitted); verified via a
   unit test that mocks the joined shape and asserts the resolved limit
   comes from the mocked `plans.limits`, not from `PLAN_CATALOG`.
3. `POST /orgs/me/subscription/upgrade` free→growth (owner) — calls
   `PaymentProvider.createSubscription`, writes a real `subscriptions` row,
   next `resolvePlanLimits` call reflects it immediately (no caching
   anywhere in this path) — done, verified (`subscription.test.ts`).
4. A non-owner attempting upgrade — 403 — done, verified.
5. `subscription.past_due` (valid signature) — does not downgrade; the
   day-10 equivalent (`subscription.unpaid`) — downgrades to free, data
   preserved (no delete call exists in the path) — done, verified
   (`webhook-state-machine.test.ts`, `billing-webhooks.test.ts`).
6. Tampered signature — rejected before any state change, logged as
   `billing.webhook_rejected` — done, verified.
7. Cancel — `organizations.status` changes, `subscriptions` downgraded to
   free (never deleted); "an unrelated table's row is still queryable
   immediately after" is demonstrated in `subscription.test.ts`'s cancel
   test via a `brands.findFirst` call in the same test body. **Not run
   against a live database** (no DB connection permitted).
8. Tenant isolation across `subscriptions`/`usage_records` —
   `subscriptions` already had (and keeps) the standard `tenant_isolation`
   RLS policy from `0000_init`; `plans` is confirmed global/unscoped by
   design (`0009_billing/rls.sql`'s header). **Not verified against a live
   Postgres instance** — same "NEEDS LIVE DB" gap every prior epic's RLS
   claims share (see `tenant-isolation.integration.test.ts`), not something
   this epic could close without violating the no-DB-connection constraint.

## What's not done

- **The database has never been migrated.** `0009_billing/` (schema +
  checks; `rls.sql` intentionally has no policies to add) exists as SQL/
  Prisma-migration files only, per the standing rule every prior epic
  follows. `scripts/seed-plans.ts` has never been run.
- **No real Stripe (or any other) `PaymentProvider` adapter exists** — this
  is the epic's own explicit, stated scope boundary, not an oversight.
  `NullPaymentProvider` is the only implementation.
- **The day-0/3/7/10 grace-period schedule has no real trigger.** The state
  machine correctly implements every transition; nothing yet calls it on a
  schedule (a cron/job querying "which subscriptions are N days past due"
  and constructing the corresponding webhook event). Deferred to whichever
  later epic wires real background scheduling, per the brief.
- **Invoice history is entirely fake** (`NullPaymentProvider.getInvoices`)
  — one deterministic zero-amount "paid" invoice, not a real billing
  history. Matches the epic's own "fake data until real Stripe is wired" UI
  surface note.
- **No frontend.** The Settings > Billing tab is stubbed per Epic 0's
  frontend completion doc; a separate agent wires it to the routes above.
- **`usage_records`/`ai_usage` tables are unused by this epic's routes.**
  The `GET /subscription` usage summary computes live counts the same way
  Epics 2/5/7's own entitlement checks already do, rather than reading a
  separate metered-usage ledger — `usage_records` remains exactly as Epic 0
  ported it (RLS'd, exported, otherwise untouched). A later epic that wants
  a genuine period-over-period usage history (not just "right now") would
  be the one to start writing rows into it.
- **`pages_analyzed`/`snapshots_per_month`/`agent_runs_per_month`/
  `autonomy_level_max`/`client_accounts` have real LIMITS seeded but no real
  USAGE counting** — by design (the features they gate don't exist yet).
  `GET /subscription` reports `used: null` for all five, honestly.
