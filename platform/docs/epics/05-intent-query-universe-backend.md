# Epic 5 — Intent & Query Universe (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root
marketing site was modified.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run (schema-only, `DATABASE_URL` set to a dummy
value so the CLI has something to parse — no connection attempted). No
`migrate`, `db push`, or `db pull` was run, per the hard constraint.

**This build ran concurrently with another agent's Epic 3 (Website
Intelligence) work in the same repo.** Both landed schema additions and
`app.ts`/`index.ts`/`client.ts` edits in the same files at overlapping
times. Every shared file was re-read immediately before each edit and both
sets of changes merged cleanly — verified by re-running `prisma validate`,
`tsc --noEmit`, and this epic's own test files after the fact, not assumed.
No folder-numbering collision this time: the new migration folder here is
`0004_query_universe`, and Epic 3's additions (`crawl_jobs`, `pages`,
`page_issues`, `sitemaps`, etc. — visible in `index.ts`'s diff) landed as
model additions elsewhere in `schema.prisma`, not a competing `0004_*`
folder.

---

## The gap between the epic spec and the ported schema (read this first)

The task brief said to check whether `query_sets`/`queries` already existed
in the ported schema before assuming they needed building. They partly did:

- **`query_sets`** — existed, but was missing three columns
  `docs/06-database/SCHEMA.md` §3's literal DDL requires: `query_count`,
  `version`, `status`. Added (VARCHAR + CHECK for `status`, matching the
  literal DDL's `VARCHAR(50) NOT NULL DEFAULT 'draft'` — not a native
  Postgres enum). Also had no index on `organization_id` at all, despite
  being one of the tables Epic 0's hardening pass denormalized that column
  onto — a pre-existing gap, fixed while already touching this table.
- **`queries`** — did **not** exist under this name or this shape. The
  ported schema has `questions` + a `query_set_questions` many-to-many join
  instead — a different, older design (see below) built for the legacy
  `questions -> runs -> responses` AI pipeline, with no
  `intent_type`/`category`/`tags`/`priority` fields at all. Building this
  epic's template generator or its "group the review UI by the ten
  categories" surface on top of `questions` was not possible without
  those fields, so a genuinely new `queries` table was added instead,
  exactly matching `docs/06-database/SCHEMA.md` §3's literal DDL
  (`query_set_id UUID NOT NULL REFERENCES query_sets(id)` — a direct
  one-to-many FK, not a join table).

**Why `questions`/`query_set_questions`/`runs`/`responses` were left
untouched, not repurposed:** `docs/epics/07-ai-visibility-engine.md`'s own
domain model (the very next epic that consumes this one's output)
independently defines brand-new `ai_runs`/`ai_responses`/
`brand_observations` tables — not the legacy `runs`/`responses` — that
consume a query_set's `queries` directly. That confirms the legacy pipeline
tables are a separate, older concept this epic doesn't need to touch or
migrate away from, the same reasoning `@bebest/database`'s own
`DECISIONS.md` §12 used when `entities` was left alone and `brand_entities`
was added instead for Epic 2.

Full reasoning, table by table, is in `packages/database/DECISIONS.md` §16
(new section, appended — §1-15 are Epic 0/1/2's, untouched).

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **Schema additions** (`prisma/schema.prisma`):
  - `query_sets` — added `query_count Int @default(0)`,
    `version Int @default(1)`, `status String @default("draft") @db.VarChar(50)`,
    plus the missing `idx_query_sets_organization` index and a new
    `idx_query_sets_status` index. `queries queries[]` relation added.
  - `queries` (new table) — `organization_id`, `query_set_id` (FK, Cascade —
    a true composition child of its query_set), `text`, `intent_type`
    (nullable VARCHAR — informational/commercial/comparison/transactional),
    `category` (nullable VARCHAR — one of the ten template categories, or
    a human-chosen label for a manually-added query), `tags String[]`,
    `priority Int @default(2) @db.SmallInt`, soft delete, `created_by`/
    `updated_by` (nullable, `SetNull` — same shape as `use_cases`/
    `brand_claims`/`brand_entities`, not the stricter required+`Restrict`
    shape `query_sets`/`brands` themselves use).
  - `organizations`/`users` models' relation lists updated with the
    required back-relations (Prisma requires both sides declared).
- **`prisma/migrations/0004_query_universe/`** (new folder, same
  not-applied-anywhere convention as every prior migration folder):
  - `rls.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + the standard
    `tenant_isolation` policy for `queries` (the one genuinely new table;
    `query_sets` already had its policy from `0000_init`).
  - `checks.sql` — `chk_query_sets_status` (`draft`/`active`/`archived`)
    and `chk_queries_intent_type` (the four documented values, NULL
    allowed). Deliberately **no** CHECK on `queries.category` (open — a
    human curating manually must be able to use a label outside the ten
    template categories) or `queries.priority` (Zod-only, same precedent as
    `competitors.priority`).
- **`DECISIONS.md` §16** (new section) — full reasoning for every schema
  decision above, cross-referenced from this doc rather than duplicated.
- **`src/client.ts` / `src/index.ts`** — re-export `query_sets`/`queries`
  types so `apps/api` never needs `@prisma/client` directly for them.

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/query-generator.ts`** (new) — the template-based generator,
  pure and deterministic, no AI call, no database access. Exports
  `generateCandidateQueries(brandProfile)` (uncapped) and
  `generateQueryUniverse(brandProfile, limit)` (slices to the plan's cap).
  Produces all ten documented categories (Category, Problem, Commercial,
  Comparison, Feature, Industry, Size, Geography, Intent, Authority) from
  Epic 2's actual shipped fields:
  - Category / Authority ← `brands.categories[]`
  - Commercial ← `brands.categories[]` × `use_cases.title`
  - Industry ← `brands.categories[]` × `use_cases.industries[]`
  - Size ← `brands.categories[]` × `use_cases.company_sizes[]`
  - Problem ← `use_cases.pain_points[]`
  - Intent (job-to-be-done) ← `use_cases.solutions[]`
  - Feature ← `brands.categories[]` × `brands.differentiators[]` (the
    ported schema has no separate "product feature" list; a brand's
    differentiators are the closest existing profile field — see "Design
    decisions that aren't given verbatim in the source docs" below)
  - Geography ← `brands.categories[]` × `brands.markets[]`
  - Comparison ← brand name vs. `competitors.name`
  - Deduplicates identical `(category, text)` pairs (case-insensitive) so
    the same industry/size/etc. listed on two use cases doesn't produce two
    literal-duplicate queries. Iteration order is fixed (categories, then
    use cases, then that use case's arrays) so a given brand profile always
    produces the exact same list in the exact same order.
- **`src/lib/entitlements.ts`** (extended, not duplicated) — added
  `queries_per_query_set: number | null` to the existing `PlanLimits`
  interface and `PLAN_LIMITS` map (the exact pattern the file's own
  comments ask new callers to follow): free 50, starter 200, growth 500,
  pro 1400, enterprise 5000, agency/managed null (unlimited placeholder,
  same treatment `competitors_tracked` already gives those two tiers). See
  "Design decisions" below for why 50/1400/5000 specifically, and why
  capping uses `resolvePlanLimits` directly rather than `checkUsageLimit`.
- **`src/routes/query-sets.ts`** (new) — mounted at
  `/api/brands/me/query-sets` (adapted from the spec's literal
  `/brands/:id/query-sets/...` to this codebase's established
  single-brand-per-org convention, same adaptation Epic 2's routes already
  made):
  - `GET /` — list the brand's query sets.
  - `GET /:id` — get one.
  - `POST /generate` — loads the brand + its `use_cases`/`competitors`,
    resolves the plan's `queries_per_query_set` limit, generates and caps
    in one step (`generateQueryUniverse`), creates the `query_sets` row
    (`status: 'draft'`, `query_count` set to the actual persisted count)
    with a nested `queries.create`, audits, returns both. The limit is
    resolved and the candidate list is sliced *before* any row is written
    — a capped generation never attempts to persist the queries past the
    cap, matching the epic's step 2 ("check the cap going in").
  - `PATCH /:id/activate` — draft → active only (409 otherwise). Freezing
    `version` is enforced by rejecting further `queries` mutations once
    `status !== 'draft'` (see below), not by bumping the version number —
    "frozen" means locked, not incremented.
  - `PATCH /:id/archive` — draft or active → archived (409 if already
    archived).
  - `GET /:id/queries` — list, filterable by `?intentType=`/`?category=`.
  - `POST /:id/queries` — manual add, **draft-only** (409 otherwise),
    increments `query_count` in the same `withOrgContext` transaction.
  - `PATCH /:id/queries/:queryId` — manual edit, **draft-only**.
  - `DELETE /:id/queries/:queryId` — manual remove (soft delete),
    **draft-only**, decrements `query_count` in the same transaction.
  - RBAC: `view_intelligence` for reads, `create_brand_profile` for every
    mutation — the same action every other brand-profile-adjacent write in
    this codebase uses (competitors/use_cases/brand_claims/brand_entities).
    The epic spec doesn't define a new RBAC action for the query universe,
    and this is the same kind of data (owner/admin/analyst-curated brand
    intelligence), so a new action would just be a second name for the same
    permission set.
  - Zod validation on every write; every response explicitly serialized
    (camelCase, whitelisted fields), never a raw Prisma row.
- **`src/routes/tenant-isolation.integration.test.ts`** — a new
  `describe.skip('Epic 5 tenant isolation — query_sets / queries (NEEDS
  LIVE DB)')` block with four named `it.todo`s (cross-org read/write/
  id-guessing, plan-limit isolation), matching the existing per-table
  pattern this file already uses for Epic 2's tables. Still not runnable
  without a live Postgres instance — not attempted here, same as every
  other block in this file.
- **36 new passing vitest tests** across three files:
  - `src/lib/query-generator.test.ts` (10 tests) — the hard-gated unit test
    the DoD requires: a fixed, fully-enumerated fixture brand profile
    (exactly one item per input dimension) asserted against the *exact*
    expected 10-query array, one query per template category, in a fixed
    order. Also covers determinism (calling twice gives identical output),
    deduplication, empty-categories and fully-empty-profile edge cases, and
    the entitlement cap (`generateQueryUniverse` truncating a richer
    fixture's >50-candidate output to an exact given limit, and passing
    `null` through uncapped).
  - `src/lib/entitlements.test.ts` (+10 tests) — `resolvePlanLimits`
    resolving `queries_per_query_set` correctly for all seven tiers.
  - `src/routes/query-sets.test.ts` (16 tests) — the full route surface
    against a mocked `@bebest/database`: 404/403 guards, the generate
    endpoint's cap-before-persist behavior (asserting the exact
    `queries.create` array length passed to `query_sets.create`, both
    under and over the free-plan cap, and uncapped on growth), activate/
    archive status-transition guards, and the manual add/edit/remove
    endpoints' draft-only enforcement (409 once the query set is active,
    `queries.create`/`queries.update` never called in that case).

---

## Design decisions that aren't given verbatim in the source docs

The epic spec and `docs/11-geo/GEO_ENGINE.md` give the ten category names
and three worked query-text examples, but not everything a working
generator needs. These calls were made and are worth surfacing explicitly
rather than leaving implicit in the code:

1. **Feature queries read `brands.differentiators[]`.** Neither the epic
   spec nor the ported schema has a dedicated "product feature" list — a
   brand's differentiators (already a real, human-filled Epic 2 field) are
   the closest existing substitute. If a future epic adds a genuine
   features/capabilities table, this template should be repointed at it.
2. **`intentType`/`priority` per template category** (in
   `CATEGORY_META`) — the epic spec names the four `intent_type` values and
   the three `priority` levels but never maps the ten template categories
   onto them. Comparison and Commercial (bottom-of-funnel, matching GEO's
   own Recommendation Score weighting — the heaviest single component of
   the AI Visibility Score formula in Epic 7's spec) are ranked `priority:
   1`; broad top-of-funnel education (Category, Authority, Problem) and
   Geography (relevant only to location-competing brands) are ranked
   `priority: 3`; Feature/Industry/Size/Intent sit in between at `2`. This
   is this build's own judgment call, not a documented weighting — flagged
   here so a product/growth-strategist review can override it without
   having to reverse-engineer the reasoning from the code.
3. **`queries_per_query_set` numeric caps.** `docs/11-geo/GEO_ENGINE.md`
   gives Free as a *range* ("20-50 sample queries"); 50 (the upper bound)
   is used so a free-tier generation produces the richest sample the tier
   allows, reading as "up to N" like every other tier rather than "as low
   as N." Enterprise is documented as "Custom (5,000+)" — 5000 is used as
   a floor, not `null`/unlimited, since GEO_ENGINE.md gives it a concrete
   number unlike `agency`/`managed` (which have no documented number for
   this metric anywhere and get the existing `null` placeholder
   `competitors_tracked` already uses for them).
4. **Capping via `resolvePlanLimits`, not `checkUsageLimit`.** The task
   brief asked for "the exact same `checkUsageLimit`/`PLAN_LIMITS`
   pattern." `checkUsageLimit` itself has a reject-or-resolve shape (throws
   `EntitlementLimitError` past the limit, otherwise resolves with no
   return value) — correct for "block this write" (competitors), wrong for
   "cap this batch at N and keep going" (query generation, which should
   never reject an otherwise-valid generate call, just cap its size). The
   *pattern* reused is the data map and its resolver
   (`PLAN_LIMITS`/`resolvePlanLimits`) plus the exact same 7-tier
   `PlanTier` type; `checkUsageLimit`'s own reject-only contract wasn't
   force-fit where its semantics didn't match. `queries_per_query_set` was
   added as a new key to the existing single `PLAN_LIMITS` map — no second
   entitlement map or mechanism was created.
5. **"Freezing `version`" means locking, not incrementing.** The epic's
   step 4 says activation must ensure "a subsequent edit... must not
   silently mutate the same version." This is implemented as: every
   `queries` mutation route (`POST`/`PATCH`/`DELETE` on `:id/queries...`)
   checks `query_set.status === 'draft'` and 409s otherwise. `version`
   itself never changes after creation in this pass — there is no
   "duplicate an active set into a new draft version 2" flow yet (see "What
   was NOT done").

---

## What was NOT done (honest gaps, not oversights)

- **No "duplicate an active query set into a new draft" flow.** The epic
  spec's step 4 only requires that an activated set's version not be
  silently mutated; it doesn't require a re-versioning workflow. Rejecting
  further edits with a 409 satisfies the literal requirement. A "clone this
  active set as a new draft (version 2)" endpoint would be natural future
  work but wasn't asked for and wasn't built.
- **No `PATCH /:id`** for renaming/re-describing a query set after
  creation — not mentioned in the spec's API surface list (`generate`,
  list/get, activate, archive; `queries`: list/add/edit/remove). Can be
  added additively later without touching anything built here.
- **No AI-assisted elaboration.** The epic spec is explicit this is
  deferred ("LLM-assisted elaboration... is a clearly-marked enhancement
  layered on top later, not a blocking dependency now") and Epic 6
  (AI Provider Abstraction) is done but intentionally not called from here.
- **No frontend.** This is the backend half only, per the task brief. The
  "review-and-curate" screen (`docs/epics/05-intent-query-universe.md`'s UI
  surface section) is a separate frontend-engineer pass against these same
  endpoints.
- **No integration tests against a live database.** Same situation as
  every prior epic: everything here is unit/mock-tested against a fake
  `@bebest/database`. RLS enforcement for `queries` (and the `query_sets`
  columns this epic added) can only be proven once a real Postgres
  instance exists with `0000_init` through `0004_query_universe`'s SQL
  actually applied — see the new `describe.skip` block in
  `tenant-isolation.integration.test.ts`.
- **Epic 6/7 consumption was checked by inspection, not by building
  against Epic 7.** The epic's step 5 asks to confirm Epic 6/7 can consume
  an active query_set's `queries` "with no additional transformation."
  Epic 7's own spec was read and its domain model
  (`ai_runs`/`ai_responses` referencing `queries` directly) confirmed the
  shape lines up — but Epic 7 itself is not built yet, so this is a
  documented cross-check, not an executable proof.

---

## Verification performed in this build (all schema-only / mocked)

- `prisma validate` — schema valid, including the concurrent Epic 3
  agent's models merged alongside this epic's.
- `prisma generate` — client generates cleanly.
- `tsc --noEmit` — clean on `@bebest/database` and on the full
  `@bebest/api` source tree (including the concurrent Epic 3 agent's
  in-progress files).
- `tsc -p tsconfig.build.json` — `@bebest/api`'s build compiles cleanly.
- `eslint src --ext .ts` — clean on every file this epic touched; the only
  lint errors in a full-`src` run are two pre-existing unused-variable
  errors in the concurrent Epic 3 agent's own in-progress
  `src/lib/crawler/engine.ts` — not introduced or touched here.
- `vitest run` — this epic's three files (`query-generator.test.ts`,
  `entitlements.test.ts`, `query-sets.test.ts`) all green in isolation (36
  new tests) and re-confirmed green after the concurrent Epic 3 agent's
  merges. The full `@bebest/api` suite (all epics combined) was 211
  passing/33 todo/0 failing right after this epic's work landed; a later
  re-run (after further concurrent Epic 3 commits) shows 255 passing/33
  todo/1 failing, with the one failure in the concurrent agent's own
  in-progress `src/lib/html-extract.test.ts` (an HTML-sanitization
  assertion unrelated to `query_sets`/`queries`) — not introduced, touched,
  or fixed by this build.
- `@bebest/database`'s own suite: 7 tests, unchanged, passing.
