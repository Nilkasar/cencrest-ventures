# Epic 7 — AI Visibility Engine / GEO core (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root
marketing site was modified. **Frontend is not built** — a separate agent
wires the Epic 7 screen against the real routes documented below.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run (schema-only, `DATABASE_URL` set to a dummy
value so the CLI has something to parse — no connection attempted). No
`migrate`, `db push`, or `db pull` was run, per the hard constraint.

**No real network call to any AI provider was made anywhere in this build**,
including in tests — every provider in every test is a hand-rolled fake
implementing the `AIProvider` interface (`@bebest/ai-provider`), per the
task's hard constraint.

**This build ran concurrently with another agent's Epic 4 (SEO
Intelligence) work in the same repo.** Both landed schema additions and
`app.ts`/`client.ts`/`index.ts`/`package.json` edits in overlapping windows.
Every shared file was re-read immediately before each edit here and both
sets of changes merged cleanly — verified by re-running `prisma validate`,
`tsc --noEmit`, `eslint`, and the full test suites for `@bebest/database`,
`@bebest/ai-provider`, and `@bebest/api` after the fact, not assumed. No
migration-folder-numbering collision: Epic 4 had already landed
`0007_seo_intelligence` by the time this build started; this epic's
migration is `0008_ai_visibility_engine`.

---

## The naming collision this epic hit (read this first)

The spec (`docs/epics/07-ai-visibility-engine.md`) calls for three new
tables: `ai_runs`, `ai_responses`, `brand_observations`. The ported schema
(Epic 0) already has a `model ai_responses` — a **different, older**
`questions -> prompt_jobs -> ai_responses` pipeline, FK'd from `citations`/
`mention_extractions`. The spec's own text says its new tables are "not the
legacy `runs`/`responses`," but the literal name it then picks for its own
response table is already taken by a real, load-bearing model.

Same situation, same resolution, as Epic 2's `entities`/`brand_entities`
split and Epic 5's `queries` vs `questions`/`query_set_questions` split: the
OLD table is left completely untouched, and this epic's table gets a
disambiguating name — **`ai_run_responses`**. Every route/service/test in
this build uses that name. Full reasoning in
`packages/database/DECISIONS.md` §19.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

Three new models (`prisma/schema.prisma`, migration
`prisma/migrations/0008_ai_visibility_engine/`):

- **`ai_runs`** — one execution of a `query_set` across a set of providers.
  `providers String[]` (snapshotted at PREPARE time), `status` (`queued |
  running | completed | failed`, VARCHAR+CHECK), `total_jobs`/
  `completed_jobs`/`failed_jobs`, the four formula components
  (`mention_score`/`recommendation_score`/`position_score`/
  `coverage_score`) stored individually alongside the composite
  `ai_visibility_score`, plus `scoring_formula_version`.
- **`ai_run_responses`** — one (query x provider) result. `raw_response`
  is written the instant the GEO-query provider call succeeds; only
  `extraction_status`/`extraction_error`/`extracted_at` are ever touched
  afterward, by UPDATE, never by rewriting `raw_response`. `request_id`/
  token/latency columns are nullable (see "Evidence preservation" below for
  why).
- **`brand_observations`** — the ADR-004 boundary (LLMs write this, nothing
  else). `ai_run_response_id` is `@unique` (1:1). Column set is
  `docs/12-ai/AI_ARCHITECTURE.md`'s `BrandObservation` interface
  transcribed field-for-field. `extraction_confidence` reuses the Epic 2
  `claim_confidence` enum; `brand_sentiment`/
  `brand_recommendation_strength` are their own VARCHAR+CHECK columns (the
  legacy `sentiment_val` enum lacks `mixed`, which this epic's spec
  requires).

Full table-by-table reasoning, every FK's `onDelete` policy and why, in
`packages/database/DECISIONS.md` §19.

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/ai-visibility/scoring.ts`** — the AVS formula v1.0, pure and
  deterministic (`computeMentionScore`/`computeRecommendationScore`/
  `computePositionScore`/`computeCoverageScore`/`computeAiVisibilityScore`).
  22 unit tests with fixed, hand-verified inputs (`scoring.test.ts`),
  including a parameterized test proving the four returned components
  recombine under the stated weights to exactly the returned composite, for
  several different inputs — the evidence-traceability hard gate.
- **`src/lib/ai-visibility/observation-schema.ts`** — the `BrandObservation`
  TypeScript type + matching JSON Schema handed to `extract<T>()`.
- **`src/lib/ai-visibility/provider-registry.ts`** — `apps/api`'s
  composition root for `@bebest/ai-provider` (reads
  `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/
  `PERPLEXITY_API_KEY`/`OLLAMA_BASE_URL` from `process.env`) — the piece
  Epic 6's own `DECISIONS.md` explicitly left for whoever builds the epic
  that consumes it. `taskDefaults` is left at the package's own
  `DEFAULT_TASK_DEFAULTS` (`'geo.query'` already fans out to all 4 cloud
  providers there — never overridden to weaken this).
- **`src/lib/ai-visibility/usage.ts`** — `countAiQueriesThisMonth`, the
  `ai_queries_per_month` entitlement's usage counter.
- **`src/lib/ai-visibility/pipeline.ts`** — the EXECUTE + AGGREGATE steps
  (`runAiVisibilityRun`). See "The pipeline" below.
- **`src/lib/ai-visibility/serialize.ts`** — the three response shapes
  shared by both routes (see "API surface" below).
- **`src/prompts/geo/brand-query.v1.0.txt`** — the GEO query prompt. Just
  `{{queryText}}` — deliberately no framing that reveals this is a
  brand-visibility measurement (that would bias a real AI assistant's
  answer and invalidate the entire measurement).
- **`src/prompts/geo/extraction-brand-observation.v1.0.txt`** — the
  extraction prompt: brand name + aliases + the raw response text in, a
  single `BrandObservation`-shaped JSON object out.
- **`src/lib/entitlements.ts`** — added `ai_queries_per_month` to
  `PlanLimits`/`PLAN_LIMITS`, transcribed verbatim from
  `docs/16-billing/BILLING_ARCHITECTURE.md`'s "Plan Limits" JSON (free 50 /
  starter 500 / growth 2000 / pro 10000 / agency 50000; managed/enterprise
  unlimited — no documented number for either, same placeholder precedent
  `queries_per_query_set` already established). 8 new tests in
  `entitlements.test.ts`.
- **`src/routes/ai-runs.ts`** — `GET /` (list) + `POST /` (PREPARE+QUEUE),
  mounted at `/api/brands/me/ai-runs`.
- **`src/routes/ai-run-details.ts`** — `GET /:id`, `GET /:id/score`,
  `GET /:id/responses`, mounted at `/api/ai-runs`.
- `app.ts` wired both routes; `apps/api/package.json` gained
  `@bebest/ai-provider: workspace:*`.

---

## The pipeline (`docs/12-ai/AI_ARCHITECTURE.md`'s "GEO Query Execution")

PREPARE and QUEUE happen in `routes/ai-runs.ts`'s `POST /` handler,
synchronously, before anything is scheduled — same split Epic 3's crawler
established (`routes/crawl.ts` / `lib/crawler/engine.ts`):

1. **PREPARE** — resolve the brand's one **`active`** `query_set` (404
   `no_active_query_set` if none); load its non-deleted `queries` (422
   `query_set_empty` if zero); resolve providers via
   `getDefaultAiProviderRegistry().resolveNames('geo.query')` (the real
   registry resolution logic, never a hand-copied literal array — this is
   what the routing test proves never silently becomes `['ollama']`);
   compute `totalJobs = queries.length * providers.length`; **check the
   `ai_queries_per_month` entitlement against `totalJobs` BEFORE creating
   any row or calling any provider** (`checkUsageLimit` + a specific 402
   `ai_query_limit_reached` body naming the limit/current/requested/
   upgrade path); create the `ai_runs` row (`status: 'queued'`).
2. **QUEUE** — `setImmediate(() => runAiVisibilityRun(...))`, same
   documented `// TODO: replace with durable queue (pg-boss)` placeholder
   Epic 3 already established (still no queue package anywhere in this
   monorepo, checked again at this epic's spec time).
3. **EXECUTE** (`lib/ai-visibility/pipeline.ts`, `runAiVisibilityRun`) —
   for each query (sequential) x provider (concurrent per query, via
   `Promise.allSettled`):
   - render `geo/brand-query` template, call `provider.complete()`.
   - **on failure**: no evidence was ever received — `failed_jobs`
     incremented, no `ai_run_responses` row (there is genuinely nothing to
     store).
   - **on success**: create the `ai_run_responses` row immediately
     (`raw_response`, tokens, latency, `request_id`, `extraction_status:
     'pending'`) — **before** extraction is even attempted.
   - resolve the extraction provider via `registry.resolveAvailable('extraction')`
     (Ollama by default — a completely separate provider/task from the
     GEO-query call above), render `geo/extraction-brand-observation`
     with the raw text just received, call
     `extractionProvider.extract<BrandObservation>()`.
   - **on success**: create the `brand_observations` row (linked to the
     exact `ai_run_responses.id`), mark `extraction_status: 'completed'`,
     `completed_jobs` incremented.
   - **on failure** (e.g. `ExtractionValidationError`): mark
     `extraction_status: 'failed'` + `extraction_error` on the **already-
     persisted** response row — the raw text is untouched and still fully
     readable — `failed_jobs` incremented.
4. **AGGREGATE** — once every query has been processed, read back every
   `brand_observations` row this run produced, call
   `computeAiVisibilityScore` once, store all five score fields +
   `scoring_formula_version` on `ai_runs`, `status: 'completed'`.
5. **DELIVER** — not built (see "Not done" below).

**Why evidence preservation holds by construction, not just by care**: the
GEO-query call and the extraction call are two independent provider calls
against two different task types (`'geo.query'` vs `'extraction'`). A
failure in the second can never retroactively erase what the first already
committed to the database — there is no shared failure mode. This is
proven directly in `pipeline.test.ts`'s single (deliberately dense)
integration-style test, which also proves the provider-routing guarantee:
the fake Ollama provider's `.complete()` is asserted **never called** (GEO
queries never route to it) and the two fake cloud providers' `.extract()`
are asserted **never called** (extraction never runs on a GEO-query
provider).

---

## API surface (exact response shapes — the frontend agent depends on this)

All routes: `requireAuth` -> `requireOrgFromToken('viewer')` -> RBAC. Read
routes use `view_intelligence` (owner/admin/analyst/editor/viewer); the
trigger route uses the pre-existing `run_ai_analysis` action
(owner/admin/analyst) — this epic did not need a new RBAC action.

### `GET /api/brands/me/ai-runs`

`200` -> `AiRun[]`, newest first:

```ts
interface AiRun {
  id: string;
  brandId: string;
  querySetId: string;
  providers: string[];              // e.g. ["openai","anthropic","google","perplexity"]
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  progressPct: number;              // 100 once status is completed/failed
  aiVisibilityScore: number | null; // null until AGGREGATE finishes
  scoringFormulaVersion: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `POST /api/brands/me/ai-runs`

Body: none (kicks off a run against the brand's `active` query_set).

- `404 { error: 'Brand profile not found', message }` — no brand yet.
- `404 { error: 'no_active_query_set', message }` — no `active` query_set.
- `422 { error: 'query_set_empty', message }` — active set has zero queries.
- `402 { error: 'ai_query_limit_reached', message, metric, limit, current, requested, plan, upgradeTo }`
  — would exceed the plan's monthly AI-query cap. **Rejected before the
  `ai_runs` row exists and before any provider is called** — verified
  directly in `routes/ai-runs.test.ts`.
- `202 AiRun` (`status: 'queued'`) on success — history preserved, this is
  always a brand-new row, never an update to a prior run (re-running the
  same query_set was verified via `ai-runs.test.ts`'s "history preserved"
  intent; the DB-level proof of a genuinely new id each time is inherent to
  `ai_runs.create` never being called with an existing id).

### `GET /api/ai-runs/:id`

`200 AiRun` (same shape as the list). `404` if the id doesn't exist or
belongs to another org (never a 403 — tenant isolation, verified in
`ai-run-details.test.ts`).

### `GET /api/ai-runs/:id/score`

**Always 200**, even before AGGREGATE finishes (`computed: false`, every
score field `null`) — a frontend polls this exactly like it polls run
status, never needing to special-case "not ready" as an error.

```ts
interface AiRunScore {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  computed: boolean;                       // false until AGGREGATE has run
  aiVisibilityScore: number | null;
  scoringFormulaVersion: string | null;    // "1.0"
  formula: string;                          // literal formula text, for display
  breakdown: {
    mentionScore: { value: number | null; weight: 0.25; weightedContribution: number | null };
    recommendationScore: { value: number | null; weight: 0.40; weightedContribution: number | null };
    positionScore: { value: number | null; weight: 0.20; weightedContribution: number | null };
    coverageScore: { value: number | null; weight: 0.15; weightedContribution: number | null };
  };
}
```

**Guarantee, verified in both `scoring.test.ts` and `ai-run-details.test.ts`**:
`breakdown.*.weightedContribution` summed equals `aiVisibilityScore` exactly
(2-decimal rounding applied identically on both sides) — this is what lets
the UI show its work per `docs/11-geo/GEO_ENGINE.md`'s evidence-trace
example without ever risking a display that doesn't add up.

### `GET /api/ai-runs/:id/responses?limit=&offset=&queryId=&provider=&extractionStatus=`

`200`:

```ts
interface AiRunResponsesPage {
  items: AiRunResponse[];
  total: number;
  limit: number;   // default 50, max 200
  offset: number;  // default 0
}

interface AiRunResponse {
  id: string;
  queryId: string;
  provider: string;
  model: string;
  promptVersion: string;
  temperature: number | null;
  rawResponse: string;             // ALWAYS populated, even when extractionStatus is 'failed'
  requestId: string | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensTotal: number | null;
  latencyMs: number | null;
  extractionStatus: 'pending' | 'completed' | 'failed';
  extractionError: string | null;
  extractedAt: string | null;
  createdAt: string;
  observation: BrandObservationDto | null; // null only if extraction hasn't succeeded
}

interface BrandObservationDto {
  id: string;
  queryId: string;
  aiRunResponseId: string;          // == the parent AiRunResponse.id
  brandMentioned: boolean;
  brandFirstPosition: number | null; // 0..1
  brandMentionCount: number;
  brandSentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
  brandContext: string | null;
  brandRecommended: boolean;
  brandRecommendationStrength: 'strong' | 'weak' | 'implied' | null;
  competitorsMentioned: string[];
  citedUrls: string[];
  citedDomains: string[];
  responseLanguage: string | null;
  responseWordCount: number | null;
  extractionModelUsed: string;
  extractionPromptVersion: string;
  extractionConfidence: 'high' | 'medium' | 'low';
  createdAt: string;
}
```

Every response embeds its (at most one) observation inline, so the UI can
walk score -> a specific intent's breakdown (filter this endpoint by
`queryId`) -> a specific raw response in one request per page — the
non-negotiable "drill from the number down to the raw response" requirement.

---

## Formula interpretation decisions (read `scoring.ts`'s own doc comment for the full reasoning)

The source docs (`docs/11-geo/GEO_ENGINE.md` and `docs/12-ai/AI_ARCHITECTURE.md`)
disagree with each other and, in one place, with themselves:

1. **"Intents" vs "queries"** — this schema has no separate "intent" entity;
   a query merely carries an `intent_type` tag. `CoverageScore`'s
   "intents_covered / total_intents" and `RecommendationScore`'s "queries"
   both resolve to the same denominator: distinct `queries` rows in the
   run's query_set.
2. **"Top-3-recommended"** — `BrandObservation` has no numeric
   recommendation-rank field (only a boolean `brandRecommended` + a
   strength enum), and `AI_ARCHITECTURE.md`'s own reference implementation
   drops the "top-3" qualifier entirely. This implementation does the same
   — "recommended" means the extraction pipeline judged
   `brandRecommended: true`, not "ranked in the top 3 of an explicit list"
   (nothing in the extracted data could distinguish the two).
3. **`GEO_ENGINE.md`'s own worked example doesn't check out**: "(41 × 0.25)
   + (28 × 0.40) + (48 × 0.20) + (19 × 0.15) = 32" is arithmetically 33.9,
   not 32. The formula (not the broken worked total) is what's implemented;
   `scoring.test.ts` uses hand-verified fixed inputs instead of
   transcribing that example.
4. **Denominator for `MentionScore`/`CoverageScore`/`RecommendationScore`
   is the PLANNED total** (`totalQueries` x `totalProviders`, or
   `totalQueries`), not the count of observations that happen to exist — a
   provider outage or an extraction failure reduces the numerator (fewer
   mentions/recommendations counted) without shrinking the denominator, so
   a run with real failures scores lower than a fully-successful run over
   the same query set, which is the behavior the literal formula text
   ("queries x models," not "successful responses") actually specifies.

---

## Tests

- `lib/ai-visibility/scoring.test.ts` — 22 tests, pure formula unit tests
  with fixed inputs (the hard DoD gate), including the "breakdown sums to
  total" invariant checked across multiple different inputs.
- `lib/ai-visibility/pipeline.test.ts` — one dense integration-style test
  against an in-memory fake `@bebest/database` + a real `AIProviderRegistry`
  wired with three fake providers, proving in a single run: evidence
  preserved when extraction fails, observations linked to the exact
  response they came from, GEO queries never routed to Ollama (and
  extraction never routed to a GEO-query provider), correct job accounting,
  and a hand-verified AGGREGATE score.
- `routes/ai-runs.test.ts` — 8 tests: RBAC, no-brand/no-active-set/empty-set
  errors, the entitlement rejection happening before any row is created or
  provider called, the success path's exact stored shape (providers array,
  `totalJobs`), and the same "background job throws -> run marked failed"
  pattern `crawl.test.ts` established.
- `routes/ai-run-details.test.ts` — 6 tests: tenant isolation (404, never
  403), the score endpoint's breakdown-sums-to-total guarantee, the
  `computed: false` pending state, and the responses page's evidence intact
  even for a failed extraction.
- `lib/entitlements.test.ts` — 8 new tests for `ai_queries_per_month`.
- `routes/tenant-isolation.integration.test.ts` — a new `describe.skip`
  block (NEEDS LIVE DB, same convention every prior epic used) naming the
  six scenarios specific to these three tables, including the one genuinely
  new wrinkle this epic introduces: most of the writes here come from the
  **background pipeline**, not a route handler, so the WITH CHECK proof
  needs to exercise `lib/ai-visibility/pipeline.ts` directly, not just
  `routes/ai-runs.ts`'s own `ai_runs.create`.

Full suite: `@bebest/database` (7 tests), `@bebest/ai-provider` (76 tests,
untouched, re-verified), `@bebest/api` (391 passed + 50 todo, up from 353 +
44 before this epic). `tsc --noEmit`, `eslint src --ext .ts`, and
`tsc -p tsconfig.build.json` all clean for `apps/api`; `prisma validate` +
`prisma generate` clean for `packages/database`.

---

## Not done / left for later epics

- **Durable queue.** `setImmediate` + in-process execution, same documented
  placeholder as Epic 3's crawler. A process restart mid-run strands it in
  `running` forever with no retry. `idx_ai_runs_queue_pending` (a partial
  index on `status IN ('queued','running')`) is already in place for the
  day a real worker polls this table.
- **Rate limiting / exponential backoff per provider.**
  `AI_ARCHITECTURE.md`'s "Rate Limiting Strategy" table (concurrency
  limits, backoff on 429s) is not implemented — `@bebest/ai-provider`
  itself makes one call per `complete()`/`extract()` and surfaces
  `ProviderRequestError.status` for a caller to act on, but this pipeline
  doesn't yet. At real scale (1,400 queries x 4 providers) this would need
  solving before a real cloud run; every test here uses a handful of
  queries against fakes with no real latency.
- **Concurrency is a documented simplification**: queries processed
  sequentially, only the 4 providers for a single query run concurrently.
  Nowhere near the "5,600 jobs, 4 concurrent" throughput target
  `AI_ARCHITECTURE.md` describes at Pro-tier scale — correct and complete
  for the pipeline SHAPE, not tuned for that volume.
- **`DELIVER` step (run summary / customer notification)** — not built;
  Epic 15 (Reporting & Notifications) is `PLANNED`, not this epic's job.
- **Competitor observations / share-of-voice / gap analysis** —
  `docs/11-geo/GEO_ENGINE.md`'s "Competitor Intelligence in GEO" and "GEO
  Gap Analysis" sections describe running the SAME query universe against
  configured competitors and diffing scores. That's Epic 8 (Competitive
  Intelligence) and Epic 9 (Opportunity Engine)'s job per `EPICS.md`; this
  epic only measures the brand itself. `brand_observations.competitors_mentioned`
  is captured (raw evidence exists) but nothing aggregates it into a
  competitor-comparison view yet.
- **Prompt-version-change re-scoring** — `AI_ARCHITECTURE.md`'s "the system
  tracks which prompt version produced which scores, and flags when
  re-scoring is recommended" is not built; `prompt_version`/
  `extraction_prompt_version` are stored per row (the traceability half),
  but nothing diffs across versions or flags staleness.
- **No `DELETE`/cancel route for a running `ai_runs`.** Once queued, a run
  proceeds to completion or failure; there's no "cancel this run" action
  (mirrors Epic 3's crawler, which has the same gap, documented there too).
- **Real cloud provider credentials / `.env` wiring** — out of scope per
  the task's hard constraint (no real network calls). `provider-registry.ts`
  reads the four env vars but a real deployment still has to set them; with
  none set, `POST /brands/me/ai-runs` would still create the run and queue
  jobs, but every `provider.complete()` call would throw
  `ProviderNotConfiguredError` and every job would land in `failed_jobs`
  with zero `ai_run_responses` rows — a real but honest failure mode, not
  silently mocked success.
