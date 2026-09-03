# Epic 9 — Opportunity Engine (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root marketing
site was modified. **Frontend is not built** — a separate agent wires the
Opportunities screen against the real routes documented below.

**No database was connected to at any point.** `prisma validate` and
`prisma generate` were run (schema-only, `DATABASE_URL` set to a dummy value
so the CLI has something to parse — no connection attempted). No `migrate`,
`db push`, or `db pull` was run, per the hard constraint.

**No real network call to any AI provider, email provider, or external site
was made anywhere in this build** — this epic adds zero new provider calls
of its own; it reads Epic 7/8's already-computed `ai_runs`/
`brand_observations` rows and Epic 4's already-computed `seo_keywords`/
`seo_opportunities` rows, and every test uses a fully mocked `@bebest/database`.

**No git commands were run.** Two files were found genuinely modified by a
concurrent agent (Epic 17) mid-build — `packages/database/prisma/
schema.prisma` and `src/client.ts`/`src/index.ts` had gained `snapshot_
requests`/`snapshot_status`, and `apps/api/src/app.ts` had gained the
`/api/snapshot` mount. Each was re-read immediately before editing (per the
task's standing instruction) and my additions merged in cleanly alongside
that work without touching it.

---

## The two schema questions this epic had to answer first

**1. Is the ported `opportunities` table this epic's table? No.** It exists
(checked before writing anything), but keys off `gap_id -> gap_analysis ->
intents/analyses` — the same LEGACY pipeline Epic 8 already carved a
deliberate line around for `geo_gaps`/`gap_analysis` (DECISIONS.md §21) —
and its actual column set (`unified_score`, `priority_tier`, `action_type`,
`expected_impact`, `keyword_or_query`) does not match this epic's literal
field list (`type`, `intent`, `seo_demand_score`, `geo_gap_score`,
`effort_score`, `impact_score`, `opportunity_score`, `priority`) at all.

**2. Epic 4 already took the obvious fallback name.** Epic 4 hit the
identical "opportunities is taken" situation and resolved it by naming its
own (deliberately SEO-only) table `seo_opportunities`. That name is now also
taken, and it's the wrong shape anyway — this epic's output is wider
(SEO-only, GEO-only, AND unified rows in one table). Resolution: a third,
disambiguated name, **`unified_opportunities`**, plus a genuinely-unclaimed
**`opportunity_evidence`**. Full reasoning: `packages/database/DECISIONS.md`
§22.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **`unified_opportunities`** (new table) — `organization_id`, `brand_id`,
  `query_id` (FK to Epic 5's `queries`, `Restrict`), `intent_text`
  (snapshotted), `type` (new `unified_opportunity_type` enum:
  `seo|geo|unified|content|technical`), `seo_demand_score`/`geo_gap_score`
  (nullable `Decimal(5,2)`, independently null when that signal has no
  data), `effort_score`/`impact_score`/`opportunity_score`
  (`Decimal(5,2)`), `scoring_formula_version`, `status` (reuses the
  existing `opportunity_status` enum), `priority` (plain `SmallInt`,
  1/2/3), `dismissal_reason`, `title`, `updated_by`. **`@@unique([organization_id,
  brand_id, query_id])`** is the idempotency key `POST .../recompute` upserts
  against.
- **`opportunity_evidence`** (new table) — `opportunity_id` (Cascade),
  `source_table`/`source_id` (open, unconstrained — same precedent as
  `action_type`), `summary` (the exact evidence sentence), `raw_data`
  (JSONB).
- **`prisma/migrations/0010_opportunity_engine/`** — `rls.sql` (standard
  `tenant_isolation` policy on both new tables) and `indexes.sql` (one
  partial index, `idx_unified_opportunities_open_score`, `WHERE status !=
  'dismissed'`).
- `src/client.ts` / `src/index.ts` — export `unified_opportunities`,
  `opportunity_evidence`, `unified_opportunity_type`.
- `prisma validate` + `prisma generate` both clean. Full reasoning for every
  decision above: `packages/database/DECISIONS.md` §22.
- **One additive change to Epic 4's own files**, both purely exporting an
  already-computed constant so this epic could reuse it instead of
  duplicating it: `lib/seo/keyword-to-opportunity.ts`'s
  `DEFAULT_TECHNICAL_DIFFICULTY` and `lib/seo/opportunity-scoring.ts`'s
  `MIN_EFFORT_DENOMINATOR` are now `export`ed (no behavior change — verified
  by re-running Epic 4's full existing test suite, still green).

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/opportunities/merge-scoring.ts`** (new, pure, no DB/network/
  clock — same discipline as `lib/ai-visibility/scoring.ts`/`competitive.ts`)
  — the actual merge formula. See its header comment for the full spelled-out
  math; summary:
  - `combineSignals(a, b)` — probabilistic-OR (`100 - (1-a/100)(1-b/100)*100`),
    not a sum. Equals the single value when only one signal present; strictly
    exceeds either when both are present and each < 100; never exceeds 100.
  - For `seo`/`geo`-only intents: Epic 4's own `computeOpportunityScore` is
    called once (`currentCoverage: 0` — Epic 4's own fresh-keyword default;
    also exactly correct for GEO since `classifyIntentGaps` only ever fires
    when the brand's mention rate is 0), and its `valueScore`/`effortScore`/
    `opportunityScore` are reported straight through.
  - For `unified` intents: SEO-only and GEO-only standalone results are each
    computed via `computeOpportunityScore` first, then combined —
    `impactScore = combineSignals(seoValue, geoValue)`, `effortScore =
    min(seoEffort, geoEffort)` (a unified opportunity is modeled as ONE
    content asset closing both gaps, never requiring more effort than the
    easier of the two alone — the epic's own "define GEO effort, versioned"
    instruction), and `opportunityScore` re-applies Epic 4's exact
    `Value*0.7 + (Value/Effort)*0.3` shape (its own exported epsilon floor
    reused) to those combined numbers. This construction is **mathematically
    guaranteed** `>= max(seoOnly, geoOnly)` under the same formula (proven in
    the header comment; equality only possible at the literal 0-100
    ceiling — an honest answer, not a bug, when a signal is already maxed).
  - `geoContentComplexity(severity)` — this epic's own documented v1
    mapping (`high`→70, `medium`→50, `low`→30) since Epic 8 has no "effort"
    concept of its own.
  - `priorityFromScore` — 1/2/3 from opportunity_score thresholds (60/30).
  - `isMaterialChange` / `MATERIAL_CHANGE_SCORE_DELTA = 15` — a `type`
    change is always material; otherwise a >=15-point score move is.
  - `OPPORTUNITY_ENGINE_FORMULA_VERSION = '1.0'`.
  - 17 unit tests (`merge-scoring.test.ts`), including the DoD-required
    "unified strictly higher than either alone" property and the documented
    ceiling edge case.
- **`src/lib/opportunities/serialize.ts`** — `serializeOpportunity`,
  `serializeEvidence`, `serializeOpportunityDetail` (evidence inlined).
- **`src/routes/opportunities.ts`** — `POST /brands/me/opportunities/recompute`,
  `GET /brands/me/opportunities`. See "The merge, end to end" in the file's
  header comment; summary of the DB-facing half:
  1. `loadCompetitiveDataset` (Epic 8's own function, not reimplemented)
     resolves the brand's active query set + most recent completed brand/
     competitor runs. `dataset.queries` IS the Query Universe this epic
     iterates.
  2. `seo_keywords` (via `keyword_groups.brand_id` — `seo_keywords` has no
     direct `brand_id`) are matched to each query's `text`, trimmed +
     case-insensitive (documented v1 limitation — no fuzzy matching; the two
     tables have no shared key). The matched keyword's most recent
     `seo_opportunities` row is preferred when one exists.
  3. `classifyIntentGaps` (Epic 8's own function) runs once over every query,
     keyed by `queries.id` directly.
  4. `buildMergeResult` turns whichever signal(s) exist into one row + its
     evidence, or `null` (skipped) when neither is present.
  5. Idempotent upsert on `(organization_id, brand_id, query_id)` inside one
     `withOrgContext` transaction, sequential per query (same shared-`tx`
     constraint every other multi-write route in this codebase documents).
- **`src/routes/opportunity-details.ts`** — `GET /opportunities/:id` (full
  detail, evidence trail inlined), `PATCH /opportunities/:id` (status/
  priority, audit-logged via `auditLog` middleware, `dismissalReason`
  required when transitioning to `dismissed`).
- **`src/app.ts`** — mounted `/api/brands/me/opportunities` and
  `/api/opportunities`.
- 9 route-level tests (`opportunities.test.ts`) covering the exact DoD
  scenarios by name (see below).

---

## Idempotency and the "dismissed opportunity doesn't reappear" rule — spelled out

This epic's spec calls both of these out explicitly as easy to get wrong.
Exact behavior, as implemented and tested:

- **No signal → no row.** A query with neither a matched keyword nor a GEO
  gap finding is skipped entirely (`skippedNoSignal` in the response
  summary) — never an empty/zero-score row.
- **First recompute, one signal → create**, `status: 'new'`.
- **Re-recompute, unchanged data → update the SAME row** (matched by the
  `(organization_id, brand_id, query_id)` unique constraint), never a second
  row. Evidence is fully replaced (`deleteMany` + `createMany`) so it never
  goes stale against the new score. Proven by a test that calls `POST
  .../recompute` twice in a row and asserts exactly one row exists both
  times, with `summary.created`/`summary.updated` reporting `1`/`0` then
  `0`/`1`.
- **Row is `new`/`in_progress`/`completed` → recompute always updates its
  scores/type/evidence in place**, status left untouched (no unrequested
  status flip).
- **Row is `dismissed` and the signal did NOT materially change
  (`isMaterialChange` false) → left completely untouched.** Neither scores
  nor evidence nor status are touched at all — `summary.skippedDismissed`
  counts it. This is the literal "doesn't reappear" behavior the spec asks
  for.
- **Row is `dismissed` and the signal DID materially change** (`type`
  changed, or `opportunity_score` moved by >= 15) **→ reactivated**: status
  reset to `new`, `dismissal_reason` cleared, `updated_by` set to `null`
  (this is a SYSTEM-caused transition — the underlying data changed, no
  human acted — so attributing it to whichever human dismissed the row
  originally would be a lie). `summary.reactivated` counts it. Proven by a
  test that dismisses a unified opportunity, then simulates the brand's AI
  coverage improving (mention rate goes from 0% to 75% for that query,
  which makes `classifyIntentGaps` stop firing entirely) and asserts the row
  flips back to `new` with `type: 'seo'` (the GEO signal is now genuinely
  gone, not just re-scored).

---

## Evidence — the exact sentence format

Per intent, up to two kinds of evidence rows are written:

- **One SEO row** (when a keyword matched): `sourceTable: 'seo_keywords'`,
  `sourceId` = the keyword's own id, summary e.g. `"best freight visibility
  software" gets an estimated 500 monthly searches.` (or, when no volume
  data exists, `"..." gets no search-volume data yet (estimated demand score
  N).`).
- **One GEO row per contributing competitor** (when a GEO gap finding
  exists): `sourceTable: 'ai_runs'`, `sourceId` = that competitor's own
  `ai_runs.id` for its most recent completed run on the active query set,
  summary = Epic 8's own `buildQueryComparisonSentence` output, verbatim —
  e.g. `For "best freight visibility software," CompetitorA appears in 84%
  of responses at position 1, you appear in 0% of responses.` — matching the
  epic spec's own quoted example format exactly (the sentence-building
  function itself is reused, not re-derived).

A `unified` opportunity therefore always has at least 2 evidence rows (1 SEO
+ >=1 GEO), each independently traceable back to a real Prisma row id, never
a generic paraphrase.

---

## Response shapes

`POST /brands/me/opportunities/recompute` → `200`:
```json
{
  "querySetId": "uuid",
  "summary": {
    "intentsConsidered": 12,
    "created": 3,
    "updated": 5,
    "reactivated": 1,
    "skippedDismissed": 1,
    "skippedNoSignal": 2
  },
  "opportunities": [ /* every row created/updated/reactivated this run, serialized, sorted by opportunity_score desc */ ]
}
```
`404 { "error": "no_active_query_set", "message": "..." }` when the brand has
no active query set (same convention `competitive-intelligence.ts` uses).

`GET /brands/me/opportunities?status=&type=&priority=&limit=&offset=` → `200`:
```json
{ "opportunities": [ /* serializeOpportunity */ ], "pagination": { "total": 12, "limit": 25, "offset": 0 } }
```
Each serialized opportunity:
```json
{
  "id": "uuid", "queryId": "uuid", "intentText": "best freight visibility software",
  "type": "unified", "seoDemandScore": 50, "geoGapScore": 84,
  "effortScore": 24, "impactScore": 92, "opportunityScore": 65.55,
  "scoringFormulaVersion": "1.0", "status": "new", "priority": 1,
  "dismissalReason": null, "title": "Unify SEO + AI visibility for \"...\"",
  "createdAt": "...", "updatedAt": "..."
}
```

`GET /opportunities/:id` → `200`, the same shape plus `"evidence": [ { "id", "opportunityId", "sourceTable", "sourceId", "summary", "rawData", "createdAt" }, ... ]`. `404 { "error": "Opportunity not found" }` for a wrong/foreign id (never a 403 that confirms existence).

`PATCH /opportunities/:id` — body `{ status?, priority?, dismissalReason? }`
(at least one of `status`/`priority` required; `dismissalReason` required
when `status: "dismissed"`) → `200`, same detail shape. `422` on a missing
`dismissalReason` when dismissing. Audit-logged via the `auditLog`
middleware (`action: 'opportunity.status_changed'`) regardless of which
field(s) changed.

---

## Tests

- `src/lib/opportunities/merge-scoring.test.ts` — 17 tests, pure formula
  correctness (combine-signals boundary behavior, type classification,
  priority buckets, the DoD's "unified strictly higher" property with a
  realistic mid-range fixture, and the documented 0-100-ceiling edge case
  where equality — not a decrease — is the correct answer).
- `src/routes/opportunities.test.ts` — 9 tests: 404 with no active query
  set; the fixture-driven "exactly one unified row, higher-scored, with
  evidence citing the specific keyword/AI-response data" scenario (the
  epic's end-to-end flow step 1+2); the two-consecutive-calls idempotency
  proof (step 3); the dismissed-row skip and the materially-changed
  reactivation (step 4+5); the list endpoint; the evidence-trail-inlined
  detail endpoint; the dismissal-reason-required + audit-logged PATCH (step
  5); and a cross-org 404 (step 6, tenant isolation).
- Full existing `@bebest/api` suite re-run: 540 passed (54 intentionally
  `.todo`/`.skip`, the pre-existing "NEEDS LIVE DB" tenant-isolation file —
  untouched, no new entries needed since `unified_opportunities`/
  `opportunity_evidence` use the exact same generic `tenant_isolation`
  policy template every other table's entry there already covers). Two
  unrelated files (`ai-visibility/pipeline.test.ts`, `routes/crawl-jobs.test.ts`)
  timed out only when the ENTIRE suite ran under full parallel load; both
  pass cleanly in isolation and were not touched by this epic — a pre-
  existing resource-contention flake, not a regression.
- `@bebest/database`: `prisma validate`, `prisma generate`, `tsc --noEmit`,
  `eslint`, and its own `vitest` suite (7 tests) all clean.
- `turbo run typecheck lint test build --filter=@bebest/database
  --filter=@bebest/api` — all 7 tasks green.

---

## What's not done / known limitations (documented, not silently skipped)

1. **SEO<->intent matching is exact text, not fuzzy.** `seo_keywords` (Epic 4)
   has no FK to `queries` (Epic 5) — the two tables were built independently
   with no shared key. A keyword whose text doesn't exactly match (trimmed,
   case-insensitive) a query's text is invisible to the merge even if it is
   semantically the same intent. A future epic could add a real link
   (either a shared `keyword_id`/`query_id` column, or an embedding-based
   similarity match) — flagged here rather than silently guessed at.
2. **Only `classifyIntentGaps` (Type 1: "competitor appears, brand doesn't")
   feeds the GEO side of the merge.** Epic 8 also classifies content/entity/
   source gaps, but those are category- or domain-level aggregates, not
   single-intent findings — they don't have a natural one-to-one `query_id`
   to merge against the way `intent_gap` does. A future epic could define a
   `content`/`technical`-typed opportunity sourced from those (the
   `unified_opportunity_type` enum already reserves both values for exactly
   this).
3. **`effort`/`impact`/`opportunity` scores never account for real ranking
   or citation-building cost data** — same limitation Epic 4's own formula
   already has (`currentCoverage` is always 0; `technicalDifficulty` falls
   back to a placeholder `50` when no keyword's own difficulty is known).
   This epic inherits, not introduces, that gap.
4. **No scheduled/automatic recompute.** `POST .../recompute` is caller-
   triggered only (matches the spec's literal API surface — no cron/agent
   trigger is defined by this epic; Epic 12's agents are the eventual
   scheduler, out of scope here).
5. **Frontend not built** — a separate agent wires the Opportunities screen
   against these exact routes/shapes.
