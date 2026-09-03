# Epic 19 — Production Hardening (backend half): completion summary

Scope: `platform/apps/api` (`@bebest/api`) and `platform/packages/database`
(`@bebest/database`, schema untouched — see below). Branch
`rebuild/platform`, no other branch touched; nothing under `api/`,
`web-app/`, or the repo-root marketing site was modified. **Frontend is not
built** — a separate agent handles the frontend half (error-boundary
quality, list-view pagination controls), per the epic spec's own split.

This epic is a cross-cutting audit-and-fix pass over the ENTIRE existing
`apps/api` codebase, not a new feature with isolated files — every one of
the 7 items below touches code written in Epics 0–18.

**No database was connected to at any point** — `packages/database/prisma/
schema.prisma` was not edited (no new tables/columns needed for any of the
7 items), so there is no new migration folder. `pnpm --filter @bebest/
database test`/`typecheck` were run against the existing generated Prisma
client only.

**No real network call to any external provider was made anywhere in this
build.** `pg-boss` and `@sentry/node` were added as real dependencies and
their real APIs are driven by real classes (`PgBossJobQueue`,
`SentryErrorTracker`) — but neither is ever constructed by this build's
default wiring (`InMemoryJobQueue`/`ConsoleErrorTracker` remain the
defaults), and their own unit tests mock the package entirely (`vi.mock('pg-boss', ...)` /
`vi.mock('@sentry/node', ...)`) so even running the test suite opens no
connection. Same `NullXProvider` discipline every prior epic's external
integration uses.

---

## Item 1 — Durable job queue

**Found.** Four real `setImmediate` call sites (grepped exhaustively, not
sampled):
- `routes/crawl.ts` (Epic 3 — crawler)
- `lib/ai-visibility/schedule-run.ts` (Epic 7/8 — AI-visibility pipeline,
  shared by brand and competitor runs)
- `lib/agents/runner.ts` (Epic 12 — agent runner)
- `routes/snapshot.ts` (Epic 17 — free-snapshot pipeline)

A fifth candidate, `lib/measurement/schedule-remeasurement.ts` (Epic 14),
turned out NOT to be a `setImmediate` call at all — it already has its own
honest, well-tested (8 tests) injectable-clock design for a genuine
4-week-delayed trigger, distinct from "fire essentially now, in the
background" the other four do.

**Fixed.** `lib/queue/job-queue.ts` defines the `JobQueue` interface
(`register`/`enqueue`/`start`/`stop`, `enqueue` takes an optional
`delayMs`). Two implementations:
- `lib/queue/in-memory-job-queue.ts` — functionally equivalent to the
  `setImmediate` it replaces (fires via `setImmediate` under the hood for
  an immediate job; a chunked `setTimeout` — reusing the same 32-bit
  ceiling fix `schedule-remeasurement.ts` pioneered — for a delayed one).
  No persistence; a process restart between `enqueue()` and the handler
  firing loses the job, same gap every one of the four original `//
  TODO` comments already named.
- `lib/queue/pgboss-job-queue.ts` — real, complete implementation on
  `pg-boss@12.30.0`. `register()` before `.start()` buffers (pg-boss needs
  `createQueue()` before `.work()`/`.send()` can target it); a handler
  rejection is logged then re-thrown so pg-boss marks the job `failed`
  (with its own retry policy) instead of silently `completed`.

`lib/queue/default-job-queue.ts` is the process-lifetime singleton every
call site imports (`getDefaultJobQueue()`) — never a concrete class.
Defaults to `InMemoryJobQueue`. Swapping to durable execution: construct
`new PgBossJobQueue(connectionString)` here instead, call `.start()` once
at server boot (`server.ts`), keep every `register()`/`enqueue()` call site
unchanged. A config change, not a code change.

All four call sites refactored: each now `register()`s its handler once at
module load (or once per `createSnapshotRoutes()` call, for `snapshot.ts` —
that factory has exactly one call site in `app.ts`) and `enqueue()`s
instead of calling `setImmediate` directly. Every stale prose comment
elsewhere in the codebase that described the old `setImmediate` shape
(`lib/ai-visibility/pipeline.ts`, `lib/agents/run-ai-visibility-step.ts`,
`lib/content/draft-generator.ts`, `lib/crawler/engine.ts`, `lib/
free-snapshot/orchestrator.ts`, `routes/ai-runs.ts`) was updated to
describe the `JobQueue` shape instead — no comment left referencing a
mechanism that no longer exists at that call site.

**`schedule-remeasurement.ts` deliberately NOT migrated onto `JobQueue`** —
see that file's own (updated) header comment and `apps/api/DECISIONS.md`'s
new "Job queue" section for the full reasoning: its `deps.schedule` API
takes a raw closure, not a serializable payload, so routing it through
`enqueue()` unchanged would give it zero real durability gain while risking
its 8 existing tests. Real follow-up work (a dedicated job type + `
{actionId, organizationId}` payload), not silently dropped — its `// TODO:
durable queue` comment is confirmed still accurate.

**Tests.** 21 new tests, zero live-DB/network dependency:
- `lib/queue/in-memory-job-queue.test.ts` (9) — fires asynchronously,
  throws when unregistered, rejects are caught+logged not thrown,
  independent job types don't cross-fire, `delayMs` including past the
  32-bit `setTimeout` ceiling.
- `lib/queue/pgboss-job-queue.test.ts` (9) — construction never connects,
  `register()` before/after `.start()`, the real `boss.work()`/`.send()`
  argument shapes, a handler rejection is logged then re-thrown, `delayMs`
  → `startAfter` computation.
- `lib/queue/default-job-queue.test.ts` (3) — singleton behavior, test
  seam.

All four existing route test files that exercise the migrated call sites
(`crawl.test.ts`, `ai-runs.test.ts`, `competitor-ai-runs.test.ts`,
`snapshot.test.ts`, `runner.test.ts`, `agent-run-details.test.ts`,
`agents.test.ts`) pass UNCHANGED — they mock the underlying work function
(`runCrawlJob`, `runAiVisibilityRun`, `executeAgentRun`,
`runFreeSnapshotPipeline`), not the scheduling mechanism, and the "await a
`setImmediate` tick" pattern they already used still works because
`InMemoryJobQueue`'s immediate path still resolves via `setImmediate`.

---

## Item 2 — Rate limiting durability audit

**Found, part 1 (durability).** `lib/rate-limiter.ts` is already the real
Postgres-backed limiter (`organization_rate_limits`, a fixed-window atomic
upsert) — this was done in Epic 0 and never regressed. No leftover
in-memory limiter exists anywhere in `apps/api/src`.

**Found, part 2 (wiring — the real gap).** `authenticatedRateLimit`
(120/min, keyed by user id) has been fully implemented in
`middleware/rate-limit.ts` since Epic 0 with **zero call sites** anywhere
in the codebase. Grepping every route file confirmed only three routes
apply any route-specific limiter at all (`auth.ts`'s `/magic-link` →
`authRateLimit`, `snapshot.ts` → `freeSnapshotRateLimit`, `apply.ts` →
`applyFormRateLimit`) — every other route, including all ~90
`requireAuth`-gated handler registrations across 41 files, was running on
nothing but the baseline `publicRateLimit` (30/min) applied app-wide in
`app.ts`. This is the exact finding this epic's spec called "the
single-most-repeated finding across Epics 13/14/15/20's own verify
passes."

**Fixed.** `authenticatedRateLimit` inserted immediately after
`requireAuth` in every handler chain that has it, across every route file.
`publicRateLimit` remains the sole limiter on genuinely public/
unauthenticated endpoints: `snapshot.ts`'s `POST /`, `apply.ts`'s
`POST /`, and `auth.ts`'s `/magic-link` (own `authRateLimit`), `/verify`,
`/refresh` (no auth-gate — refreshing IS how you get a new access token).
`auth.ts`'s own `requireAuth`-gated sub-routes (`/select-org`, `/me`) DO
get `authenticatedRateLimit` — the criterion is "does this handler chain
have `requireAuth`," not "does this route file's name contain `auth`."

**Tests.** No new dedicated test file (the fix is additive middleware
wiring, not new logic) — but every route test file across the 41 touched
files needed `db.organization_rate_limits.upsert` mocked (previously
unused by most of them, since most routes had no rate-limit call at all
before this fix); 20 test files were missing that mock entirely and were
updated (`{ upsert: vi.fn().mockResolvedValue({ count: 1 }) }` in the mock
`db` object, reset in `beforeEach`, matching the pattern every route that
already had a rate limiter already used). Full `apps/api` suite (993
tests) passes with the wiring in place, confirming no route now silently
429s a legitimate first request.

---

## Item 3 — Error tracking

**Found.** `app.ts`'s global `onError` handler built and logged a
structured-JSON line inline (`console.error(JSON.stringify({level,
requestId, msg, stack}))`) — no tracking abstraction existed anywhere in
`apps/api`. `docs/05-architecture/ARCHITECTURE.md`'s Observability table
(referenced by the epic spec) marks error tracking "UNDECIDED/Not
implemented"; the root `DECISIONS.md`'s Open Decisions table lists D-O14
("Error tracking: Sentry vs Bugsnag vs Honeybadger") as still OPEN.

**Fixed.** `lib/observability/error-tracker.ts` defines the `ErrorTracker`
interface (`captureException(err, context?)`, never throws). Two
implementations:
- `lib/observability/console-error-tracker.ts` — the exact pre-epic
  behavior, extracted verbatim (same fields, same shape) plus `method`/
  `path` when the caller has them (additive).
- `lib/observability/sentry-error-tracker.ts` — real, complete
  implementation on `@sentry/node@10.73.0`. `Sentry.init()` only runs
  inside its own `.init()` method (never called by this build's default
  wiring); `captureException()` before `.init()` is a silent no-op.

`lib/observability/default-error-tracker.ts` is the process-lifetime
singleton `app.ts` imports. Defaults to `ConsoleErrorTracker` — this
build's observable output is unchanged. Swapping to real Sentry tracking:
construct `new SentryErrorTracker(process.env.SENTRY_DSN!)` there instead
and call `.init()` once at server boot. Config change, not a code change.
This does NOT close D-O14 — it makes the epic spec's named choice (Sentry)
concretely implementable; a real sign-off with a real account/DSN is
outside what this build environment can do.

**No leaked internals, confirmed.** `ErrorContext` is a narrow, explicit
identifier allowlist (`requestId`, `method`, `path`, `organizationId`,
`userId`) — never the raw Hono `Context`, request headers, cookies, or
bodies. Neither implementation has a code path that could forward an
`Authorization` header or a magic-link/refresh token, because the type
callers pass has no field to carry one — checked directly, not just
asserted. `SentryErrorTracker` additionally sets `sendDefaultPii: false`
on `Sentry.init()` as defense in depth against Sentry's own default
request-instrumentation PII capture. `app.ts`'s `onError` still returns
the same generic `{ error: 'Internal server error' }` to the client —
tracking is a server-side-only side channel, the client-facing contract is
unchanged.

**Tests.** 13 new tests, zero live-DB/network dependency:
- `console-error-tracker.test.ts` (4) — shape match, non-`Error` throws,
  field allowlist, no-context case.
- `sentry-error-tracker.test.ts` (6, `vi.mock('@sentry/node', ...)`) —
  construction never connects, pre-`init()` no-op, `init()` argument shape
  (DSN, `sendDefaultPii: false`, real `NODE_ENV`), scope tagging only for
  present fields, never throws.
- `default-error-tracker.test.ts` (3) — singleton behavior, test seam.

---

## Item 4 — Structured logging completeness

**Audited.** Grepped every `console.log`/`console.error`/`console.warn`/
`console.info` call in `apps/api/src` outside test files. Result: **zero
genuine stragglers.** Every error/observability log already uses the
established `JSON.stringify({level, ...})` pattern (`middleware/logger.ts`
IS that pattern; `audit.ts`, `notify.ts`, `action-details.ts`, every
`JobQueue`/`ErrorTracker` file, etc. all follow it).

Two categories of plain (non-JSON) `console.log` exist, both deliberate and
pre-existing, neither a logging straggler:
- `lib/email.ts`'s `ConsoleEmailSender` (`[dev email] ...`) — this class
  IS the dev-mode email "delivery," not a log line; explicitly marked with
  its own `eslint-disable-next-line no-console -- deliberate` comment.
- `routes/billing-webhooks.ts`/`routes/orgs.ts`'s two inline `[dev email]
  ...` lines — same dev-mode-email-substitute pattern, explicitly marked,
  with `orgs.ts`'s own comment naming the real gap ("NEEDS EmailSender
  wiring... tracked in apps/api/README.md's 'not done yet' list"). This is
  pre-existing, already-tracked technical debt about a DIFFERENT concern
  (bypassing the `EmailSender` abstraction) than item 4 audits — left
  untouched per this epic's "no scope creep" constraint.

`scripts/seed-plans.ts`'s `console.log` calls are a standalone CLI seeding
script's human-readable terminal output, not a request-lifecycle log.
`server.ts`'s one-time "listening on..." startup banner is the same. Both
out of this item's scope (neither is a route, neither runs per-request).

**Fixed.** Nothing needed fixing — the audit found no violations.

---

## Item 5 — Crawl-jobs list endpoint

**Found.** Epic 3's own completion doc flagged this gap: no `GET
/brands/me/crawl-jobs` route existed — only `POST /brands/me/crawl`
(create) and `GET /crawl-jobs/:id` (single lookup). `apps/web/src/data/
website/client.ts` worked around it with a `localStorage`-tracked pointer
list of job ids the browser has seen (see that file's own header comment
for the full account) — a real, honest, but real gap: a cleared browser or
a different device loses the *history view* (never correctness — every
field still comes from a real `GET /crawl-jobs/:id`).

**Fixed.** `GET /brands/me/crawl-jobs` — a second router
(`crawlJobsListRoute`) exported from `routes/crawl-jobs.ts` alongside the
existing default-exported `:id` router, mounted separately in `app.ts` —
same "two routers, one resource, two base paths" split `routes/actions.ts`
(list)/`routes/action-details.ts` (`:id`) already establishes elsewhere,
applied here to a resource whose list and detail logic happen to share one
file. Response shape matches `GET /brands/me/pages`'s exact established
convention: `{ crawlJobs: [...], pagination: { total, limit, offset } }`.
Paginated (`limit` 1–100, default 25; `offset`), tenant-scoped
(`organization_id` + `brand_id` in the WHERE clause, on top of RLS),
filterable by `status`, newest-first. 404s when the org has no brand
profile yet, matching every other `/brands/me/*` route's convention.

**Tests.** 10 tests in `routes/crawl-jobs.test.ts` (6 new, for the list
route; 4 pre-existing for `:id` unchanged): 404 with no brand, paginated
response shape + exact `findMany` call args, status filter, 422 on an
invalid status enum value, 422 on `limit=99999` (the schema rejects rather
than silently clamping, confirming the cap is real and enforced, not just
accepted-and-ignored), viewer-role access, and an explicit tenant-isolation
assertion (`organization_id` always present in the WHERE clause).

---

## Item 6 — Pagination audit

**Audited.** Grepped every `findMany(` call across every route file in
`apps/api/src/routes` and checked each against its call site: was it the
main payload of an outward `GET .../[plural]` list endpoint, and did it
have a `take`?

**Found — 2 genuine, unambiguous bugs** (an unbounded call sitting
directly next to a correctly-capped sibling in the same handler):
- `routes/accounts.ts`'s `GET /accounts/:orgId` — `deals.findMany` had NO
  cap while `activities.findMany` two lines below it already capped at
  `take: 50`.
- `routes/actions.ts`'s `GET /brands/me/actions` (the Action Center's four
  status-bucketed sections) — none of the four `findMany` calls had any
  cap at all, on a table that only ever grows (soft-deleted, never purged).

**Found — defensive gaps** (no existing cap, lower real-world risk because
the underlying table is naturally small or entitlement-bound at write
time, but genuinely unbounded on the read path per the audit's own "not
just accepts a limit param" standard): `routes/agency.ts` (`GET
/agency/clients`, `GET /agency/clients/incoming`), `routes/agents.ts` (`GET
/`, agent-run history), `routes/ai-runs.ts` (`GET /`, brand's own AI-run
history), `routes/competitor-ai-runs.ts` (`GET /:competitorId/ai-runs`),
`routes/competitors.ts` (`GET /`), `routes/brand-claims.ts`,
`routes/brand-entities.ts`, `routes/use-cases.ts` (all three `GET /`),
`routes/integrations.ts` (`GET /`), `routes/orgs.ts` (`GET /` — orgs for
the current user; `GET /:slug/members`), `routes/auth.ts` (`GET /me`'s
membership list, same shape as `orgs.ts`'s), `routes/query-sets.ts` (`GET
/`, query sets for a brand), `routes/seo.ts` (`GET /keyword-groups`, `GET
/keyword-groups/:id/keywords`), `routes/content-brief-details.ts` (`GET
/:id`'s draft-versions list), `routes/content-drafts.ts` (`GET
/:id/quality-checks`), `routes/agent-run-details.ts` (`GET /:id`'s
event-log/pending-actions lists).

**NOT flagged** (checked, found to be internal processing reads bounded by
a real upstream ceiling, not client-facing unbounded lists): `pages.findMany`
inside `POST /seo/analyze` (bounded by the crawler's own hard 500-page-max
rule); `queries.findMany` inside `POST /ai-runs`/`POST /competitors/:id/
ai-runs` (used to compute an exact entitlement count, would be WRONG to
cap); `use_cases.findMany`/`seo_keywords.findMany` inside `POST
/keyword-groups/generate` (bounded by that request's own just-created
data, read back inside the same transaction); `organizations.findMany`
inside `GET /accounts` (bounded by that call's own already-capped `limit`
param).

**Fixed.** Every genuine and defensive gap above got a server-side `take`
— `100` for most (matching the `.max(100)` ceiling every already-correct
list endpoint in this codebase uses), `50` for `accounts.ts`'s deals (
matching its sibling), `200` for `orgs.ts`'s members list, `1000` for
`agent-run-details.ts`'s event log (a single run's "full append-only event
log" — the route's own header comment's explicit promise — so the cap here
is a generous technical safety ceiling, not a page size meant to bite in
normal use) and `seo.ts`'s per-group keyword list.

**One deliberate exception, not a bug left unfixed:**
`routes/query-sets.ts`'s `GET /:id/queries` got `take: 5000`, not `100`.
`lib/billing/plan-catalog.ts`'s real `queries_per_query_set` entitlement
(already enforced at generation time) legitimately allows up to 5,000 on
the highest finite-limited plan, and is uncapped (`null`) on two others; a
`100` cap would silently truncate a real paying customer's real data. This
route's response is also a flat array (`apps/web/data/query-universe/
client.ts` calls it expecting `ApiQuery[]`), so adding real offset
pagination is a breaking response-shape change for the frontend — out of
scope for this pass. `5000` is a genuine technical safety ceiling matching
the highest real finite entitlement (no legitimate customer ever
truncated), not a page size — real pagination for the uncapped-plan case
is tracked as follow-up work below, not invented here.

**Tests.** New assertions in `routes/crawl-jobs.test.ts` (the new
endpoint, covered under item 5 above), `routes/actions.test.ts` (asserts
all 4 `findMany` calls carry `take: 100`), `routes/accounts.test.ts`
(asserts `deals.findMany` carries `take: 50`). The remaining defensive
fixes are exercised by each route's own pre-existing passing tests (the
mocked `findMany` return value is unaffected by an added `take` field in
the call args) — a dedicated assertion per file was judged not worth the
mechanical bulk for fixes that don't change any route's logic, only adds a
`take` clamp to an existing query object.

---

## Item 7 — Dependency audit

`pnpm audit` across the whole monorepo (all 7 workspace projects) found
exactly **one** finding:

```
high — DeepmergeTS has stack exhaustion when merging recursive object graphs
Package: deepmerge-ts (vulnerable <8.0.0, patched >=8.0.0)
Path: apps/api > @bebest/database > @prisma/client > prisma > @prisma/config > deepmerge-ts@7.1.5
      packages/database > (same chain)
```

**Investigated before fixing.** `deepmerge-ts` is a third-level transitive
dependency of Prisma's own CLI config-loader (`@prisma/config`), used only
to merge `prisma.config.ts`/CLI-flag objects at `prisma generate`/`migrate`
CLI-invocation time — never imported by any code this API server actually
runs at request time. Checked whether a clean `prisma`/`@prisma/client`
version bump would pull in a patched `deepmerge-ts`: it would NOT —
`@prisma/config` pins `deepmerge-ts@7.1.5` as an exact (non-range)
dependency on every checked release, including `prisma@7.10.0` (the latest
real stable, a full major bump from this build's `^6.5.0`) and the
`8.0.0-rc.12` pre-release currently tagged `latest` on npm (not usable
here — a release candidate is not an appropriate pin for the ORM this
entire build depends on).

**Fixed via a `pnpm.overrides` pin**, not a `prisma`/`@prisma/client`
version bump: root `package.json` now pins `"deepmerge-ts": "^8.0.0"` under
`pnpm.overrides`, forcing every transitive resolution (including inside
`@prisma/config`) to the patched version regardless of what that package's
own `package.json` declares. Verified safe before committing to it:
`@prisma/config`'s only usage is a single dynamic `import('deepmerge-ts')`
calling the top-level `deepmerge()` function — the same core export
`deepmerge-ts` has always had (a security-motivated major bump changing an
internal recursion-depth-tracking detail, not this function's public
signature). Confirmed by re-running, after the override: `pnpm audit` →
"No known vulnerabilities found"; `pnpm --filter @bebest/database
typecheck`/`test` → clean, 7/7 tests; `pnpm --filter @bebest/api
typecheck`/`test` → clean, 993/993 tests. No other package in the
monorepo depends on `deepmerge-ts` directly, so the override has no other
blast radius.

**`pg-boss@12.30.0` and `@sentry/node@10.73.0`**, added as new real
dependencies for items 1 and 3, introduce zero new `pnpm audit` findings
(confirmed — the audit above was run AFTER adding both).

**Accepted risk: none remaining.** Every finding `pnpm audit` reported was
cleanly fixed via a version-forcing override; there is nothing left to
document as an accepted risk for this pass.

---

## Files touched

**`apps/api` (new):**
- `src/lib/queue/job-queue.ts`, `in-memory-job-queue.ts` (+`.test.ts`),
  `pgboss-job-queue.ts` (+`.test.ts`), `default-job-queue.ts` (+`.test.ts`)
- `src/lib/observability/error-tracker.ts`, `console-error-tracker.ts`
  (+`.test.ts`), `sentry-error-tracker.ts` (+`.test.ts`),
  `default-error-tracker.ts` (+`.test.ts`)

**`apps/api` (modified):**
- `src/app.ts` — `onError` routed through `ErrorTracker`; mounts
  `crawlJobsListRoute` at `/api/brands/me/crawl-jobs`.
- `src/app.test.ts` — explicit `30000`ms timeout on the 3 tests that
  dynamically import the full `app.js`; observed import cost ranged from
  ~3.5s to 10s+ depending on machine/CI load at the moment, colliding with
  vitest's 5s default. Not a correctness issue — the assertions themselves
  are deterministic, only the import cost varies.
- `src/routes/crawl.ts`, `src/lib/ai-visibility/schedule-run.ts`,
  `src/lib/agents/runner.ts`, `src/routes/snapshot.ts` — `setImmediate` →
  `JobQueue`.
- `src/lib/measurement/schedule-remeasurement.ts`,
  `src/lib/ai-visibility/pipeline.ts`,
  `src/lib/agents/run-ai-visibility-step.ts`,
  `src/lib/content/draft-generator.ts`, `src/lib/crawler/engine.ts`,
  `src/lib/free-snapshot/orchestrator.ts`, `src/routes/ai-runs.ts` — stale
  `setImmediate`-referencing comments updated for accuracy.
- 41 route files — `authenticatedRateLimit` wired onto every
  `requireAuth`-gated handler (item 2); see `apps/api/DECISIONS.md`'s new
  "Rate limiting (Epic 19 follow-up)" section for the full file-by-file
  reasoning; the same files' `.test.ts` counterparts (20 of them) gained
  the `organization_rate_limits` mock.
- `src/routes/crawl-jobs.ts` (+`.test.ts`) — new `GET /brands/me/
  crawl-jobs` list route (item 5).
- `src/routes/accounts.ts` (+`.test.ts`), `src/routes/actions.ts`
  (+`.test.ts`), `src/routes/agency.ts`, `src/routes/agents.ts`,
  `src/routes/ai-runs.ts`, `src/routes/competitor-ai-runs.ts`,
  `src/routes/competitors.ts`, `src/routes/brand-claims.ts`,
  `src/routes/brand-entities.ts`, `src/routes/use-cases.ts`,
  `src/routes/integrations.ts`, `src/routes/orgs.ts`, `src/routes/auth.ts`,
  `src/routes/query-sets.ts`, `src/routes/seo.ts`,
  `src/routes/content-brief-details.ts`, `src/routes/content-drafts.ts`,
  `src/routes/agent-run-details.ts` — pagination caps added (item 6).
- `DECISIONS.md` — new "Job queue," "Error tracking," "Rate limiting (Epic
  19 follow-up)" sections.
- `package.json` — new dependencies `pg-boss@^12.30.0`,
  `@sentry/node@^10.73.0`.

**Root:**
- `package.json` — new `pnpm.overrides.deepmerge-ts: ^8.0.0` (item 7).
- `pnpm-lock.yaml` — updated accordingly.

**`packages/database`:** untouched (no schema change needed for any of the
7 items) — no new migration folder.

---

## Verification

- `pnpm --filter @bebest/api typecheck` (`tsc --noEmit`) — clean.
- `pnpm --filter @bebest/api test` — **993 passed**, 0 failed, 1 file
  intentionally skipped (`tenant-isolation.integration.test.ts`, 79
  `.todo` scenarios requiring a live DB, unchanged by this epic), 79 `
  .todo` inside other files, across 108 test files (34 new tests added by
  this epic: 21 `JobQueue`, 13 `ErrorTracker`, plus the item-5/item-6
  additions inside `crawl-jobs.test.ts`/`actions.test.ts`/
  `accounts.test.ts`).
- `pnpm --filter @bebest/database typecheck`/`test` — clean, 7/7 (confirms
  the `deepmerge-ts` override didn't affect Prisma client codegen/usage).
- `pnpm --filter @bebest/web typecheck` — clean (sanity check; this epic's
  backend half touches no frontend file, but the root `pnpm install` for
  item 7's override updates the shared lockfile).
- `pnpm audit` (whole monorepo) — **no known vulnerabilities found**.

---

## What's not done

- **`PgBossJobQueue`/`SentryErrorTracker` are never connected** — by this
  build's own hard constraint. Both are real, complete, unit-tested
  implementations; wiring either one up for real is a config change
  (`default-job-queue.ts`/`default-error-tracker.ts`, one constructor call
  + a real credential), not a code change, per this epic's own definition
  of done.
- **`lib/measurement/schedule-remeasurement.ts` still uses its own
  closure-based scheduler**, not `JobQueue` — a deliberate, documented
  exception (see item 1 above and that file's own header comment). A
  process restart still loses a pending re-measurement timer, exactly as
  its `// TODO` said before this epic. Real fix: give it its own job type
  + serializable payload + registered handler, then route through
  `JobQueue.enqueue(..., {delayMs})`.
- **`routes/query-sets.ts`'s `GET /:id/queries` has a `5000`-row technical
  ceiling, not real pagination** — see item 6's "one deliberate exception"
  above. Only a real risk for the two `null`-limit (uncapped) plans if a
  single query set ever legitimately exceeds 5,000 rows; no such case
  exists in this build's fixtures/tests. Real fix needs a coordinated
  frontend change (the response is currently a flat array).
- **Two pre-existing, already-tracked `[dev email]` `console.log`
  stand-ins** (`routes/billing-webhooks.ts`, `routes/orgs.ts`) were
  confirmed NOT to be structured-logging stragglers (item 4) but were left
  untouched — they're a different, already-named gap (bypassing
  `EmailSender`), out of this epic's named scope.
- **D-O05 ("Queue system") and D-O14 ("Error tracking")** remain formally
  OPEN in the root `DECISIONS.md`'s Open Decisions table. This epic makes
  the spec's named choices (pg-boss, Sentry) concretely implementable — it
  does not itself close either decision, which needs a real sign-off this
  build environment can't produce.
- **Frontend half** (error-boundary quality; confirming every list view
  added since Epic 0 has real pagination controls, not an unbounded
  fetch-everything call) is a separate agent's work, per the epic spec's
  own split — not attempted here.
