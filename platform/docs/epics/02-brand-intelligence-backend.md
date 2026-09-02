# Epic 2 — Brand Intelligence (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root
marketing site was modified.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run (schema-only). No `migrate`, `db push`, or
`db pull` was run, per the hard constraint.

**This build ran concurrently with another agent's Epic 1 (CRM) work in the
same repo.** Both landed schema additions and `app.ts` route mounts in the
same files at overlapping times. Every shared file (`schema.prisma`,
`client.ts`, `index.ts`, `app.ts`) was re-read before each edit and both
sets of changes merged cleanly — verified by re-running `prisma validate`,
`tsc --noEmit`, and the full test suite after the fact, not assumed. See
"A naming collision worth flagging" below for the one loose end this left.

---

## The gap between the epic spec and the ported schema (read this first)

The task brief said to check `packages/database/prisma/schema.prisma`
before assuming anything was missing, on the premise that the Epic 2 domain
model was "already in the ported schema from Epic 0." On inspection, that
premise was only half true:

- **`brands`** — exists, hardened, matches the spec reasonably well
  (`name`, `description`, `website_url`, `industry`, `logo_url`, `aliases`,
  `positioning`, `value_proposition`, `key_differentiators`). One real gap:
  the spec's `industries[]`/`categories[]`/`markets[]` (plural, multi-value)
  don't exist — only a singular `industry` string. Left as-is rather than
  redesigned; see "What was NOT done" below.
- **`competitors`** — exists, but was missing two fields the spec calls
  out as core (`priority` 1/2/3 tiering, `aliases`). Added them (see
  "Schema additions" below) rather than building the API around their
  absence.
- **`entities`** — exists, but is a different table than the spec means.
  The real `entities` table is an AI-extraction artifact: `analysis_id` is
  a required FK with `onDelete: Cascade`, so a row disappears the moment
  the analysis that produced it is deleted. `@bebest/database`'s own
  `DECISIONS.md` §12 (written during Epic 0) flagged this exact collision
  in advance: *"this collision was flagged in advance... for whoever picks
  up the Brand Intelligence epic so they don't accidentally collide table
  names."* Building brand-profile CRUD on top of that table would have
  meant a user's manually-entered entity silently vanishing whenever an
  unrelated analysis got deleted. Added a correctly-scoped `brand_entities`
  table instead; the original `entities` is untouched.
- **`use_cases`** and **`brand_claims`** — did not exist under any name.
  Added both.
- **`chk_subscriptions_plan`** (unrelated to the table gaps, found while
  building the entitlement check) — 0000_init's CHECK constraint allowed
  `('free', 'starter', 'growth', 'agency')`, silently missing `'pro'`, even
  though both `docs/16-billing/BILLING_ARCHITECTURE.md` and this epic's own
  spec define a `pro` tier with a `competitors_tracked: 20` limit. Fixed
  forward in a new migration file rather than editing the already-committed
  0000_init one.

All of this is written up in detail, with the reasoning per item, in
`packages/database/DECISIONS.md` §13 (new section, appended — §1-12 are
Epic 0's, untouched).

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **Schema additions** (`prisma/schema.prisma`):
  - `brand_entities` (new table) — brand-profile entities/concepts, typed
    via a free-text `schema_type` (schema.org type — deliberately
    unconstrained, same reasoning as Epic 0's "open taxonomies" list).
  - `use_cases` (new table) — `title`, `description`, and four string
    arrays (`industries`, `company_sizes`, `pain_points`, `solutions`).
  - `brand_claims` (new table) + new `claim_confidence` enum
    (`high`/`medium`/`low`) — `claim`, `evidence`, `confidence`, `verified`.
  - `competitors.priority` (new `competitor_priority` enum:
    `primary`/`secondary`/`watch`) and `competitors.aliases` (new
    `String[]` column) on the existing table.
  - All three new tables follow Epic 0's exact hardening template:
    `organization_id` + `brand_id` (both `Restrict`, both indexed),
    UUID pk via `gen_random_uuid()`, soft delete (`deleted_at`),
    `created_by`/`updated_by` (nullable FK to `users`, `SetNull`) — these
    ARE tracked, unlike the AI-pipeline tables, because a human fills them
    in during onboarding.
  - `organizations`, `brands`, and `users` models' relation lists updated
    to add the required back-relations for all of the above (Prisma
    requires both sides declared).
- **`prisma/migrations/0001_brand_intelligence/`** (new folder, same
  not-applied-anywhere convention as `0000_init`):
  - `rls.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + the standard
    `tenant_isolation` policy (USING + WITH CHECK) for `brand_entities`,
    `use_cases`, `brand_claims`. Identical template to 0000_init's.
  - `checks.sql` — the `chk_subscriptions_plan` fix (drop + recreate to
    include `'pro'`).
- **`DECISIONS.md` §13** (new section) — full reasoning for every schema
  addition above, cross-referenced from this doc rather than duplicated.
- **`src/client.ts` / `src/index.ts`** — re-export the new types
  (`competitors`, `brand_entities`, `use_cases`, `brand_claims`,
  `competitor_priority`, `claim_confidence`) so `apps/api` never needs
  `@prisma/client` directly for them.

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/entitlements.ts`** (new, the reusable pattern the brief asked
  for) — `PLAN_LIMITS` (one exported data map, mirroring
  `docs/16-billing/BILLING_ARCHITECTURE.md`'s plan-limits table — there is
  no `plans` table yet, Epic 16/Billing is still `PLANNED` per
  `platform/EPICS.md`, so this is the documented stand-in), `resolvePlanLimits`
  (reads `subscriptions.plan` via `withOrgContext`, defaults to `free` for
  a missing/unrecognized plan value — fails toward the most restrictive
  tier, never the most permissive), `checkUsageLimit` (generic: caller
  supplies the metric and a `countCurrent()` closure; throws
  `EntitlementLimitError` carrying `metric`/`limit`/`current`/`plan`/
  `upgradeTo` on rejection). This is written once, generically, specifically
  so Epic 4/5 (and eventually Epic 16 itself) can reuse it verbatim.
- **`src/lib/brand-context.ts`** (new) — `getBrandForOrg(organizationId)`,
  the single place that resolves "the" org's brand (`findFirst`, ordered by
  `created_at`, `// MULTI-BRAND: see Epic 18` noted per the brief). Every
  competitors/entities/use_cases/brand_claims route calls this instead of
  querying `brands` directly.
- **`src/lib/validation.ts`** (new) — `httpUrlSchema`, a Zod schema
  restricting URL fields to `http(s)://`. Explicitly NOT SSRF protection
  (no DNS/redirect/private-IP checks) — documented inline that this class
  of defense belongs to Epic 3's crawler, which actually fetches URLs; this
  epic only stores a string a human typed in.
- **`src/middleware/audit-log.ts`** — added `writeManualAuditEvent(c, opts)`,
  a thin wrapper around the existing `writeAuditEvent` for routes where the
  entity id isn't known until after the handler runs (every POST/create —
  same reason `orgs.ts`'s own create-org endpoint never used the `auditLog`
  middleware either). PATCH/DELETE routes (which have `:id` in the URL)
  still use the `auditLog` middleware directly, matching `orgs.ts`'s
  existing pattern exactly.
- **Routes** (all new, all mounted in `src/app.ts`):
  - `src/routes/brands.ts` — `GET /api/brands/me`, `PATCH /api/brands/me`.
    PATCH upserts (create-or-update) because the epic's onboarding wizard
    has no separate "create brand" step — its first screen IS this PATCH.
    Requires `name` to create; every other field is optional and partial.
  - `src/routes/competitors.ts` — `GET/POST /api/brands/me/competitors`,
    `PATCH/DELETE /api/brands/me/competitors/:id`. POST is
    entitlement-checked via `checkUsageLimit` before the row is created;
    rejection returns **402** (not a bare 403) with a body naming the
    metric, limit, current count, plan, and `upgradeTo` — see "The
    entitlement-rejection response shape" below for why 402.
  - `src/routes/brand-entities.ts`, `src/routes/use-cases.ts`,
    `src/routes/brand-claims.ts` — standard tenant-scoped CRUD, same shape
    as competitors minus the entitlement check (only `competitors_tracked`
    is plan-limited per the spec).
  - All five files: `requireAuth` → `requireOrgFromToken('viewer')` (JWT
    `org` claim, DB-re-verified — these routes carry no org slug in the
    URL) → `requirePermission('create_brand_profile')` for writes /
    `requirePermission('view_intelligence')` for reads. `create_brand_profile`
    is `owner`/`admin`/`analyst` in `lib/rbac.ts`'s existing matrix —
    exactly the epic spec's "owner/admin/analyst can write; editor/viewer
    read-only," and NOT the same as an `isAtLeast(role, 'analyst')` check
    (which would incorrectly admit `editor`, since `analyst`/`editor` are
    the same rank in the coarse hierarchy).
  - Soft delete throughout (`deleted_at`, never a hard `DELETE`), UTC
    timestamps, UUID PKs — no new decisions needed here, just following
    Epic 0's already-hardened schema.
- **Zod validation** on every write endpoint; every response is explicitly
  serialized (camelCase, whitelisted fields) rather than returning raw
  Prisma rows.
- **45 new passing vitest tests** across 6 files (`brands.test.ts`,
  `competitors.test.ts`, `brand-entities.test.ts`, `use-cases.test.ts`,
  `brand-claims.test.ts`, `lib/entitlements.test.ts`), all against a mocked
  `@bebest/database` — no live database anywhere. `competitors.test.ts`
  contains the explicit entitlement-rejection test the brief asked for:
  free plan, 2 existing competitors, POST a 3rd → asserts **402**,
  `error: 'competitor_limit_reached'`, `limit: 2`, `current: 2`,
  `plan: 'free'`, `upgradeTo: 'starter'`, a message matching both "2
  competitors" and "starter", and — separately — that `competitors.create`
  was never called. A companion test proves the *same* count (2) does NOT
  reject on the `growth` plan (limit 10), so the test actually exercises
  the plan-lookup, not just a hardcoded threshold.

---

## The entitlement-rejection response shape

The brief said: *"reject the 3rd competitor add on Free with a clear,
specific error naming the limit and the upgrade path, not a generic 403."*
Two decisions worth surfacing:

1. **Status code: 402 Payment Required, not 403.** RBAC failures
   (`requirePermission`) in this codebase already return 403 with a bare
   `{ error: 'Insufficient permissions' }`. Reusing 403 for a billing/usage
   limit would make the two failure classes indistinguishable to a client
   without parsing the body — a viewer being denied write access and an
   analyst hitting their plan's competitor cap are different problems with
   different remedies (neither is "ask for a role change"). 402 is the
   standard HTTP code for exactly this "the request is otherwise valid but
   you need to pay/upgrade" case.
2. **The body is a data structure, not just a string** — `metric`, `limit`,
   `current`, `plan`, `upgradeTo` are all separate fields, plus a
   human-readable `message` that names both the limit and the upgrade
   target. A frontend can build an "upgrade to Starter" prompt directly
   from the structured fields without regex-parsing a sentence.

---

## A naming collision worth flagging

This build's migration folder is `prisma/migrations/0001_brand_intelligence/`.
The concurrent Epic 1 (CRM) agent working in the same repo at the same time
independently created `prisma/migrations/0001_crm/` — same sequence number.
Neither of these folders is a real Prisma-generated migration (like
`0000_init`, they contain only hand-written `rls.sql`/`checks.sql`, no
`migration.sql`), so nothing is functionally broken — but whoever
eventually turns these into real, ordered `prisma migrate` migrations
against a live database needs to renumber one of them first. Flagging here
rather than silently renaming the other agent's folder out from under it.

---

## What was NOT done (honest gaps, not oversights)

- **`brands.industries[]`/`categories[]`/`markets[]`** (plural, multi-value
  fields the spec's prose mentions) were not added — the ported schema's
  singular `industry` string was left alone. Unlike the `competitors`/
  `entities`/`use_cases`/`brand_claims` gaps, this isn't a hard blocker (a
  brand profile is still fully usable with one industry string), so it
  wasn't treated as required scope for this pass. If a future pass wants
  multi-industry support, that's a `brands.industry` → `brands.industries
  String[]` migration, additive and low-risk.
- **No list endpoint for brands** — matches the spec exactly ("no list
  endpoint needed yet, `GET /brands/me` resolves from tenant context").
- **Multi-brand support** — explicitly out of scope per the spec
  ("`// MULTI-BRAND: see Epic 18`"); every route resolves "the" org's
  brand via `getBrandForOrg`, not a `brandId` param.
- **Agency-tier `competitors_tracked` is `null` (unlimited)**, not a real
  per-client cap — the spec says "agency: per-client," which is a
  multi-client entitlement model (Epic 18's `agency_clients`), not a flat
  number. Documented as a placeholder in `lib/entitlements.ts`, not a claim
  that agency usage is actually unbounded in the product.
- **No `plans` table** — Epic 16 (Billing) is still `PLANNED`. The
  `PLAN_LIMITS` map in `lib/entitlements.ts` is the explicitly-documented
  stand-in; `resolvePlanLimits` is the one function Epic 16 needs to change
  when a real table exists, every call site (`checkUsageLimit`) stays the
  same.
- **No frontend** — this is the backend half only, per the task brief. The
  onboarding wizard UI (`docs/09-ux/CUSTOMER_JOURNEY.md` Stage 3) is a
  separate frontend-engineer pass against these same endpoints.
- **No integration tests against a live database** — same situation as
  Epic 0: everything here is unit/mock-tested against a fake
  `@bebest/database`. RLS enforcement for the three new tables can only be
  proven once a real Postgres instance exists with
  `0000_init` + `0001_brand_intelligence`'s SQL actually applied.
- **The `0001_brand_intelligence` / `0001_crm` folder-numbering collision**
  (above) is unresolved — deliberately left for whoever does the real
  migration ordering rather than guessed at.

---

## Verification performed in this build (all schema-only / mocked)

- `prisma validate` — schema valid, including the concurrent CRM agent's
  models merged alongside this epic's.
- `prisma generate` — client generates cleanly.
- `tsc --noEmit` — clean on `@bebest/database` and on every file this epic
  touched in `@bebest/api` (two pre-existing type errors in the concurrent
  CRM agent's own in-progress files, `middleware/crm-access.ts` and
  `routes/leads.ts`, are unrelated to this epic and were not introduced or
  fixed here).
- `eslint` — clean on both packages, full `src` directories.
- `vitest run` — 45 new tests, all passing, across `@bebest/api`; the
  package's full suite (183 tests total, including the CRM agent's) shows
  178 passing / 8 todo (Epic 0's live-DB-only tests) and 5 failing, all
  five in the concurrent CRM agent's own `deals.test.ts`/`crm-access.test.ts`
  files — not touched by, or caused by, this build.
- `@bebest/database`'s own suite: 7 tests, unchanged, passing.

---

## Post-verification fixes (qa-flow-tester pass)

A later pass (frontend/backend paired, since the findings spanned the API
contract both sides share) found this epic's frontend and backend had never
actually been wired together (the frontend shipped entirely against
`localStorage`, see the frontend doc's own "Post-verification fixes"), and
that where they *did* agree on shape, three of those agreements were
actually both sides independently deviating from the spec text in
compatible-but-wrong ways. Fixed on this (backend) side, each checked
against the literal spec text cited, not against whichever side was more
convenient to change — full reasoning for each is in
`packages/database/DECISIONS.md` §15, referenced rather than duplicated
here:

- **`brands.industry` → `industries`/`categories`/`markets` (arrays), and
  `key_differentiators` → `differentiators`.** This build's own §13 called
  the plural array fields a spec gap and left the ported `industry` VARCHAR
  in place "since a brand profile is still fully usable with one industry
  string." Re-reading `docs/06-database/SCHEMA.md` §2's literal `brands`
  DDL shows that call was wrong — the spec specifies arrays, and the
  frontend (already built against the spec's literal field names) was
  right. `industry` removed, `industries`/`categories`/`markets` added
  (`String[] @default([])`), `key_differentiators` renamed to
  `differentiators`. `routes/brands.ts`'s Zod schema, serializer, and
  create/update payloads updated; `brands.test.ts` updated; the now-orphaned
  `idx_brands_industry` index removed.
- **`competitors.priority`: enum → `Int`.** This build modeled it as a new
  `competitor_priority` enum (`primary`/`secondary`/`watch`) "consistent
  with `competition_type`." SCHEMA.md's literal DDL for this exact column —
  `priority SMALLINT NOT NULL DEFAULT 1, -- 1=primary, 2=secondary,
  3=watch` — is numeric, and the frontend's `CompetitorPriority = 1 | 2 | 3`
  (built directly against that comment) was right. The `competitor_priority`
  enum is removed; `priority` is now `Int @default(1) @db.SmallInt`,
  validated at the Zod boundary (`z.union([z.literal(1), z.literal(2),
  z.literal(3)])`) instead of by a DB enum. `routes/competitors.ts` and
  `competitors.test.ts` updated; the now-unused `competitor_priority` type
  export removed from `src/client.ts`/`src/index.ts`.
- **`use_cases.solutions` needed no backend change.** SCHEMA.md's
  `solutions TEXT[]` already matched this build's table exactly — the
  frontend's singular `solution: string` was the actual mismatch, fixed on
  that side only (see the frontend doc).
- **Plan tiers: `PLAN_TIERS`/`PLAN_LIMITS` were missing `managed` and
  `enterprise`.** `docs/16-billing/BILLING_ARCHITECTURE.md` documents seven
  tiers; this build's `lib/entitlements.ts` only had five (the five that
  existed when this epic was scoped). Both added, `competitors_tracked:
  null` (unlimited) for both — the same documented placeholder already used
  for `agency`, not a real product number (neither tier has one in the
  spec). `chk_subscriptions_plan`'s CHECK constraint (already fixed forward
  once in `0001_brand_intelligence/checks.sql` to add `'pro'`) needed the
  same two values — fixed forward again in a new
  `prisma/migrations/0003_epic2_contract_fixes/checks.sql` (0002 is CRM's)
  rather than re-editing an already-committed migration file, same rule
  this epic's own §13 established. `lib/entitlements.test.ts` gained
  coverage for both new tiers.
- **The frontend is now actually wired to these routes.**
  `apps/web/src/lib/onboarding-client.ts` calls `GET/PATCH /brands/me` and
  `GET/POST/PATCH/DELETE /brands/me/{competitors,use-cases,claims}` for
  real via `apiClient` — see the frontend doc for what changed on that side.
  Nothing about this epic's route contracts, RBAC, entitlement enforcement,
  or response shapes changed to support that beyond the three fixes above;
  the routes were already written to the right shape once the shape itself
  was corrected.
- **`tenant-isolation.integration.test.ts`** gained five new
  explicitly-named `describe.skip` blocks (still `NEEDS LIVE DB`, still not
  runnable without a real database — not attempted), one per this epic's
  table (`brands`, `competitors`, `brand_entities`, `use_cases`,
  `brand_claims`), replacing the generic Epic 0/1 coverage those tables
  previously relied on with concrete, nameable per-table `it.todo`s so the
  DoD checklist has one to point at per table.

Verification re-run after these fixes: `pnpm --filter @bebest/database
generate` and `prisma validate` (schema-only, `DATABASE_URL` set to a dummy
value for validate — no connection attempted), `pnpm --filter @bebest/api
test` (178 passing / 29 todo, 0 failing), `typecheck`, and `lint` — all
clean.
