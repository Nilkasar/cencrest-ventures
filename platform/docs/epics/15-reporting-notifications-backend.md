# Epic 15 — Reporting & Notifications (backend): completion summary

Backend-only, per this epic's brief — `platform/apps/api` (`@bebest/api`)
and `platform/packages/database` (`@bebest/database`). Branch
`rebuild/platform`, no other branch touched, nothing under `api/`,
`web-app/`, or the repo-root marketing site was modified. **Frontend is not
built** — a separate agent wires the "Reports" screen (board-presentable
report view + bell-icon notification center,
`docs/09-ux/CUSTOMER_JOURNEY.md`) against the real routes/response shapes
documented below.

**No git commands were run.** **No database was connected to at any point**
— `prisma validate`/`prisma generate` were run repeatedly (schema-only,
`DATABASE_URL` set to a dummy value so the CLI has something to parse; no
connection attempted). No `migrate`, `db push`, or `db pull` was run, per
the hard constraint. **No real network call to any external provider was
made anywhere in this build** — the email channel goes through Epic 0's
`EmailSender` interface, backed by `ConsoleEmailSender` (logs instead of
sending), exactly like every prior epic's email path.

Migration folder used: **`0018_reporting_notifications`** (checked the
migrations directory immediately before creating it — `0018` was
unclaimed; 0000 through 0017 already existed).

---

## The design decision this epic's task brief left open: new tables vs. reusing pre-existing ones

Resolved as **reuse, widened forward** — not new tables. Grepping
`schema.prisma` before writing anything (this codebase's own standing
"always verify against schema.prisma directly" discipline) found that
`reports` and `notifications` already existed — carried over from the
original ported schema (Epic 0), with their `tenant_isolation` RLS policy
already applied in `0000_init/rls.sql`. A second grep across
`apps/api/src` confirmed zero route or lib code had ever read or written
either table before this epic — they were genuinely dormant, not
half-built by an earlier pass.

Rather than invent a second, differently-shaped pair of tables to match
the spec's prose exactly, both were widened — the same "reuse the
pre-existing hardened table, don't invent a parallel one" precedent Epic
18 already set for `white_label_configs`. Full reasoning, including the
two real widenings on `notifications` (`user_id` NOT NULL -> nullable,
`onDelete` Cascade -> SetNull) and why `reports.type` stays a checked
VARCHAR rather than becoming a Prisma enum: `packages/database/
DECISIONS.md` §29.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **`reports`** (pre-existing, widened) — added `period_start`/
  `period_end`/`generated_at`/`content` (JSONB, required — the immutable
  snapshot). Untouched legacy columns (`name`/`format`/`status`/
  `metadata`/`file_path`/`created_by`/`completed_at`) are reused as-is;
  `file_path` doubles as this epic's `pdf_url`. `type` stays
  `String @db.VarChar(50)`, enforced by a new `chk_reports_type` CHECK
  (`weekly|monthly|custom|baseline_comparison`).
- **`notifications`** (pre-existing, widened) — `user_id` NOT NULL ->
  nullable (org-wide vs. per-user, this epic's literal domain-model
  requirement), `onDelete` Cascade -> SetNull to match; added
  `channel notif_channel` (previously only a column on the sibling
  `notification_preferences` table) and `sent_at`.
- **`notification_type`** enum — added `weekly_digest` and
  `entitlement_warning` (the spec's own literal domain-model examples).
  `entitlement_warning` has no live caller in this build (see "Honest
  scope boundaries" below).
- **`prisma/migrations/0018_reporting_notifications/`** — `checks.sql`
  only (`chk_reports_type`). No `rls.sql`: both tables already have their
  `tenant_isolation` policy from `0000_init`, and none of the new columns
  need a policy of their own.
- `src/client.ts` / `src/index.ts` — export `reports`, `notifications`,
  `notification_type`, `notif_channel`.
- No back-relations needed adding — `organizations`/`users`/`brands`
  already had `reports[]`/`notifications[]` from the original port.
- `prisma validate` + `prisma generate` clean; `tsc --noEmit` clean.
- Full reasoning: `packages/database/DECISIONS.md` §29.

### `platform/apps/api` (`@bebest/api`)

**The shared notification mechanism** (`src/lib/notifications/`):

- **`notify.ts`** — `notify(params, deps?)`, the ONE function every
  notification in this codebase should route through. Writes ONE row per
  channel actually attempted: an `in_app` row always (immediately
  "sent"); an `email` row only when `userId` is set AND that user has a
  real email on file (`db.users.findUnique`) — org-wide (`userId: null`)
  notifications are in-app only, a documented scope boundary, not a
  guessed fan-out rule. Email delivery goes through Epic 0's real
  `EmailSender` interface, which gained a new generic method,
  `sendNotification({ to, subject, body })` (`ConsoleEmailSender`
  implements it by logging, same pattern as every other method on that
  interface). Email-send failure never throws — the email row still
  exists with `sent_at: null`, and a `notification.sent` audit event is
  written either way (`result: 'success'|'failure'`). `deps.emailSender`
  defaults to a fresh `ConsoleEmailSender` when omitted, same "optional
  deps, defaulted at the call site" shape `lib/free-snapshot/
  orchestrator.ts` already uses.
- **`serialize.ts`** — `serializeNotification`.

**Grep audit — what was actually consolidated.** This epic's spec
requires grepping for existing ad hoc notification logic before adding a
parallel mechanism. Neither Epic 12 nor Epic 8 had a real second
email-sending path to delete:
  - Epic 12's `lib/agents/runner.ts` header comment said so verbatim —
    "no email/notification infra to wire step 9 into yet." Its `run_
    complete` moment existed only as a DB status update on `agent_runs`.
    **This epic adds the first real call site** — `executeAgentRun` now
    calls `notify()` after finalizing every run (success or failure),
    addressed to the triggering user when `triggeredBy === 'user'`,
    org-wide for a schedule/event-triggered run. Wrapped in its own
    try/catch, deliberately placed AFTER the `agent_runs` status update
    commits, so a notification failure can never retroactively flip an
    already-completed run's status to `failed` via the outer
    `scheduleAgentRun` catch handler (a real failure mode caught and
    fixed while writing this, see `runner.test.ts`'s dedicated proof).
  - Epic 8's `lib/ai-visibility/competitive.ts` header comment says the
    same — "the schedule trigger is deferred to Epic 12's Competitor
    Agent" (never built). `computeCompetitorMovement` is a pure
    comparison function with no caller that ever sent anything.
    **This epic's own weekly-digest generator is the first real,
    recurring trigger point** — `lib/reporting/notify-for-report.ts`
    fires a `competitor_alert` notification (org-wide) per competitor
    whose movement crosses a 5-point threshold, for every `weekly` report
    generated.
  - `send_notification` (`lib/agents/tool-permissions.ts`) is a
    PERMISSION list entry an agent is allowed to invoke, never an actual
    implementation — no concrete agent step calls it, and agents have no
    generic tool-dispatch loop to hang a real implementation off yet.
    Left as a documented gap, not filled with a second mechanism.
  - Every other epic's email touchpoint (`routes/auth.ts`'s magic link,
    `routes/orgs.ts`'s pending invitation email, `routes/snapshot.ts`'s
    anonymous free-snapshot-ready email) is a genuinely different
    concern — none produces a `notifications` row today (the free
    snapshot flow has no `organization_id`/user account to attach one
    to; magic links and invitations are auth-flow emails, not
    "something worth telling a customer about" in this epic's sense) —
    left alone rather than force-fit onto `notify()`.

**Report generation** (`src/lib/reporting/`):

- **`sections.ts`** — `getScoreDeltas`/`getNewOpportunities`/
  `getCompetitorMovements`, each a thin, real query against Epic 14's
  `measurements`, Epic 9's `unified_opportunities`, and Epic 8's real
  `computeCompetitorMovement` (imported, never reimplemented) fed by
  `ai_runs` rows. Zero recomputed scoring logic anywhere in this file.
- **`score-baseline.ts`** — `getBaselineScoreSnapshot(orgId, brandId)`,
  the baseline-comparison report's "before" side: the brand's EARLIEST
  completed GEO run + earliest-analyzed SEO pages, reusing Epic 14's own
  exported `toGeoScoreComponent`/`aggregateSeoComponent` shaping
  functions (mirrors `current-score-snapshot.ts` exactly, ordered
  ascending instead of descending). No "baseline" flag exists anywhere in
  the schema (grepped) — this is the honest, literal reading of "since
  the original baseline" absent a dedicated baseline record.
- **`generate-report.ts`** — `generateReport(params)`, the one function
  that assembles and persists a `reports` row for all four types. Weekly/
  monthly/custom share one content shape (`scoreDeltas`/
  `newOpportunities`/`competitorMovements`/`summary`); baseline_comparison
  builds `{ baseline, current, scoreDelta }` via Epic 14's real
  `getCurrentScoreSnapshot`/`computeScoreDelta` (`current-score-
  snapshot.ts`/`scoring.ts`, imported, never reimplemented) plus the same
  two section queries. `content` is written exactly once — grep confirms
  `reports.update` has no call site anywhere in `apps/api/src`. Writes a
  `report.generated` audit event.
- **`notify-for-report.ts`** — `notifyForGeneratedReport(row, deps?)`,
  wires a just-generated report into `notify()`: always a `weekly_digest`
  (type `weekly`) or `report_ready` (every other type) notification to
  whoever generated it; for `weekly` only, a `competitor_alert` per
  competitor moving >= 5 AI-visibility points (`SIGNIFICANT_MOVEMENT_
  DELTA`), org-wide.
- **`serialize.ts`** — `serializeReport` (full, including `content`) and
  `serializeReportSummary` (list responses omit `content`).

**New routes:**

- **`routes/reports.ts`** — `createReportsRoutes(emailSender)` (a
  factory, like `routes/auth.ts`/`routes/snapshot.ts`, because `POST
  /generate` calls `notify()`). `GET /` lists reports (filterable by
  `type`, paginated, summaries only). `POST /generate` accepts all four
  types (`weekly|monthly|custom|baseline_comparison`) — `periodStart`/
  `periodEnd` required for `custom`, optional override for `weekly`/
  `monthly` (default 7/30-day lookback from now), ignored for
  `baseline_comparison` (always uses the real baseline).
- **`routes/report-details.ts`** — `GET /reports/:id`, the full immutable
  snapshot including `content`.
- **`routes/notifications.ts`** — `GET /notifications` (the caller's own
  per-user notifications plus every org-wide one — `WHERE (user_id = me
  OR user_id IS NULL)`, on top of, never instead of, RLS's
  `organization_id` boundary); `POST /notifications/:id/read` (restricted
  to the caller's OWN per-user notification — marking an org-wide one
  read is out of scope, see "Honest scope boundaries").

**Other changes:**

- **`src/lib/email.ts`** — `EmailSender` gained `sendNotification`;
  `ConsoleEmailSender` implements it. Every existing test-only
  `EmailSender` mock/implementer (`routes/auth.test.ts`'s
  `FakeEmailSender`, `lib/free-snapshot/orchestrator.test.ts`, `routes/
  snapshot.test.ts`) updated to satisfy the widened interface.
- **`src/lib/audit.ts`** — added `'report.generated'` and
  `'notification.sent'` to `ALWAYS_AUDITED_ACTIONS`, this epic's own
  explicit requirement.
- **`src/lib/agents/runner.ts`** — the real `notify()` call site on agent
  run completion (see "Grep audit" above).
- **`src/app.ts`** — mounted `GET/POST /api/brands/me/reports`, `GET
  /api/reports/:id`, `GET/POST /api/notifications`, right after Epic 14's
  own block.
- **`src/routes/tenant-isolation.integration.test.ts`** — 5 new
  `.skip`/`.todo` entries (NEEDS LIVE DB, same standing convention) for
  `reports`/`notifications`.

---

## API surface / response shapes

`GET /api/brands/me/reports?type=weekly` → `200`:
```json
{ "items": [ /* serializeReportSummary rows, generated_at desc — no content */ ], "total": 1, "limit": 25, "offset": 0 }
```

`POST /api/brands/me/reports/generate` → `201`:
```json
{ "report": { "id": "uuid", "type": "weekly", "content": { "scoreDeltas": [...], "newOpportunities": [...], "competitorMovements": [...], "summary": {...} }, "...": "..." } }
```

`GET /api/reports/:id` → `200`, same shape, the full immutable `content`
snapshot. `404` for an unknown/foreign report id (never a leaking 403).

`GET /api/notifications` → `200`:
```json
{ "items": [ /* serializeNotification rows, created_at desc */ ], "total": 3, "limit": 25, "offset": 0 }
```

`POST /api/notifications/:id/read` → `200` with the updated row, or `404`
for a foreign/org-wide/unknown id.

All routes gated on `view_intelligence` (owner/admin/analyst/editor/
viewer — read-only) except `POST /generate`, which additionally requires
`create_brand_profile` (owner/admin/analyst — the same permission `POST
/brands/me/opportunities/recompute` uses for the identical "trigger an
aggregation" shape).

---

## Tests

`vitest run` (apps/api): **950 passed**, 0 failed, 79 tenant-isolation
`.todo`s (74 pre-existing + 5 new Epic 15 ones, all NEEDS LIVE DB — no
live Postgres in this environment). One pre-existing, unrelated flake was
observed under full parallel-suite load at the default 5000ms test
timeout: `app.test.ts`'s CORS preflight test occasionally exceeds it when
all 102 files run concurrently on this machine (passes in ~3.4s
standalone; the full suite is consistently green at `--testTimeout=15000`,
confirmed by repeated runs). This file was not touched by this epic and
the timeout is a resource-contention artifact of the test runner's
parallelism on this machine, not a regression.

This epic's own new/changed files:

- **`lib/notifications/notify.test.ts`** (7 tests) — in_app row always
  written and "sent" immediately; org-wide notifications skip the
  recipient lookup entirely; successful email delivery marks `sent_at`;
  no email on file yields no email row (not a failed one); `email: false`
  skips the attempt; a send failure never throws (row still created,
  `sent_at` null, failure audit event); defaults to `ConsoleEmailSender`
  when no dep is given.
- **`lib/reporting/generate-report.test.ts`** (7 tests) — weekly/monthly/
  custom section assembly includes only in-period data; real competitor
  movement computed via Epic 8's `computeCompetitorMovement` from real
  before/after `ai_runs`; monthly's 30-day default; persisted row shape
  (`status: completed`, `format: json`) and the `report.generated` audit
  event; baseline_comparison's real earliest-vs-current comparison via
  Epic 14's real `computeScoreDelta`; a caller-supplied `periodStart` is
  ignored for `baseline_comparison`; a brand with no GEO data yet never
  crashes (`delta: null, basis: 'none'`).
- **`lib/reporting/immutability.test.ts`** (1 test) — **the DoD's
  explicitly required test**: drives the real `POST /brands/me/reports/
  generate` handler (score 40), mutates the mocked "live" `ai_runs` table
  to a new, later, much-higher run (90), drives the real `GET /reports/
  :id` handler, and asserts the returned content is `JSON.stringify`-
  identical to what generation produced — still showing 40, never 90.
- **`routes/reports.test.ts`** (12 tests) — 401/404 guards, list
  summaries omit `content`, type filtering + tenant scoping asserted
  directly on the query, invalid-type 422, viewer read access, generate
  wiring (`generateReport`/`notifyForGeneratedReport` called with the
  right args, mocked at this layer per the established "mock the
  dependency, assert the call" split), custom-report period validation,
  403 for a viewer attempting to generate.
- **`routes/report-details.test.ts`** (5 tests) — 401, tenant-isolation
  404 (never leaking), unknown-id 404, full content returned, viewer read
  access.
- **`routes/notifications.test.ts`** (8 tests) — 401; own per-user
  notifications returned; org-wide notifications included alongside;
  another user's per-user notification never returned; mark-read persists
  `read_at`; 404 (not leaking) for another user's notification; 404 for
  attempting to mark an org-wide notification read; idempotent re-read.
- **`lib/agents/runner.test.ts`** (12 tests, was 10) — 2 new: a `notify()`
  rejection never overwrites an already-`completed` run's status (the
  real bug this epic's design avoids, proven directly against
  `agent_runs.update`'s call sequence); a schedule-triggered run notifies
  org-wide (`userId: null`), not a phantom user. 2 existing tests
  (completion, failure) gained an assertion that `notify()` is called
  with `type: 'run_complete'` and the right `userId`.

`tsc --noEmit` passes with zero errors across `apps/api` (after the
`EmailSender` interface widening was propagated to every existing
mock/implementer). `@bebest/database`: `prisma validate`, `prisma
generate`, `tsc --noEmit` all clean.

---

## Honest scope boundaries / known limitations

1. **No live scheduler for weekly/monthly reports.** The spec describes
   weekly/monthly as "automated" but this codebase has no durable queue/
   cron anywhere yet — the same `// TODO: durable queue (pg-boss)` gap
   every background job in this codebase already documents (Epic 14's
   4-week re-measurement trigger has the identical shape: a real,
   directly-callable function with no live scheduler calling it
   automatically). `generateReport`/`POST /generate` are that real,
   directly-callable mechanism for all four types today; wiring an actual
   weekly/monthly cron is future work once a durable queue exists.
2. **PDF export is not implemented** — explicitly nice-to-have, never
   blocking, per this epic's own spec. `reports.file_path` (this epic's
   `pdf_url`) is never written by any code path in this build; every
   generated report has `format: 'json'` and `pdfUrl: null`.
3. **Org-wide notifications are in-app only — no email fan-out.** A
   per-user notification has one natural recipient; an org-wide one
   (e.g. `competitor_alert`) does not, and guessing a rule ("email the
   owner," "email everyone") was left undone rather than invented without
   a spec basis. `notify()`'s `email` row is written and attempted ONLY
   when `userId` is set and resolves to a real address.
4. **`entitlement_warning` has no live caller.** The enum value was added
   because the spec's domain model names it verbatim, matching the same
   "add the enum value outright, schema never applied to a database"
   precedent `unified_opportunity_type`'s forward-reserved values already
   set — no code path in this build triggers this notification type.
5. **`send_notification` (the agent tool-permission entry) is still
   unimplemented.** Agents are permitted to invoke it but have no generic
   tool-dispatch loop in this build to hang a real implementation off of
   — a future epic building that dispatch loop should route its
   `send_notification` tool execution through this epic's `notify()`,
   not a new mechanism.
6. **Per-user notification visibility is application-layer, not RLS.**
   RLS's `tenant_isolation` policy on `notifications` enforces the
   `organization_id` boundary only (ADR-005's hard guarantee); whether a
   specific member sees a specific per-user row is enforced by `routes/
   notifications.ts`'s own `WHERE` clause. `POST /:id/read` is
   deliberately restricted to a caller's own per-user notification —
   marking an org-wide row "read" has no per-user read-state column in
   this schema and would incorrectly hide it for every member, so it
   404s instead of doing the wrong thing silently.
7. **Real tenant-isolation proof against live RLS** — the 5 new `.todo`s
   in `tenant-isolation.integration.test.ts` are not fillable without a
   real Postgres instance, which this task explicitly forbids connecting
   to.
8. **Frontend not built** — a separate agent wires the board-presentable
   report view and bell-icon notification center against these exact
   routes/response shapes.
