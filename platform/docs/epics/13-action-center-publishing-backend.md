# Epic 13 — Action Center & Controlled Publishing (backend): completion summary

Backend-only, per this epic's brief — `platform/apps/api` (`@bebest/api`) and
`platform/packages/database` (`@bebest/database`). Branch `rebuild/platform`,
no other branch touched, nothing under `api/`, `web-app/`, or the repo-root
marketing site was modified. **Frontend is not built** — a separate agent
wires the Action Center experience (pending approvals with the underlying
recommendation/draft visible inline, in-progress, completed-with-outcome,
rolled-back) against the real routes/response shapes documented below.

**No git commands were run.** **No database was connected to at any point** —
`prisma validate`/`prisma generate` were run repeatedly (schema-only,
`DATABASE_URL` set to a dummy value so the CLI has something to parse; no
connection attempted). No `migrate`, `db push`, or `db pull` was run, per the
hard constraint. **No real network call to any external provider was made
anywhere in this build** — `PublishTarget` never leaves process memory (see
below).

Migration folder used: **`0016_action_center_publishing`** (checked the
migrations directory immediately before creating it — `0016` was unclaimed;
0000 through 0015 already existed).

---

## The schema questions this epic had to answer first

**1. `actions` already existed** (ported in Epic 0 from
`docs/06-database/SCHEMA.md`'s Opportunity section — checked directly
against schema.prisma first, per this epic's own "check the schema first"
instruction), but as a generic, **never-consumed** "action item" shape
(`priority`/`source`/`source_id`/`assigned_to`/`due_date`/`metadata`,
`status IN {pending, in_progress, completed, dismissed}`) — confirmed by
grep (zero `db.actions.*`/`tx.actions.*` call sites anywhere in `apps/api`)
before this epic's first edit. Not SCHEMA.md's own literal `actions` DDL
(§4), which has `recommendation_id`/`autonomy_level`/`approved_by`/
`approved_at`/`executed_at`/`rolled_back_at`/`result`. Same "already-ported
table missing the fields this epic needs, extend it" resolution Epic 11
used for `content_briefs`' missing `recommendation_id`: every pre-existing
column is kept (harmless, zero migration risk — no row/caller existed),
this epic adds exactly the domain-model columns it needs, plus two handoff
FKs the domain model doesn't name but this epic's own task brief requires:
`content_draft_id` (Epic 11 → Epic 13, `@unique`) and
`agent_pending_action_id` (Epic 12 → Epic 13, `@unique`), mutually
exclusive per row. `status`'s vocabulary is widened to
`pending → approved → completed`, or `rolled_back`.

**2. `autonomy_level` deliberately stays 1-4 at the DB layer** — unlike
`agent_runs.autonomy_level` (Epic 12's `chk_agent_runs_autonomy_level`,
CHECK `IN (1,2,3)`, which makes a Level 4 row physically impossible to
create). This epic's own non-negotiable is different in kind: both "No code
path exists that publishes without a prior `approved_at`... enforceable by
reading the execute function's guard clause itself" and "Autonomy Level 4
must be rejected by the execute path even given a manually-crafted request
with approval fields set" assume a row **can** legitimately hold
`autonomy_level: 4`, and require the EXECUTE function's own guard clause —
not a CHECK constraint that would make the scenario untestable by
construction — to be what catches it. Two DB-level constraints
(`chk_actions_execute_requires_approval`, `chk_actions_level4_never_
executes`) still back that application guard up as genuine defense-in-depth.

**3. `published_content` is a NEW table, deliberately NOT a reuse of the
pre-existing `publish_jobs`** (also already ported in Epic 0 — Epic 11's own
`content_approvals` model comment had already flagged `publish_jobs` as
"ported... for Epic 13's later publishing workflow"). Checked directly
against `publish_jobs`'s actual column set before deciding this:
`publish_jobs` bundles `destination`/`destination_config` (third-party CMS
connection config), `scheduled_at`, `rejection_reason`, and `publish_log`
alongside `approved_by`/`approved_at`/`published_at`/`published_url` — the
shape of a genuine, multi-destination external publish workflow this epic
explicitly does **not** build ("actually pushing to a customer's external
CMS is explicitly out of scope for this build... a `PublishTarget` interface
with an internal-record-only default implementation," this epic's own spec,
verbatim). Reusing `publish_jobs` would leave `destination_config`/
`scheduled_at`/`rejection_reason`/`publish_log` permanently unpopulated dead
columns implying a workflow that doesn't exist — the same "a different,
wrong-shaped table for a different, not-yet-built concern, left alone"
reasoning Epic 11 already used for `content_approvals` vs. `publish_jobs`,
and for `content_drafts` vs. `generated_content`. `published_content` has no
destination-config/schedule/rejection concept anywhere in it.
`publish_jobs` is left **completely untouched**.

**4. `GET /brands/:id/actions`** — the spec's literal route — is adapted to
`GET /brands/me/actions`, the single-brand-per-org convention every Epic 2+
route in `app.ts` already uses (applying an established precedent, not a
fresh decision).

**5. RBAC: `publish_content`, not `approve_content`.** This epic's own task
brief is explicit: "per docs/08-security/SECURITY.md's 'Publish content:
owner/admin only'" — a materially stricter permission than Epic 11's own
`approve_content` (owner/admin/editor-own draft-quality gate). All three
lifecycle routes (`approve`/`execute`/`rollback`) gate on `publish_content`
— SECURITY.md's matrix has exactly one row for the whole publish-shaped
decision, covering approve, the execute that follows it, and the rollback
that reverses it alike. `lib/rbac.ts`'s `Action` union already had
`publish_content` defined (unused by any route until this epic — anticipated
the same way `approve_content`/`create_content_draft` were for Epic 11).

**6. 30-day rollback window — resolved ambiguity: measured from
`executed_at`, not `approved_at`.** Neither `AGENT_ARCHITECTURE.md` nor
SCHEMA.md's `actions` DDL states which timestamp the window starts from;
this epic's own task brief names both candidates. Resolved as `executed_at`
+ 30 days (`lib/actions/rollback-window.ts`): rollback reverts
`published_content` — the artifact created AT execution — and
`approved_at`/`executed_at` can legitimately drift apart (spec's own step 2:
"a human might approve now and the system executes async"), so measuring
from `approved_at` could silently hand a customer less than the full 30
days promised — the more customer-hostile of the two readings. No
`rollback_until` column is persisted (unlike `agent_pending_actions.
rollback_until`, Epic 12) — the deadline is a pure function of `executed_at`
+ a constant, computed at request time.

Full reasoning for all six: `@bebest/database` DECISIONS.md §27.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **`actions`** — extended in place with `recommendation_id` (nullable FK →
  `opportunity_recommendations`, `Restrict`), `autonomy_level` (`SmallInt`,
  default 1), `approved_by`/`approved_at`, `executed_at`, `rolled_back_at`,
  `result` (JSONB), `content_draft_id` (nullable, `@unique`, FK →
  `content_drafts`, `Restrict`), `agent_pending_action_id` (nullable,
  `@unique`, FK → `agent_pending_actions`, `Restrict`). `status` widened to
  `pending | approved | completed | rolled_back`.
- **`published_content`** (new) — `action_id` (`@unique`, FK → `actions`,
  `Restrict`), `publish_target` (the real `PublishTarget.name`),
  `destination_ref` (an `internal://` locator — never a real external URL),
  `title`/`body` (snapshot of the published `content_drafts` row, when
  present), `status` (`published | rolled_back`), `published_at`/
  `published_by`, `rolled_back_at`/`rolled_back_by`, `result` (JSONB — the
  raw `PublishTarget` result payload).
- **`prisma/migrations/0016_action_center_publishing/`** — `checks.sql`
  (`actions.status` widened via DROP + re-ADD, same precedent Epic 18's
  `chk_agency_clients_status` widening already established;
  `actions.autonomy_level BETWEEN 1 AND 4`; the two execute-guard mirror
  constraints; approval-fields-together; single-handoff-source;
  `published_content.status`/rollback-fields-together) and `rls.sql`
  (standard `tenant_isolation` policy on `published_content` — `actions`
  already has one from `0000_init`).
- `src/client.ts` / `src/index.ts` — export `actions`, `published_content`.
- Back-relations added on `organizations`, `brands`, `users`
  (`actions_approved`, `published_content_published`,
  `published_content_rolled_back`), `opportunity_recommendations`
  (`actions[]`), `content_drafts` (`actions?`), `agent_pending_actions`
  (`actions?`) — no other epic's models touched.
- `prisma validate` + `prisma generate` both clean (re-verified after every
  edit); `tsc --noEmit`/`eslint src`/`vitest run` for the whole
  `@bebest/database` package all clean.
- Full reasoning: `packages/database/DECISIONS.md` §27.

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/actions/publish-target.ts`** — the `PublishTarget` interface
  (`publish`/`rollback`) transcribed in the same shape/factory-function
  precedent `lib/billing/payment-provider.ts`'s `PaymentProvider`/
  `NullPaymentProvider` already established (Epic 16): one shipped
  `NullPublishTarget` (deterministic, zero network calls, `destinationRef`
  always an `internal://` locator), a process-lifetime singleton getter
  (`getPublishTarget()`), a test-only setter
  (`__setPublishTargetForTesting`). No registry class — exactly one real
  implementation, no routing table to encode yet.
- **`src/lib/actions/rollback-window.ts`** — `rollbackDeadline`,
  `isWithinRollbackWindow` (pure functions of `executedAt`/`now`; see
  resolved-ambiguity #6 above).
- **`src/lib/actions/serialize.ts`** — `serializeAction`,
  `serializePublishedContent`.
- **`src/routes/actions.ts`** — `GET /brands/me/actions`, bucketed into
  `pending`/`inProgress`/`completed`/`rolledBack` (matching
  `CUSTOMER_JOURNEY.md`'s Action Center screen sections exactly), each row
  including its linked `content_drafts` (+ that draft's own `content_briefs`
  nested one level further) so the underlying recommendation/draft is
  visible inline, not just a title.
- **`src/routes/action-details.ts`** — `POST /actions/:id/approve`,
  `/execute` (separate from approve), `/rollback`. This is the **only**
  code in this build that ever creates a `published_content` row.
  - `approve`: sets `approved_by`/`approved_at` from the real authenticated
    caller (never a request-body field) — idempotent; also rejects Level 4
    (extra hardening beyond this epic's required guarantee below).
  - `execute`: two guard clauses, in this order, readable directly in the
    function's source:
    1. **Level 4 rejected unconditionally** — checked BEFORE the approval
       check, so it fires even given a manually-crafted row with
       `approved_at` already set.
    2. **No `approved_at` → rejected** (`409 not_approved`).
    Only past both does it call `PublishTarget.publish()`, create
    `published_content`, and set `executed_at`/`status: 'completed'`.
    Idempotent on a second call (returns the existing `published_content`,
    never publishes twice — `published_content.action_id`'s DB-level
    `@unique` is the second line of defense).
  - `rollback`: rejects if never executed; the real 30-day check
    (`isWithinRollbackWindow`) rejects with a specific
    `rollback_window_expired` error past the deadline; on success, best-effort
    calls `PublishTarget.rollback()` (never blocks the DB-recorded outcome),
    flips `published_content.status` to `rolled_back`, sets
    `actions.rolled_back_at`. Idempotent on a second call.
- **`src/routes/content-drafts.ts`** — Epic 11 → Epic 13 handoff. Right
  after a draft's approve handler flips `content_drafts.status` to
  `'approved'`, it now also creates the pending `actions` row
  (`content_draft_id` set to the real draft id, `recommendation_id`
  denormalized from the draft's own brief). Relies on the route's EXISTING
  idempotency short-circuit for its own idempotency; not itself
  audit-logged (the privileged decision it follows, `content.approved`,
  already is).
- **`src/routes/agent-run-details.ts`** — Epic 12 → Epic 13 handoff. Right
  after `POST /agent-runs/:id/approve` flips the `agent_pending_actions`
  row to `'approved'` — this epic's spec line ("a Level-3-approved agent
  action... becomes an actions row, status: pending") is read as naming
  exactly this event — it now also creates the pending `actions` row
  (`agent_pending_action_id` set to the real pending-action id). Not itself
  audit-logged, same reasoning as the content-drafts handoff.
- **`src/lib/audit.ts`** — added `'action.approved'`/`'action.rolled_back'`
  to `ALWAYS_AUDITED_ACTIONS` (`content.published` already existed, reused
  verbatim for `execute`).
- **`src/app.ts`** — mounted `GET /api/brands/me/actions` and
  `/api/actions/*`; see the header comment added right after Epic 12's
  block.
- **`src/routes/tenant-isolation.integration.test.ts`** — 5 new
  `.skip`/`.todo` entries (NEEDS LIVE DB, same standing convention as every
  other epic's block in this file) covering `GET /brands/me/actions`
  cross-tenant zero-rows, cross-tenant approve/execute/rollback 404s,
  `WITH CHECK` on both tables, a cross-tenant rollback attempt on an
  executed action, and the content_drafts handoff never crossing a tenant
  boundary.

---

## RBAC

`publish_content` (owner/admin only) gates all three lifecycle routes — see
resolved-ambiguity #5 above. `view_intelligence` gates the list GET. No new
`Action` was added to `src/lib/rbac.ts` — `publish_content` was already
present, unused by any route until this epic (per that file's own header
comment, anticipating exactly this).

---

## Response shapes

`GET /api/brands/me/actions` → `200`:
```json
{
  "pending": [ /* serializeAction + contentDraft + contentBrief */ ],
  "inProgress": [ /* status: 'approved' */ ],
  "completed": [ /* status: 'completed' */ ],
  "rolledBack": [ /* status: 'rolled_back' */ ]
}
```
Each row:
```json
{
  "id": "uuid", "brandId": "uuid", "recommendationId": "uuid|null",
  "actionType": "publish_content", "title": "...", "description": "...",
  "priority": "medium", "status": "pending", "autonomyLevel": 1,
  "contentDraftId": "uuid|null", "agentPendingActionId": "uuid|null",
  "approvedBy": null, "approvedAt": null, "executedAt": null,
  "rolledBackAt": null, "result": null,
  "createdAt": "...", "updatedAt": "...",
  "contentDraft": { "...": "serializeDraft or null" },
  "contentBrief": { "...": "serializeBrief or null" }
}
```

`POST /api/actions/:id/approve` → `200`:
```json
{ "alreadyApproved": false, "action": { "...": "...", "status": "approved", "approvedBy": "uuid", "approvedAt": "..." } }
```
`404` unknown/foreign id; `403` below `publish_content`; `422
{ "error": "autonomy_level_rejected" }` for a Level 4 action.

`POST /api/actions/:id/execute` → `201` (`200` if already executed):
```json
{
  "alreadyExecuted": false,
  "action": { "...": "...", "status": "completed", "executedAt": "...", "result": { "publishedContentId": "uuid", "destinationRef": "internal://..." } },
  "publishedContent": {
    "id": "uuid", "actionId": "uuid", "publishTarget": "internal_record",
    "destinationRef": "internal://published-content/<actionId>",
    "title": "...", "body": "...", "status": "published",
    "publishedAt": "...", "publishedBy": "uuid", "result": { "...": "..." }
  }
}
```
`409 { "error": "not_approved" }` without a prior approval; `422
{ "error": "autonomy_level_rejected" }` for a Level 4 action, **regardless
of approval state** — the required defense-in-depth guarantee.

`POST /api/actions/:id/rollback` → `200`:
```json
{ "alreadyRolledBack": false, "action": { "...": "...", "status": "rolled_back", "rolledBackAt": "..." } }
```
`409 { "error": "not_executed" }` if never executed; `409
{ "error": "rollback_window_expired" }` past the real 30-day check,
measured from `executed_at`.

---

## Tests

`vitest run` (apps/api): **817 passed**, 0 failed, 69 tenant-isolation
`.todo`s (64 pre-existing + 5 new Epic 13 ones, all NEEDS LIVE DB per this
repo's standing convention — no live Postgres in this environment). New
files:

- **`lib/actions/rollback-window.test.ts`** (9 tests) — including the DoD's
  explicit boundary requirement: true exactly AT the deadline (inclusive),
  true 1ms before, **false 1ms after**, plus day-15/day-31/day-365 sanity
  checks and the default-`now` code path.
- **`lib/actions/publish-target.test.ts`** (7 tests) — `destinationRef`
  never resembles a real external URL, deterministic per `actionId`, real
  input carried through into the result payload (never fabricated),
  `rollback` is a no-op that never throws, the singleton/test-injection
  hooks.
- **`routes/actions.test.ts`** (5 tests) — the four-section bucketing
  exactly, `view_intelligence` access for a viewer, 404 with no brand
  profile, the content-draft/brief inline-join, tenant isolation.
- **`routes/action-details.test.ts`** (24 tests) — by name, the DoD's exact
  scenarios: tenant isolation (404, never a leaking 403) on all three
  routes; `approved_by`/`approved_at` set from the real authenticated user
  even when a hostile request body tries to set them itself; idempotent
  approve/execute/rollback; **execute rejected with no prior approval**
  (the required test); **Level 4 rejected by execute even given a
  manually-crafted row with approval fields already set** (the required
  defense-in-depth test), independent of role, independent of the
  approve-time guard; successful execute creates the internal-record-only
  `published_content` row and never a real external URL; the Epic 11
  content-draft title/body flow through to what gets "published"; the
  30-day rollback window's real boundary (just inside / just outside,
  matching the DoD's explicit wording) plus a well-inside/well-outside
  sanity pair.
- **`routes/content-briefs.test.ts`** (still 20 tests, extended) — new
  assertions on the existing approve tests proving the Epic 11 → Epic 13
  handoff: a real `content_draft_id` FK (never a re-typed copy),
  `recommendation_id` carried through from the draft's brief, exactly one
  handoff row even across the idempotent-repeat case.
- **`routes/agent-run-details.test.ts`** (still 7 tests, extended) — new
  assertions on the existing approve test proving the Epic 12 → Epic 13
  handoff (`agent_pending_action_id`, `autonomy_level` carried from the
  run); the "never publishes/executes anything" test was updated (not
  weakened) to also assert the new `actions.create` call's exact shape
  alongside the still-true "no publish/content-draft/execute call" invariant.
- **`routes/tenant-isolation.integration.test.ts`** — 5 new `.todo`s (see
  "What was built" above).

`tsc --noEmit`, `eslint src`, and `tsc -p tsconfig.build.json` all pass with
zero errors across the whole `apps/api` package. `@bebest/database`:
`prisma validate`, `prisma generate`, `tsc --noEmit`, `eslint src`, and its
own `vitest run` (7 tests) all clean.

---

## What's not done / known limitations (documented, not silently skipped)

1. **No real external CMS integration** — the epic's own explicit,
   documented scope boundary. `NullPublishTarget` writes an internal record
   only; `destinationRef` is always an `internal://` locator, never a real
   URL. A future epic implementing `class WordPressPublishTarget implements
   PublishTarget` (or similar) is a one-function change
   (`getPublishTarget()`).
2. **`publish_jobs` remains completely unused** — ported in Epic 0 for
   exactly this kind of real, multi-destination publish workflow, but this
   epic's scope doesn't call for it (see resolved-ambiguity #3). Available
   for whichever future epic actually builds real CMS integration.
3. **No scheduled/automatic execution.** `POST /actions/:id/execute` is
   caller-triggered only, same "no cron/queue trigger defined by this
   epic" scope every prior generation-step epic in this codebase already
   documents (crawl/ai-runs/agents all have the identical gap). The spec's
   own "a human might approve now and the system executes async" is
   satisfied by execute being a SEPARATE call from approve, not by any
   actual background scheduler existing yet.
4. **`result` on `actions` is a small summary pointer
   (`{publishedContentId, destinationRef}`), not the full `PublishTarget`
   payload** — the full payload lives on `published_content.result`. Same
   "small pointer, not the full record" precedent `agent_runs.result_id`
   already establishes.
5. **`PublishTarget.rollback()` is never actually exercised against
   anything with real external state** (`NullPublishTarget`'s own
   implementation is a no-op) — real behavior here is entirely deferred to
   whichever future epic builds a real `PublishTarget`; this build's own
   rollback guarantee rests entirely on the `published_content`/`actions`
   row updates, not on this call succeeding or even being meaningful yet.
6. **Real tenant-isolation proof against live RLS** — the 5 new `.todo`s in
   `tenant-isolation.integration.test.ts` (NEEDS LIVE DB, consistent with
   the other 64 already in that file) are not fillable without a real
   Postgres instance, which this task explicitly forbids connecting to.
7. **Frontend not built** — a separate agent wires the Action Center
   experience against these exact routes/shapes.
