# @bebest/api — decisions vs. the original implementation

Port source: `api/src/{lib,middleware,routes}/*` (specifically `jwt.ts`,
`rbac.ts`, `db.ts`, `plans.ts`, `middleware/*`, `routes/auth.ts`,
`routes/orgs.ts`). This lists every deliberate deviation and why.

## Auth

- **HS256 → RS256.** The old `jwt.ts` used HMAC (`HS256`) with a single
  shared secret for both signing and verifying. `docs/08-security/
  SECURITY.md` requires RS256. Beyond just "the doc says so": RS256 means
  only this process needs the private key; anything that only needs to
  verify tokens (a future separate service, a CDN edge check, etc.) can
  hold just the public key. Implemented in `src/lib/jwt.ts` via `jose`'s
  `importPKCS8`/`importSPKI`.
- **Password auth removed.** The old `routes/auth.ts` had `/register`,
  `/login` (argon2), and password-reset endpoints alongside magic link.
  SECURITY.md's primary method is magic link; password auth is not
  mentioned at all. Rather than port dead-weight password flows (and their
  argon2 dependency), Epic 0 implements magic-link-only, and
  `users.password_hash` is nullable in the new schema specifically to
  support accounts that never set one. If a later epic decides password
  auth is needed, it's additive, not a rework.
- **Refresh tokens: 30 days → 7 days, and DB-backed session revocation
  added.** SECURITY.md specifies 7 days with rotation on use. The old code
  used 30 days and had a `refresh_tokens` table but no `sessions` table
  wired into the rotation flow, so there was no way to revoke "this
  device" without deleting/rotating every refresh token for a user. The
  new `routes/auth.ts` creates a `sessions` row at login, threads
  `session_id` through every rotation, and checks `session.revoked_at` on
  refresh — so logout can (and a future "sign out this device" feature
  could) revoke one session's lineage without touching others.
- **No `role` claim in the access token.** SECURITY.md's literal claim
  list is `sub, org, role, iat, exp`. This implementation omits `role`
  deliberately — see `src/lib/jwt.ts`'s top comment. Putting role in the
  token creates a standing temptation to read `payload.role` somewhere and
  skip the DB check, which is exactly the mistake SECURITY.md's own RBAC
  section forbids ("Never rely on client-sent role — always read from
  database"). `tenant-context` middleware re-reads role from `memberships`
  on every single request; there was never a version of this codebase
  where a stale/forged role claim could do anything.
- **`org` claim is a two-step "select an organization" flow, not present
  at login.** A user can belong to several orgs; there is no correct
  "the" org to embed in the very first token issued at login. `POST
  /auth/select-org` verifies membership and mints a new, org-scoped access
  token. `tenant-context`'s `requireOrgFromToken` reads that claim as a
  hint and still re-verifies membership before trusting it.
- **Dev auth bypass hardened, not removed.** The old `middleware/auth.ts`
  had an `X-User-Id` bypass gated only on `NODE_ENV !== 'production'`.
  Kept (it's genuinely useful for local dev and tests), but now requires a
  SECOND explicit opt-in, `ALLOW_DEV_AUTH_BYPASS=true`, specifically so a
  deployment can't end up with it active just because someone forgot to
  set `NODE_ENV=production` — two independent mistakes are required now,
  not one.

## RBAC

- **Permission matrix encoded as data**, not scattered `if (role === ...)`
  checks. The old `rbac.ts` had only a numeric role-rank hierarchy
  (`owner > admin > member > viewer`), which cannot express SECURITY.md's
  actual matrix — e.g. "editor can approve only their own drafts" or
  "owner-only billing" aren't hierarchy facts, they're per-action facts.
  `src/lib/rbac.ts`'s `PERMISSION_MATRIX` transcribes the SECURITY.md table
  verbatim; `hasPermission(role, action, opts)` is the single place that
  answers "can this role do this."
- **Role enum widened** (see `@bebest/database` DECISIONS.md §9) from
  `{owner, admin, member, viewer}` to
  `{owner, admin, analyst, editor, viewer, member}`. `analyst` and `editor`
  are the same hierarchy RANK in `isAtLeast` (neither is senior to the
  other — they have different, non-overlapping permissions), which is a
  genuine (and correct) departure from a strictly-linear hierarchy.

## Tenant context

- **New middleware, doesn't exist in the old code as a separate concept.**
  The old `requireOrgRole` (in `middleware/auth.ts`) conflated
  "authenticate" and "resolve+authorize org" into one function keyed only
  off a `:slug` route param. This implementation splits it:
  `middleware/auth.ts`'s `requireAuth` only authenticates;
  `middleware/tenant-context.ts` resolves org context, with two entry
  points (`requireOrgBySlug` for URL-addressed org resources,
  `requireOrgFromToken` for the JWT-`org`-claim case the task brief asked
  for explicitly). Both share one `resolveOrgContext` function so there is
  exactly one place that reads `memberships`.
- **`memberships` queries use `withUserContext` OR `withOrgContext`
  depending on the access pattern, never plain `db`.** This is a
  `@bebest/database` RLS design detail (see that package's DECISIONS.md
  §7a — the policy is an OR of a user-scoped and an org-scoped clause).
  `routes/auth.ts`'s `/me` and `/select-org`, and `routes/orgs.ts`'s
  "list my orgs" and invitation-accept, use `withUserContext` (reading the
  CALLER's own rows across orgs). `routes/orgs.ts`'s "list members",
  "change a member's role", and "remove a member" use `withOrgContext`
  (reading OTHER users' rows, all within one already-authorized org).
  Using the wrong one isn't a subtle performance issue — it's a hard
  failure: `withUserContext` for "list members" would return only the
  caller's own membership row, silently hiding every teammate.
- **`invitations` queries use plain `db`, not `withOrgContext`, on
  purpose.** This table has no RLS at all (see `@bebest/database`
  DECISIONS.md §7b) because accepting an invitation happens before the
  caller has any org to prove membership of. `routes/orgs.ts`'s
  invitation create/cancel calls still filter by `organization_id`
  explicitly in their `WHERE`/`data` clauses — there is just no second,
  database-enforced check backing that filter for this one table.

## Audit logging

- **New — the old code had no `audit_events` writes at all** despite
  SECURITY.md requiring them for a specific list of actions. `lib/audit.ts`
  + `middleware/audit-log.ts` are new. Wired onto organization deletion and
  role changes (both explicitly on SECURITY.md's "always audited" list) and
  auth login/logout as a demonstration of the pattern; the remaining items
  on that list (billing changes, content publishing, agent actions, API
  key lifecycle, data export) don't have routes yet (later epics) but
  `ALWAYS_AUDITED_ACTIONS` in `lib/audit.ts` exists precisely so whoever
  builds those routes has the vocabulary already defined instead of
  inventing new action-name strings ad hoc.

## Rate limiting

- **In-memory `Map` → Postgres-backed (`organization_rate_limits`).** The
  old `middleware/{ratelimit,rate-limit}.ts` (note: there were TWO
  near-duplicate files in the old codebase, both in-memory, one clearly
  dead code — this implementation has exactly one) explicitly commented
  "Replace with Redis/pg-based in production." This is that replacement:
  `lib/rate-limiter.ts` does a single atomic upsert per fixed window
  against a durable table, so limits survive a process restart and are
  shared correctly across multiple API instances (an in-memory `Map`
  is per-process — under 2+ instances behind a load balancer, the old
  approach effectively multiplied every limit by the instance count).
- Limits match SECURITY.md's table exactly (30/min public, 5/15min auth,
  1/hour free-snapshot, 120/min authenticated, 10/min/org AI queries,
  30/min admin) — the old code's hardcoded limiters (`apiRateLimit: 100/min`,
  `authRateLimit: 10/min`, `crawlRateLimit: 5/min`) didn't match the
  documented table at all.

## Email

- **New abstraction — the old code called `console.log` directly** inline
  in `routes/auth.ts` and `routes/orgs.ts` with a `// TODO Epic 3+: send via
  Resend` comment. `lib/email.ts`'s `EmailSender` interface +
  `ConsoleEmailSender` turns that TODO into an actual seam: `routes/auth.ts`
  takes an `EmailSender` via `createAuthRoutes(emailSender)` specifically so
  the eventual `ResendEmailSender` is a single new class plus one changed
  line in `app.ts`. (`routes/orgs.ts`'s invitation email was NOT converted
  to this pattern yet — see README.md's "not done" list.)

## Job queue (Epic 19 — Production Hardening)

- **`setImmediate` → `JobQueue` interface.** Every background job this
  codebase scheduled with a raw `setImmediate` call (Epic 3's crawler,
  Epic 7/8's AI-visibility pipeline, Epic 12's agent runner, Epic 17's
  free-snapshot pipeline) now goes through `lib/queue/job-queue.ts`'s
  `JobQueue` interface instead. `InMemoryJobQueue` (the default, via
  `lib/queue/default-job-queue.ts`'s process-lifetime singleton) is
  functionally equivalent to the `setImmediate` it replaces — still fires
  via `setImmediate` under the hood, still loses in-flight work on a
  process restart, same honestly-documented gap every one of those four
  `// TODO: durable queue` comments already named, now centralized in one
  place. `PgBossJobQueue` is a real, complete implementation on the
  `pg-boss` package (added as a dependency in this epic) — correct code,
  never constructed or `.start()`-ed anywhere in this build (same
  `NullXProvider` discipline `lib/billing/payment-provider.ts`'s
  `NullPaymentProvider` and `lib/email.ts`'s `ConsoleEmailSender`
  establish). Swapping to durable execution is a one-line change in
  `default-job-queue.ts` (construct `PgBossJobQueue` with a real connection
  string, call `.start()` once at server boot) — no call-site changes,
  because every call site already goes through the interface, never a
  concrete class.
- **`lib/measurement/schedule-remeasurement.ts` deliberately NOT migrated**
  onto `JobQueue` in this pass — see that file's own header comment. It
  solves a different problem (a real 4-week-delayed trigger with an
  injectable closure-based clock, already tested 8 ways) than the other
  four call sites (fire essentially now, in the background). Its
  `deps.schedule` API takes a raw closure, which can't be serialized into
  a `JobQueue` payload without a real redesign (a dedicated job type +
  `{actionId, organizationId}` payload + registered handler) — attempting
  that as a drive-by rename risked its existing tests for no durability
  gain (a raw closure was never going to survive a process restart via
  `InMemoryJobQueue` either way). Tracked as real follow-up work, not
  silently dropped.

## Error tracking (Epic 19 — Production Hardening)

- **Bare inline `console.error` → `ErrorTracker` interface.** `app.ts`'s
  global `onError` handler now calls `lib/observability/
  default-error-tracker.ts`'s `getDefaultErrorTracker().captureException`
  instead of building and logging the JSON line inline. `ConsoleErrorTracker`
  (the default) writes the exact same structured-JSON shape the inline code
  wrote before this epic — no observable behavior change. `SentryErrorTracker`
  is a real, complete implementation on `@sentry/node` (added as a
  dependency in this epic) — correct code, `Sentry.init()` only runs inside
  its own `.init()` method, which nothing in this codebase calls (same
  never-actually-connected discipline as `PgBossJobQueue` above). D-O14
  ("Error tracking") in the root `DECISIONS.md`'s Open Decisions table is
  NOT closed by this — Sentry is this epic's spec's named choice to make
  concretely implementable, not a formal sign-off with a real account/DSN.
- **`ErrorContext` is a narrow identifier allowlist** (`requestId`,
  `method`, `path`, `organizationId`, `userId`) — never the raw Hono
  `Context`, headers, or request/response bodies. Both implementations are
  structurally unable to leak an `Authorization` header or a magic-link/
  refresh token into whatever's logged/tracked, because the type callers
  pass has no field to carry one. `SentryErrorTracker` additionally sets
  `sendDefaultPii: false` on `Sentry.init()` as defense in depth against
  Sentry's own default request-data capture.

## Rate limiting (Epic 19 follow-up — `authenticatedRateLimit` wiring)

- **`authenticatedRateLimit` (120/min) had zero call sites** anywhere in
  this codebase before this epic, despite being fully implemented in
  `middleware/rate-limit.ts` since Epic 0 — every `requireAuth`-gated route
  (all of them) was silently running on the baseline `publicRateLimit`
  (30/min) applied app-wide in `app.ts`, far tighter than SECURITY.md's own
  "Authenticated (general): 120 requests / 1 minute" row promises. Fixed by
  adding `authenticatedRateLimit` immediately after `requireAuth` in every
  handler chain that has it, across every route file (~41 files, ~90 call
  sites) — `publicRateLimit` remains the ONLY limiter on genuinely public/
  unauthenticated routes (`snapshot`, `apply`, `auth`'s magic-link/verify/
  refresh endpoints). The already-real Postgres-backed limiter
  (`lib/rate-limiter.ts`, `organization_rate_limits`) needed no changes —
  this was purely a wiring gap, not a durability gap.

## Scope cuts vs. the old `api/` app (by design, not oversight)

The old `api/src/routes/` directory has ~35 route files (brands, crawl,
keywords, billing, CRM, AI runs, opportunities, content, agents, publishing,
experiments, learning, reports, white-label, etc.). Epic 0's brief is
platform foundation only: auth, orgs, RBAC, tenant isolation, audit,
rate limiting. None of the domain routes were ported — they belong to
Epics 1–19 per `platform/EPICS.md`, each of which owns its own schema
hardening review (already done for the whole schema at once in
`@bebest/database`, so those epics inherit hardened tables) and route
implementation.

## Test isolation (QA follow-up: flaky `brands.test.ts` / `crm-access.test.ts`)

A QA pass reported `pnpm --filter @bebest/api test` occasionally failing a
single test with a 500 instead of the expected 4xx, on a different test
file each time (once `routes/brands.test.ts`, once
`middleware/crm-access.test.ts`), while every affected file passed cleanly
run on its own — the signature of shared mutable state leaking between
test files that happen to share a worker.

**What it wasn't.** `lib/rate-limiter.ts` (the suspect named in the
original report) holds no in-memory state at all — see this file's own
"Rate limiting" section above; the `Map`-based limiter was already fully
replaced by the Postgres-backed one before this pass, so there is no
module-level counter left to leak. Every mock singleton in the suite
(`db.*` vi.fn()s, `withUserContext`/`withOrgContext`) is declared fresh
per test file and none are exported/shared across files.

**What it was.** `middleware/auth.test.ts`'s last test ("the dev bypass
never activates in production even if the flag is set") set
`process.env.NODE_ENV = 'production'` and reset it back to `'test'` with a
plain statement at the *end of the test body*. Every other test file in
this suite that mutates a shared `process.env` key (`crm-access.test.ts`,
`internal-org.test.ts`, `accounts.test.ts`, `activities.test.ts`,
`deals.test.ts`, `leads.test.ts`) instead captures the key's original
value once and restores it unconditionally in `afterEach` — `auth.test.ts`
was the one file that didn't follow that discipline. A plain
end-of-test-body reset only runs if every assertion above it in that same
test passes; if that test ever regressed (or was ever affected by a slow
CI run turning an assertion into an exception before reaching the reset
line), `NODE_ENV` would stay stuck at `'production'` for the rest of the
worker process — and Vitest's default `pool: forks`/`threads` can and does
reuse a worker process/thread across multiple test files when there are
more files than CPU cores, so that leak would surface as an unrelated,
unpredictable test file failing in a later file that happens to land in
the same worker, exactly matching the reported symptom.
(Confirmed by instrumenting every test file to log its process id: under
this repo's actual defaults — `isolate: true`, the default for both
`pool: forks` and `pool: threads` — Vitest tears down and restarts the
worker per test file specifically to prevent this class of bug, which is
why the leak could not be forced to reproduce on a 12-core dev box even
under `--pool=threads --maxWorkers=2` and other Node/CI setups that force
worker reuse; it would only fire under `--no-isolate` or a hypothetical
future change to that default. It was still exactly the shared-state gap
QA's report described, present as latent risk rather than an active
failure in this environment.)

**Fix.** `auth.test.ts` now captures `NODE_ENV` and
`ALLOW_DEV_AUTH_BYPASS`'s original values once (module scope, before any
test runs) and restores both unconditionally in `afterEach`, matching the
capture-and-restore-in-`afterEach` pattern already used consistently by
every other env-var-mutating test file in this suite. The inline
end-of-test reset was removed — cleanup no longer depends on the test body
reaching its last line.

**Verification.** `pnpm --filter @bebest/api test` run 5 consecutive times
(identical: 23 files passed / 1 skipped, 178 tests passed / 29 todo, every
run) plus additional stress runs forcing worker reuse
(`--pool=threads --maxWorkers=2 --minWorkers=2`, 3 runs) to confirm the
fix holds even under configurations that maximize the chance of a
process.env leak surfacing.

---

## AI cost metering — where `organization_id` is threaded in (2026-09-25)

**Decision.** Metering lives in an app-side decorator, `MeteredAIProvider`
(`src/lib/ai-usage/metered-provider.ts`), obtained through
`getMeteredAiProviderRegistry(attribution)`. `@bebest/ai-provider` gained a
price table (`pricing.ts`) and richer usage/finish-reason reporting, but no
database access and no concept of a tenant.

**The alternatives, and why they lost.**

1. *Meter inside each provider in `packages/ai-provider`.* Rejected. That
   package's stated contract is that it persists nothing ("this package does
   not persist anything itself — no database access here", `types.ts`). Doing
   the write there would put Prisma, `withOrgContext` and `organization_id`
   inside the one package whose purpose (ADR-003) is to be the only thing
   that knows how to talk to a vendor, and would make the pure package
   depend on `@bebest/database`.
2. *Add `organizationId` to `CompletionRequest`.* Rejected. It changes the
   `AIProvider` interface that every route, pipeline and agent depends on,
   and — worse — it makes tenancy a per-call argument that a call site can
   forget or get wrong. A forgotten field is exactly the silent leak this
   work exists to close.
3. *Meter at call sites.* Rejected outright, per the task's own framing: the
   next feature forgets, and the leak reopens with no test failing.

**What the decorator buys.** The org travels with the *registry instance* a
caller asks for, not with each request object, so `AIProvider` is
byte-identical and no caller signature changed. Four call sites now ask for a
metered registry (`lib/ai-visibility/pipeline.ts`, `lib/agents/runner.ts`,
`lib/free-snapshot/ai-run.ts`, `routes/content-brief-details.ts`).
`getDefaultAiProviderRegistry()` survives ONLY for the three callers that
read the routing table (`resolveNames('geo.query')`) without making a model
call; `lib/ai-usage/metered-provider.test.ts` enforces that allowlist by
scanning `src/`, so adding an unmetered AI call fails a test.

**Why it extends `BaseAIProvider` rather than delegating `extract()`.**
`extract()` retries until the JSON validates and every attempt is separately
billed. Delegating to `inner.extract()` would route those retries through the
*inner* provider's `this.complete()`, bypassing the decorator, so only the
final attempt would ever be metered — an under-count concentrated precisely
on the badly-behaving, expensive calls. Extending `BaseAIProvider` reuses the
same shared retry loop while each attempt goes through the metered
`complete()`.

**RLS and the awkward cases.** The write goes through `withOrgContext`, so it
runs inside a transaction with `app.current_org` set and satisfies
`ai_usage`'s `WITH CHECK` policy. Every writer is a background path (AI
Visibility pipeline, agent runs, free-snapshot orchestrator) with no HTTP
request to inherit context from; they get it from the attribution their
registry was built with. Anonymous free-snapshot spend has no org at all, and
`ai_usage.organization_id` is `NOT NULL` with RLS on read and write (a NULL
row would be write-only data, invisible even to the role that wrote it), so it
is attributed to `CRM_INTERNAL_ORG_ID` — an already-established concept here
(Epic 1 CRM, `lib/internal-org.ts`) for BeBest's own tenant, which runs no
customer pipelines. See `GO_LIVE.md` §6 for the consequence: that spend is
visible in aggregate but not separable from internal CRM AI spend without a
new `feature` column.

**Non-negotiable.** A metering failure never fails the AI call or loses the
response. `recordAiUsage` swallows its own errors AND the decorator wraps the
recorder call in its own try/catch, so a future recorder that throws still
cannot destroy a paid-for response. Both are tested.

**Deliberately out of scope** (follow-up, and the reason `estimateCost()` is
exported as a pure function): the response cache, dollar-based entitlement
enforcement, and the pre-flight run cost estimator. This is the sensor, not
the valve — nothing here blocks, throttles or refuses a call.

## HTTP/worker process split (2026-09-25)

- **`apps/api` now deploys as two processes from one codebase**, not one.
  `api/index.js` → `dist/app.cjs` serves HTTP on Vercel serverless and only
  ENQUEUES; `src/worker.ts` → `dist/worker.cjs` runs on a persistent host and
  is the only process that CONSUMES. The alternative — moving the whole API to
  a persistent host — was considered and rejected: the HTTP side works on
  Vercel, only the jobs need a process that outlives a request. See
  `GO_LIVE.md` §5.
- **Why it was forced.** An AI Visibility baseline run is ~1,400 prompts x 4
  models (x competitors): thousands of AI calls, hours of wall time. Run via
  `InMemoryJobQueue` inside a Vercel function, it was frozen the instant the
  202 returned, leaving `ai_runs` in `running` forever. The flagship feature
  could not complete.
- **Registration is data, checked twice, not a module-load side effect.**
  `lib/queue/job-types.ts` declares every job type with no imports and no side
  effects. `lib/queue/job-registry.ts` maps each to its `JobDefinition` and
  `assertJobHandlerCoverage()` refuses to boot the worker if any declared type
  has no handler. `lib/queue/job-registry.test.ts` additionally scans the
  source tree so an `enqueue()` that does not use `JOB_TYPES.*` fails the
  suite. The previous shape — each module calling
  `getDefaultJobQueue().register()` at import time — is wrong in both
  directions under a split: the HTTP process would register handlers it can
  never run, and the worker would consume nothing it did not happen to import.
- **`lib/queue/register-in-process.ts` keeps single-process dev/test
  unchanged.** It registers on the default queue only while
  `JOB_QUEUE_DATABASE_URL` is unset. That one variable is the whole switch:
  unset → `InMemoryJobQueue` and handlers fire in-process exactly as before
  (which is why the 1,156-test baseline needed no changes); set →
  `PgBossJobQueue`, and the HTTP process registers nothing.
- **Enqueues are awaited now, not `void`-ed.** With a durable queue the enqueue
  is a real INSERT. `void enqueue(...)` let a serverless function return its
  202 and freeze before the row landed, losing the job silently. So
  `scheduleAiVisibilityRun`, `scheduleCrawlJob`, `scheduleFreeSnapshot` and
  `scheduleAgentRun` all return promises their callers await.
- **`releaseOnShutdown` is part of every job definition.** A worker is
  SIGTERM'd on every deploy, and with hours-long runs that lands mid-run more
  often than not. `lib/queue/in-flight-jobs.ts` tracks what is running;
  shutdown stops fetching, waits a bounded grace period, then marks whatever
  is still in flight `failed` using the same best-effort write each handler's
  own error path already used. A deploy mid-run yields a visibly failed,
  retryable run instead of a permanently hung one. It does NOT resume work —
  resumable runs are separate.
- **Job handlers moved out of route files.** `routes/crawl.ts`'s and
  `routes/snapshot.ts`'s handlers now live in `lib/crawler/crawl-job.ts` and
  `lib/free-snapshot/snapshot-job.ts`, so the worker can import a handler
  without importing a Hono route tree.
- **RLS applies identically in the worker.** It connects as `bebest_app` (no
  BYPASSRLS) and every handler and release path sets `app.current_org` via
  `withOrgContext` before touching a tenant table —
  `lib/queue/job-tenancy.test.ts` asserts it, including that the unscoped `db`
  client is used for exactly one table (`snapshot_requests`, which has no
  `organization_id` and is therefore not a tenant table).

## The priced run vs. the executed run (2026-09-25)

The dollar valve (`lib/ai-usage/run-preflight.ts`) prices a run at DISPATCH
time; `lib/ai-visibility/pipeline.ts` re-reads the query set LIVE at EXECUTION
time, which is correct (a run must measure the set as it stands) but means the
two are different reads separated by the queue. The certificate named an org and
a dollar figure and nothing else, so nothing connected them.

- **The certificate now states its SIZE** (`RunCostPreflight.pricedQueryCount`),
  and `ai_runs` persists it alongside the projected micro-dollars and the
  pricing-table version (migration 0023). Persisting the projection is what
  makes an overspend detectable afterwards at all — it can be set against the
  org's real `ai_usage` rows; previously the approved number existed only for
  the length of one HTTP request.
- **Execution refuses a set that grew** (`assertRunWithinPricedSize`, called
  before the run is marked `running` and before any provider call). A set that
  SHRANK proceeds — the work is then strictly cheaper than what was approved.
- **A run carrying no price cannot execute.** Fail closed: "never
  cost-approved" must not be readable as "unlimited". The three dispatchers
  (`routes/ai-runs.ts`, `routes/competitor-ai-runs.ts`,
  `lib/agents/run-ai-visibility-step.ts`) all stamp the same
  `pricedRunColumns()` fragment, and `scheduleAiVisibilityRun` refuses to queue
  a row whose stamp disagrees with the certificate it was handed.
- **Not continuous enforcement.** Once an approved run starts it runs to
  completion; there is still no per-call budget check mid-run. This closes the
  gap between the price and the START of execution, which is where the size
  could change behind the valve's back.

Deploy note: runs already queued when 0023 ships carry no price and will fail
with `RunNotPricedError`. Drain the AI-visibility queue first, or re-dispatch
them.

## Billing webhooks: atomicity and ordering (2026-09-25)

`routes/billing-webhooks.ts` dedupes on `billing_webhook_events.processed_at`,
but `processed_at` used to be the last of four sequential writes. That made a
replay idempotent for the subscription's STATE and not for its EFFECTS: a crash
between the effects and the marker left the event looking unprocessed with its
transition, its `organizations.update` and its audit rows already committed, so
the provider's retry re-ran all of them — possibly over a state a later event
had since set. Separately, `occurredAt` was handed to the state machine and
compared against nothing, so events applied in ARRIVAL order, and Stripe
guarantees no order (its own retries reorder aggressively).

- **One transaction.** The fresh read, the ordering check, the state write, the
  org status, the audit rows and `processed_at` all happen inside a single
  `withOrgContext` transaction. `setSubscriptionPlanWithin` and
  `writeAuditEventWithin` exist for that reason — the plan_id/plan sync rule and
  the audit row shape each stay in exactly one place rather than being copied
  for the transactional path.
- **`writeAuditEventWithin` THROWS**, inverting `writeAuditEvent`'s
  never-throw contract on purpose: inside a transaction a failed INSERT has
  already aborted everything after it, and for this caller the right outcome is
  that the billing change rolls back and the provider retries, not that it lands
  unaudited.
- **Ordering is decided on provider time.** `subscriptions.last_billing_event_at`
  is the `occurredAt` of the newest event already applied; strictly older events
  are acknowledged (200 — otherwise Stripe retries for days) and recorded with
  `skipped_reason = 'superseded_by_newer_event'` plus a
  `billing.webhook_superseded` audit row. Equal timestamps still apply: Stripe's
  `event.created` is second-resolution and inventing an order for same-second
  events would be a guess.
- **A `SELECT ... FOR UPDATE` on the subscription row** serializes concurrent
  deliveries for one customer; without it two events read the same "current"
  state and the ordering guard loses to a race rather than to a stale delivery.
- **Emails are sent AFTER the commit and are therefore at-most-once.** Sending
  is an external call with no rollback. After the commit, a crash drops one
  notification; before it, a rolled-back transition could have told a customer
  their payment failed. Exactly-once dunning mail needs an outbox table, which
  is separate work.
- Unchanged, deliberately: HMAC verification before any parsing, and the
  200-ack with no row for `UnsupportedWebhookEventError`.

Still not covered: a user-initiated plan change (`routes/subscription.ts`) does
not advance `last_billing_event_at`, so a stale provider event can still land on
top of one. Stripe emits its own event for that change with a newer timestamp,
which then becomes the watermark, but the window exists.
