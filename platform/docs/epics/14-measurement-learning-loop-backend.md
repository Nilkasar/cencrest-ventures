# Epic 14 — Measurement & Learning Loop (backend): completion summary

Backend-only, per this epic's brief — `platform/apps/api` (`@bebest/api`) and
`platform/packages/database` (`@bebest/database`). Branch `rebuild/platform`,
no other branch touched, nothing under `api/`, `web-app/`, or the repo-root
marketing site was modified. **Frontend is not built** — a separate agent
wires the "before/after delta on the action it measures, attribution
confidence visibly labeled" surface (`docs/09-ux/CUSTOMER_JOURNEY.md`'s
weekly-digest retention mechanic) against the real routes/response shapes
documented below.

**No git commands were run.** **No database was connected to at any point**
— `prisma validate`/`prisma generate` were run repeatedly (schema-only,
`DATABASE_URL` set to a dummy value so the CLI has something to parse; no
connection attempted). No `migrate`, `db push`, or `db pull` was run, per the
hard constraint. **No real network call to any external provider was made
anywhere in this build** — every AI/SEO call this epic makes goes through
Epic 7's/Epic 4's already-real, already-null-provider-backed functions,
never a new provider integration of its own.

Migration folder used: **`0017_measurement_learning_loop`** (checked the
migrations directory immediately before creating it — `0017` was unclaimed;
0000 through 0016 already existed, matching the task's own "check again in
case a concurrent process claimed it" instruction).

---

## The design decision this epic's task brief left open: column vs. separate mechanism for `before_score`

Resolved as **both, deliberately** — not a compromise, two independent
copies serving two different guarantees:

1. **`actions.before_score`/`.before_score_captured_at`** (new nullable
   columns) — the CANONICAL snapshot, written exactly once, only by `POST
   /actions/:id/approve`. Living on `actions` itself means the snapshot is
   readable immediately after approval (before any measurement exists) and
   is set inside the same call that flips `approved_by`/`approved_at` — no
   window where an action is "approved" but has no baseline yet.
2. **`measurements.before_score`/`.before_score_captured_at`** — a SECOND,
   independent copy, taken from (1) at MEASUREMENT-CREATION time, never
   re-read from live brand data. This is what actually gets compared
   against `after_score`.

**Why both:** a single column is sufficient for "captured once, at
approval," but this epic's own DoD demands something testable and stronger:
"mutating the live brand's current score after approval must not change
what a LATER measurement compares against." With two independent copies,
that property holds by construction — even a hypothetical future bug that
mutated column (1) after approval could corrupt only a not-yet-created
measurement, never one already written. `lib/measurement/immutability.
test.ts` is the literal proof (see "Tests" below). Full reasoning:
`packages/database/DECISIONS.md` §28.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **`actions`** — extended with `before_score` (JSONB, nullable) and
  `before_score_captured_at` (nullable timestamptz), set ONLY by `POST
  /actions/:id/approve`.
- **`measurements`** (new) — `organization_id`, `brand_id`, `action_id`,
  `before_score`/`before_score_captured_at` (the independent copy),
  `after_score`, `after_ai_run_id` (real FK to the fresh `ai_runs` row a
  successful GEO re-run produced, nullable), `score_delta` (nullable
  `Decimal(6,2)`), `attribution_confidence` (reuses `claim_confidence` —
  see below), `attribution_notes`, `measured_at`.
- **`outcome_records`** (new) — `organization_id`, `measurement_id` (real
  FK, Cascade), `opportunity_type` (reuses `unified_opportunity_type`,
  Epic 9), `action_type` (reuses `recommendation_action_type`, Epic 10),
  `score_delta` (nullable).
- **`prisma/migrations/0017_measurement_learning_loop/`** — `checks.sql`
  (`chk_actions_before_score_together`, all-or-nothing, same discipline as
  0016's `chk_actions_approval_fields_together`) and `rls.sql` (standard
  `tenant_isolation` policy on both new tables).
- `src/client.ts` / `src/index.ts` — export `measurements`, `outcome_records`.
- Back-relations added on `organizations`, `brands`, `actions`, `ai_runs` —
  no other epic's models touched. Legacy `measurement_points`/
  `measurement_annotations`/`experiment_measurements` (Epic 0, zero
  application usage — confirmed by grep) are left completely untouched, a
  different, wrong-shaped table for a different concern (see DECISIONS.md
  §28).
- `prisma validate` + `prisma generate` clean; `tsc --noEmit`/`eslint src`/
  `vitest run` for `@bebest/database` all clean (7 tests, unchanged).
- Full reasoning: `packages/database/DECISIONS.md` §28.

### `platform/apps/api` (`@bebest/api`)

**Pure, unit-tested formula modules** (`src/lib/measurement/`):

- **`scoring.ts`** — `ScoreSnapshot`/`GeoScoreComponent`/`SeoScoreComponent`
  (the shared before/after shape) and `computeScoreDelta`, a pure function
  of `(before, after)` — GEO preferred over SEO when both sides have both
  components (AI visibility is this product's headline metric), falls back
  to SEO, returns `{ delta: null, basis: 'none' }` when neither is
  comparable. Zero database/AI-provider/clock dependency.
- **`attribution.ts`** — `estimateAttribution`, pure, deterministic. Rules:
  no comparable data -> low; another action on the same brand executed in
  the window -> capped at medium (confounded); delta magnitude < 3 ->
  low (noise); mismatched formula versions -> capped at medium; magnitude
  >= 10 with nothing confounding -> high; else medium. Every `notes` string
  is phrased as an estimate ("plausible," "cannot rule out," "an estimate,
  not proof") — grepped for "proof"/"caused" before shipping; a unit test
  (`never asserts certainty`) enforces this going forward.

**Read (current, already-computed data) and re-run (fresh) modules:**

- **`current-score-snapshot.ts`** — `getCurrentScoreSnapshot(orgId,
  brandId)`: GEO = the brand's latest COMPLETED `ai_runs` row, read
  verbatim (Epic 7, zero recomputation). SEO = Epic 4 never defined a
  single brand-wide score (only per-page `seo_analyses.score`) — this
  averages the LATEST score per page (Prisma `distinct: ['page_id']`) plus
  the latest content-level score; `SEO_SNAPSHOT_AGGREGATION_VERSION` labels
  this AGGREGATION method, not a new page-level formula. Called ONLY by
  `POST /actions/:id/approve`, to capture `before_score` — deliberately a
  READ, never a trigger of a new AI run/crawl just to record a baseline.
  Exports `toGeoScoreComponent`/`aggregateSeoComponent`, shared with the
  re-run modules below so the shaping logic exists in exactly one place.
- **`reanalyze-seo.ts`** — `reanalyzeSeoForBrand(orgId, brandId)`: calls
  Epic 4's REAL `runTechnicalChecklist`/`runContentChecklist` directly
  against the brand's most recent crawl job's already-stored pages (no new
  network call, no new crawl — same safety profile as `routes/seo.ts`'s own
  `/analyze`), persists new `seo_analyses`/`page_issues` rows, returns the
  aggregated component. Returns `null` when the brand has no crawl data at
  all.
- **`run-measurement.ts`** — `runMeasurementForAction(orgId, actionId)`,
  the core orchestrator: loads the action + its real recommendation chain
  (`opportunity_recommendations` -> `unified_opportunities`), re-runs GEO
  via `runAiVisibilityStep` (Epic 12's own helper, the SAME one the
  GEO/Growth agents use — never reimplemented) against the brand's active
  query set when one exists, re-runs SEO via `reanalyzeSeoForBrand`,
  computes the delta and attribution estimate, writes `measurements`
  (always, once executed + before-score exists) and `outcome_records`
  (ONLY when the recommendation chain resolves — see "Honest scope
  boundary" below), then a `measurement.completed` audit event.
- **`schedule-remeasurement.ts`** — `scheduleRemeasurement(actionId, orgId,
  deps?)`, the 4-week trigger. `setTimeout`-based placeholder (`// TODO:
  durable queue`, same honest marker every prior epic used), injectable via
  `deps.schedule`/`deps.delayMs` for tests (no real wall-clock wait
  required). **Caught a real bug during this build**: `FOUR_WEEKS_MS`
  (2,419,200,000ms) exceeds `setTimeout`'s 32-bit signed-int ceiling
  (2,147,483,647ms) — Node silently CLAMPS an over-ceiling delay to ~1ms
  rather than erroring (confirmed via the `TimeoutOverflowWarning` Node
  itself printed the first time this was run un-fixed). Fixed with a
  chunked-`setTimeout` scheduler that chains sub-ceiling delays until the
  full 4 weeks has genuinely elapsed, each `.unref()`d. Proven with real
  fake-timers (`vi.useFakeTimers()` + `vi.advanceTimersByTime`), not just
  mocked injection.
- **`serialize.ts`** — `serializeMeasurement`, shared by both read routes.

**Modified existing route** (`src/routes/action-details.ts`):

- `POST /actions/:id/approve` — now also calls `getCurrentScoreSnapshot`
  and writes `before_score`/`before_score_captured_at` in the SAME update
  as `approved_by`/`approved_at`. Idempotent (a second approve never
  re-reads or overwrites it — the existing early-return branch already
  covers this).
- `POST /actions/:id/execute` — now also calls `scheduleRemeasurement` on
  the REAL (first-time) execution branch only, never on the idempotent
  `alreadyExecuted` branch (which would otherwise schedule a redundant
  second timer on every repeated call).

**New routes:**

- **`routes/measurements.ts`** — `GET /brands/me/measurements` (spec's
  literal `GET /brands/:id/measurements`, adapted to the single-brand-
  per-org convention every Epic 2+ route uses), sorted `measured_at` desc,
  paginated (`limit`/`offset`).
- **`routes/action-measurement.ts`** — `GET /actions/:id/measurement`
  (matches the spec's literal route exactly), mounted at the same
  `/api/actions` base as `action-details.ts`. Always 200 (`measured:
  false` with the action's own status/`beforeScoreCapturedAt` before a
  measurement exists, same "poll like run status" precedent `GET
  /ai-runs/:id/score` already sets), `measured: true` with the full
  serialized comparison once one does. Returns the MOST RECENT measurement
  when more than one exists for an action.

**Other changes:**

- **`src/lib/audit.ts`** — added `'measurement.completed'` to
  `ALWAYS_AUDITED_ACTIONS` (the transparency principle every agent epic
  follows — a system-triggered re-measurement must be observable).
- **`src/app.ts`** — mounted `GET /api/brands/me/measurements` and
  `/api/actions` (the measurement sibling router), right after Epic 13's
  own block.
- **`src/routes/tenant-isolation.integration.test.ts`** — 5 new
  `.skip`/`.todo` entries (NEEDS LIVE DB, same standing convention as every
  other epic's block) covering the new tables' RLS, the id-addressed
  measurement route's 404 (never leaking existence), `WITH CHECK`, and that
  a background (no-HTTP-context) job still runs every query through
  `withOrgContext`.

---

## API surface / response shapes

`GET /api/brands/me/measurements` → `200`:
```json
{ "items": [ /* serializeMeasurement rows, measured_at desc */ ], "total": 1, "limit": 50, "offset": 0 }
```

`GET /api/actions/:id/measurement` → `200`, before a measurement exists:
```json
{ "measured": false, "action": { "id": "uuid", "status": "completed", "executedAt": "...", "beforeScoreCapturedAt": "..." } }
```
`200`, once measured:
```json
{
  "measured": true,
  "measurement": {
    "id": "uuid", "actionId": "uuid", "brandId": "uuid",
    "beforeScore": { "geo": { "aiVisibilityScore": 40, "...": "..." }, "seo": null, "capturedAt": "..." },
    "beforeScoreCapturedAt": "...", "afterScore": { "...": "..." }, "afterAiRunId": "uuid|null",
    "scoreDelta": 15, "attributionConfidence": "high",
    "attributionNotes": "The AI-visibility score improved by 15.00 points, with no other action executed on this brand in the same window and no formula change between measurements — this action is a plausible cause, though this remains an estimate, not proof of causation.",
    "measuredAt": "...", "createdAt": "..."
  }
}
```
`404` for an unknown/foreign action id (never a leaking 403).

Both gated on `view_intelligence` (owner/admin/analyst/editor/viewer —
read-only), matching every other intelligence-read route in this codebase.

---

## Tests

`vitest run` (apps/api): **908 passed**, 0 failed, 74 tenant-isolation
`.todo`s (69 pre-existing + 5 new Epic 14 ones, all NEEDS LIVE DB — no live
Postgres in this environment). This epic's own new/changed files:

- **`lib/measurement/scoring.test.ts`** (11 tests) — pure-function fixtures:
  GEO-over-SEO preference, SEO fallback, `null`/`'none'` when nothing is
  comparable, a real zero delta reported as `0` not `null`, rounding,
  formula-version-match detection, and an explicit "identical inputs ->
  identical output" purity check.
- **`lib/measurement/attribution.test.ts`** (15 tests) — every confidence
  branch by name (no data, confounded, noise, formula mismatch, high,
  medium), the exact noise/significance threshold boundaries, GEO vs. SEO
  label wording, decline (not just improvement) phrasing, and a sweep
  asserting no branch's `notes` ever asserts certainty.
- **`lib/measurement/current-score-snapshot.test.ts`** (7 tests) — GEO read
  back verbatim from the latest completed run (never a run still in
  progress), SEO averaging (technical + content), `distinct: ['page_id']`
  asserted directly on the query (never double-counts a re-analyzed page),
  independence of the two components.
- **`lib/measurement/reanalyze-seo.test.ts`** (6 tests) — `null` with no
  crawl data / zero pages, the aggregated result independently
  cross-checked against calling Epic 4's REAL `runTechnicalChecklist`/
  `runContentChecklist` directly in the test, homepage-only schema check,
  new-issue persistence, and that a second re-run writes fresh rows rather
  than overwriting.
- **`lib/measurement/schedule-remeasurement.test.ts`** (9 tests) —
  including the real-timer proof that the chunked scheduler genuinely waits
  the full 4 weeks (via `vi.useFakeTimers`), the boundary check that
  `FOUR_WEEKS_MS` exceeds the 32-bit ceiling (documenting exactly why the
  chunking exists), injected-scheduler tests requiring zero real wall-clock
  wait, and that a rejection is caught and logged, never thrown.
- **`lib/measurement/run-measurement.test.ts`** (14 tests) — every guard
  clause (not found / not executed / no before-score), GEO re-run wired to
  the real `runAiVisibilityStep` with the correct query-set/approver args,
  GEO error-variant handling (`after.geo` stays `null`, never a stale
  fallback), SEO re-run wiring, before-score copied verbatim, the
  confounding-action count query, attribution downgrade when confounded,
  outcome_records written with the REAL chain's enums, outcome_records
  correctly SKIPPED with no recommendation chain, the audit event's exact
  shape, and a language check on the stored notes.
- **`lib/measurement/immutability.test.ts`** (1 test) — **the DoD's
  explicitly required test**: drives the real approve handler (score 40),
  mutates the mocked "live" `ai_runs` table to 90, runs the real
  `runMeasurementForAction`, and asserts the written measurement's
  `before_score` still reads 40, never 90.
- **`routes/measurements.test.ts`** (6 tests) — 401 with no token, 404 with
  no brand, sort order, tenant scoping, pagination, viewer read access.
- **`routes/action-measurement.test.ts`** (6 tests) — tenant isolation
  (404, never leaking), unmeasured `200`/`measured:false`, measured
  response shape, attribution-language check on the raw response, most-
  recent-of-several, viewer read access.
- **`routes/action-details.test.ts`** (30 tests, was 24) — 6 new: the
  before-score snapshot captured with no existing data, snapshotted from
  real `ai_runs` data, never recomputed on an idempotent second approve;
  `scheduleRemeasurement` called exactly once on a real execute, never
  twice on a repeat, never at all when execute is rejected.

`tsc --noEmit`, `eslint src`, and `tsc -p tsconfig.build.json` all pass with
zero errors across `apps/api`. `@bebest/database`: `prisma validate`,
`prisma generate`, `tsc --noEmit`, `eslint src`, `vitest run` all clean.

---

## Honest scope boundaries / known limitations

1. **No `outcome_records` row without a real recommendation chain.** A
   Level 1-3 agent-originated action (`agent_pending_action_id` set,
   `recommendation_id` null) has no `opportunity_recommendations` row to
   pull `action_type`/`opportunity_type` from. Per this epic's own explicit
   "pulled from the real chain... not guessed or hardcoded" instruction,
   `runMeasurementForAction` writes the `measurements` row (still real and
   meaningful) but skips `outcome_records` entirely for that case, rather
   than fabricating a pair.
2. **"The learning model" is a queryable table, not an ML system** — this
   epic's spec draws this boundary explicitly, transcribed here verbatim
   for visibility: "recording the outcome... in a queryable table, NOT a
   real ML model." A real pattern-recognition/formula-refinement system
   (`PRODUCT_VISION.md` Layer 8) is documented future work `outcome_records`
   would feed, alongside Epic 8's competitor-visibility-changes feed —
   nothing in this build reads these rows back to change any formula or
   recommendation.
3. **SEO's "after" side re-runs Epic 4's checklist against the brand's most
   recent EXISTING crawl — it never triggers a new crawl.** Re-scoring
   already-crawled pages is safe (no new network call, no new SSRF
   surface); automatically re-crawling a customer's live site every 4 weeks
   is a materially bigger, separate scope decision this epic's spec does
   not require (only GEO's re-run is specified with "same query set"
   detail). A brand whose crawl data has gone stale simply yields `seo:
   null` for that cycle's after-score, same as it would for before.
4. **No durable queue** — `scheduleRemeasurement` is `setTimeout`-based
   (chunked to actually survive the 4-week delay correctly, but still an
   in-process timer), same `// TODO: durable queue (pg-boss)` placeholder
   every prior epic's background job carries. A process restart loses every
   pending re-measurement timer; a real queue with a durable "fire at this
   timestamp" job is the fix, not solved here.
5. **No DB-level trigger enforces true column-level immutability on
   `actions.before_score`** — enforcement is architectural (grep confirms
   exactly one call site ever writes it, plus `measurements` keeps its own
   independent copy) and application-tested (`immutability.test.ts`), not a
   Postgres trigger (this codebase uses none anywhere; CHECK constraints
   and RLS only).
6. **`attribution_confidence`'s "did something else move" check is
   confined to THIS build's own data** — only OTHER `actions` on the same
   brand executed in the measurement window are checked as a confounding
   factor. Epic 8's competitor-visibility-changes feed is named by the spec
   as a future learning-system input, not something this epic's own
   attribution estimate consults directly.
7. **Real tenant-isolation proof against live RLS** — the 5 new `.todo`s in
   `tenant-isolation.integration.test.ts` are not fillable without a real
   Postgres instance, which this task explicitly forbids connecting to.
8. **Frontend not built** — a separate agent wires the before/after-delta-
   with-labeled-confidence surface against these exact routes/shapes.
