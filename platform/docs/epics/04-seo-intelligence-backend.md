# Epic 4 — SEO Intelligence (backend completion report)

Scope: `platform/apps/api` + `platform/packages/database`, backend only.
Frontend is a separate agent's job against the real routes documented here
— no fixture layer exists or should ever be built against these.

No git commands were run. No database connection was made — schema changes
were validated with `prisma validate`/`prisma generate` only (schema-only,
no `migrate`/`db push`/`db pull`). No real network calls to any AI provider
or external site were made — `NullSEODataProvider` makes zero network
calls, and every crawl-adjacent read in this epic is against Epic 3's
already-crawled `pages`/`page_issues` rows, never a live fetch.

## Schema

Four new tables, full detail (and the reasoning behind every naming/type
decision) in `packages/database/DECISIONS.md` §20:

- `keyword_groups` — `id, organization_id, brand_id, name, created_by,
  updated_by, created_at, updated_at, deleted_at`.
- `seo_keywords` — the epic's literal `keywords` table. Named `seo_keywords`
  at the Prisma/table level (not `keywords`) because the ported schema
  already has an unrelated `keywords` table reserved for a future
  autonomous-SEO-agent epic — see DECISIONS.md §20 for the full collision
  reasoning. Fields: `id, organization_id, keyword_group_id, text, intent
  (keyword_intent enum, reused), monthly_volume, difficulty, confidence
  (seo_keyword_confidence: high|medium|low|estimate), source
  (seo_provider_source: null_provider|search_console|dataforseo|semrush|
  ahrefs|serper|manual), created_by, updated_by, created_at, updated_at,
  deleted_at`.
- `seo_analyses` — `id, organization_id, brand_id, page_id (nullable ->
  pages, SetNull), analysis_type (seo_analysis_type: technical|content),
  score (0-100), findings (JSONB), analyzed_at`. Append-only, no soft
  delete/created_by (pipeline output).
- `seo_opportunities` — `id, organization_id, brand_id, keyword_id
  (nullable -> seo_keywords, SetNull), title, opportunity_type (open
  VARCHAR — see DECISIONS.md), value_score, effort_score,
  opportunity_score (all Decimal(5,2), 0-100), scoring_formula_version
  (default "1.0"), status (opportunity_status enum, reused: new|
  in_progress|completed|dismissed), evidence (JSONB), updated_by,
  created_at, updated_at`.

`issue_type` (Epic 3's enum) gained two additive values, `not_https` and
`missing_schema` — the two Page Analysis Checklist items Epic 3's crawler
does not already check (verified by reading `lib/crawler/engine.ts`).

Migration folder: `packages/database/prisma/migrations/0007_seo_intelligence/`
(`rls.sql` + `checks.sql`). `prisma validate` and `prisma generate` both
pass against the full schema (including the concurrently-developed Epic 7
additions).

## `SEODataProvider` abstraction

`apps/api/src/lib/seo/seo-data-provider.ts` — interface transcribed
verbatim from `docs/10-seo/SEO_ENGINE.md`'s "SEO PROVIDER ABSTRACTION"
(`getKeywordData`, `getCompetitorKeywords`, `getRankings`,
`KeywordData`/`RankingData` shapes). `NullSEODataProvider` is the only
implementation wired today — deterministic, zero network calls, every
`KeywordData` row carries `confidence: 'estimate'`, every `RankingData` row
carries `position: null`. `getSEODataProvider()` is the one function route
code calls (never `new NullSEODataProvider()` directly). No registry class
(unlike `@bebest/ai-provider`'s `AIProviderRegistry`) — documented reasoning
in the file's header comment: one real implementation exists today, so a
registry would be premature.

Deterministic estimation heuristics (unit-tested,
`seo-data-provider.test.ts`): `estimateVolumeTier`/`estimateDifficultyTier`
(word-count-based head/mid/long-tail tiering) and `classifyIntent` (lexical
transactional/commercial/informational classification — `navigational` is
never inferred by this brand-agnostic function, see its doc comment).

## Technical + content checklist

`apps/api/src/lib/seo/technical-checklist.ts` (unit-tested,
`technical-checklist.test.ts`, 9 tests):

- `runTechnicalChecklist(page, isHomepage)` — aggregates a page's EXISTING
  `page_issues` (already written by Epic 3's crawler at crawl time) into a
  deterministic 0-100 score (severity-weighted deduction: high=15,
  medium=8, low=3) and runs the two checklist items the crawler doesn't
  already cover (HTTPS, homepage Organization schema), returning any new
  `page_issues` rows to insert. Idempotent — re-running `/analyze` never
  inserts a duplicate `not_https`/`missing_schema` row for a page that
  already has one.
- `runContentChecklist(pages)` — brand-level aggregate (thin-content ratio +
  schema-markup ratio, 50/50 weighted).
- The file's header comment enumerates every checklist item that could NOT
  be implemented from `pages`' actual stored columns, and why (no
  primary-keyword-per-page field, no per-page heading-structure array, no
  live robots.txt/sitemap-membership check, no outbound-link-graph data) —
  a documented gap, not a silent one.

## Opportunity scoring — formula v1.0

`apps/api/src/lib/seo/opportunity-scoring.ts` (unit-tested,
`opportunity-scoring.test.ts`, 13 tests, hand-computed fixtures):

```
Value = demand_score × (1 - current_coverage)
Effort = (content_complexity × technical_difficulty) / 100   — see the
  file's header comment #1 for why the /100 (the doc's "(0-100)"
  parenthetical on Effort is only true if both 0-100 inputs are normalized
  this way; a raw product of two 0-100 numbers ranges 0-10,000)
Opportunity Score = clamp(Value × 0.7 + (Value / Effort) × 0.3, 0, 100)
```

`scoring_formula_version = "1.0"` stamped on every result and stored per
row. A tiny epsilon floor on the Effort denominator prevents
Infinity/NaN at Effort = 0; the final clamp is what actually bounds the
few near-zero-effort cases (verified by a dedicated fixture test).

`apps/api/src/lib/seo/keyword-to-opportunity.ts` (unit-tested, 11 tests)
maps a generated `seo_keywords` row to the formula's four raw inputs
(`normalizeDemandScore`, `contentComplexityForIntent`,
`classifyOpportunityType`) — every mapping is a documented v1 design
decision (only the formula itself is given verbatim by the spec).

## Routes (mounted at `/api/brands/me/seo`)

Same single-brand-per-org convention as every other Epic 2+ resource
(`getBrandForOrg`, no `brandId` in the URL). RBAC reuses `view_intelligence`
(reads) and `create_brand_profile` (writes) — the epic spec defines no new
RBAC action, same reuse Epic 5's `query-sets.ts` established.

### `POST /brands/me/seo/analyze`

Body (optional): `{ crawlJobId?: string (uuid) }` — defaults to the brand's
most recent crawl job.

Runs the technical checklist against every page in that crawl job, writes
one `seo_analyses` row per page (`analysis_type: 'technical'`) plus one
brand-level row (`analysis_type: 'content'`), and inserts any new
`page_issues` rows the checklist found.

Responses:
- `200` —
  ```json
  {
    "crawlJobId": "uuid",
    "pagesAnalyzed": 12,
    "issuesCreated": 3,
    "technicalAnalyses": [
      { "id": "uuid", "pageId": "uuid", "analysisType": "technical", "score": 92,
        "findings": { "checks": [{ "id": "not_https", "passed": false, "severity": "medium", "detail": null }] },
        "analyzedAt": "2026-..." }
    ],
    "contentAnalysis": {
      "id": "uuid", "pageId": null, "analysisType": "content", "score": 78,
      "findings": { "pagesAnalyzed": 12, "averageWordCount": 540, "thinContentPages": 2,
                     "pagesWithSchemaMarkup": 9, "pagesWithoutSchemaMarkup": 3 },
      "analyzedAt": "2026-..."
    }
  }
  ```
- `404` — no brand profile, or an explicit `crawlJobId` that isn't this
  brand's.
- `422` — `{ "error": "no_crawl_data" }` (no crawl exists yet — run
  `POST /brands/me/crawl` first) or `{ "error": "no_pages_crawled" }` (the
  crawl job has zero pages).

### `keyword_groups` CRUD

- `GET /keyword-groups` — `[{ id, name, keywordCount, createdAt, updatedAt }]`.
- `POST /keyword-groups` — body `{ name }` → `201` with the created group.
- `PATCH /keyword-groups/:id` — body `{ name }` → the updated group, `404`
  if it doesn't belong to this brand/org.
- `DELETE /keyword-groups/:id` — soft delete, `{ "success": true }`.

### `POST /keyword-groups/generate`

Body (optional): `{ name?: string }`. Reads the brand's `categories[]` +
non-deleted `use_cases` rows, generates candidate keyword phrases
(`keyword-generator.ts`, capped at `MAX_GENERATED_KEYWORDS = 100` — a
safety bound, NOT a plan-tier entitlement, see "What's not done" below),
calls `SEODataProvider.getKeywordData()`, creates one `keyword_groups` row
+ one `seo_keywords` row per result, then scores AND CREATES one
`seo_opportunities` row per keyword (see "Design decision" below).

- `201` —
  ```json
  {
    "keywordGroup": { "id": "uuid", "name": "Acme Freight Keywords", "createdAt": "...", "updatedAt": "..." },
    "keywords": [
      { "id": "uuid", "keywordGroupId": "uuid", "text": "freight visibility software",
        "intent": "informational", "monthlyVolume": 1000, "difficulty": 70,
        "confidence": "estimate", "source": "null_provider", "createdAt": "...", "updatedAt": "..." }
    ],
    "opportunities": [
      { "id": "uuid", "keywordId": "uuid", "title": "Target \"freight visibility software\"",
        "opportunityType": "use_case_page", "valueScore": 100, "effortScore": 21,
        "opportunityScore": 71.43, "scoringFormulaVersion": "1.0", "status": "new",
        "evidence": { "demandScore": 100, "currentCoverage": 0, "contentComplexity": 30, "technicalDifficulty": 70 },
        "createdAt": "...", "updatedAt": "..." }
    ]
  }
  ```
- `404` — no brand profile.
- `422` — `{ "error": "no_candidates" }` when the brand has no categories or
  use cases yet.

**Design decision (spec ambiguity, resolved and documented here):** the
epic's literal API surface lists `seo_opportunities` as "list, get,
dismiss" only — no separate create endpoint. Something has to compute
opportunities for that list to ever return anything, and the spec's own
end-to-end flow step 3 assumes rows already exist by the time `GET
/opportunities` runs. Resolution: `POST /keyword-groups/generate` creates
one scored opportunity per generated keyword, immediately, in the same
transaction — every opportunity is therefore always traceable to the exact
keyword evidence behind it (`evidence` JSONB + `keywordId`), satisfying the
UI surface's evidence-traceability requirement. `currentCoverage` is always
`0` for a freshly generated keyword (documented placeholder — no
keyword-to-existing-content mapping is built by this epic).

### `keywords` CRUD (scoped to a keyword_group)

- `GET /keyword-groups/:id/keywords` — `[{ id, keywordGroupId, text, intent, monthlyVolume, difficulty, confidence, source, createdAt, updatedAt }]`.
- `POST /keyword-groups/:id/keywords` — body `{ text, intent?, monthlyVolume?, difficulty?, confidence? }` (`confidence` defaults to `'high'` — a human typing a keyword directly is asserting it, not estimating it; `source` is always `'manual'` for this endpoint) → `201`.
- `PATCH /keyword-groups/:id/keywords/:keywordId` — partial update of the same fields.
- `DELETE /keyword-groups/:id/keywords/:keywordId` — soft delete.

All four 404 as `{ "error": "Keyword group not found" }` / `{ "error": "Keyword not found" }` when the group/keyword doesn't belong to this brand/org.

### `seo_opportunities` — list, get, dismiss

- `GET /opportunities?status=&limit=&offset=` — sorted **server-side**,
  stably, by `opportunity_score` desc (tiebreak: `created_at` asc, then
  `id` asc — the epic's end-to-end flow step 4's explicit requirement that
  the API's own ordering is authoritative, never re-sorted client-side).
  ```json
  { "opportunities": [ /* serialized rows, see above */ ], "pagination": { "total": 5, "limit": 25, "offset": 0 } }
  ```
- `GET /opportunities/:id` — one opportunity, `404` if not found.
- `PATCH /opportunities/:id/dismiss` — sets `status: 'dismissed'`,
  `updatedBy`, `updatedAt`; audited (`opportunity.dismissed`). `404` if not
  found.

## Tests

- `packages/database`: `prisma validate` + `prisma generate` pass (schema
  includes the concurrently-developed Epic 7 additions with no conflict);
  `vitest run` (7 tests, unaffected) and `eslint` both clean.
- `apps/api`: 5 new lib test files (`opportunity-scoring.test.ts` 13,
  `technical-checklist.test.ts` 9, `keyword-generator.test.ts` 6,
  `seo-data-provider.test.ts` 11, `keyword-to-opportunity.test.ts` 11 — 50
  total, all pure/deterministic, no DB mocking needed) + `routes/seo.test.ts`
  (14 tests, mocked `@bebest/database`, matching `pages.test.ts`/
  `query-sets.test.ts`'s established pattern). Full `apps/api` suite: 377
  passed, 44 `it.todo` (tenant-isolation, NEEDS LIVE DB), 0 failed.
  `tsc --noEmit`, `tsc -p tsconfig.build.json` (build), and `eslint src`
  all clean for every file this epic touched.
- Tenant isolation: `routes/tenant-isolation.integration.test.ts` gained an
  "Epic 4" `describe.skip` block (6 `it.todo`s) alongside the existing
  Epic 1/2/3/5/7 blocks — same NEEDS LIVE DB marker, since this package
  never connects to a real Postgres instance.

## What's not done

- **No real `SEODataProvider` beyond `NullSEODataProvider`.** No paid API
  key (DataForSEO/Semrush/Ahrefs/Serper) is assumed or wired, per the hard
  constraint against real network calls. `gsc_connections` (a pre-existing,
  unused table) is the natural home for a future `SearchConsoleProvider`
  implementation — its OAuth token columns already exist, nothing reads or
  writes them yet.
- **No plan-tier entitlement gating on any SEO endpoint.** Checked
  `docs/16-billing/BILLING_ARCHITECTURE.md`'s Plan Limits table before
  deciding this — unlike `competitors_tracked`/`queries_per_query_set`,
  which have documented per-tier numbers, no SEO-related metric appears
  there at all. Inventing a number would be a product decision this backend
  task isn't positioned to make (same instinct DECISIONS.md §6 applies to
  CHECK constraints on open taxonomies). `generate` is instead bounded by a
  fixed, undocumented-as-a-plan-limit safety cap
  (`MAX_GENERATED_KEYWORDS = 100`) purely to prevent an unbounded
  category × use-case cross-product in one call.
- **No keyword-to-existing-content coverage mapping.** Every
  freshly-generated keyword's `currentCoverage` is hardcoded to `0` (see
  `keyword-to-opportunity.ts`'s doc comment) — there is no feature anywhere
  in this epic or an earlier one that links a specific page to a specific
  keyword it targets, so "how well does the brand already serve this
  intent" cannot be computed from real data yet.
- **Heading-hierarchy, primary-keyword-in-title/meta/H1, robots.txt/sitemap-
  membership, and outbound-broken-link checklist items are not
  implemented** — `technical-checklist.ts`'s header comment gives the exact
  reason for each (data never captured by `pages`, or would require a live
  fetch this epic's hard constraints forbid).
- **No background job / queue for `/analyze`.** It runs synchronously in
  the request (pure computation over already-crawled data, no I/O) — unlike
  `POST /brands/me/crawl`'s `setImmediate` pattern, there's no long-running
  work to defer. If a brand's crawl grows very large, this may need to move
  off the request thread later; not a problem yet at any realistic page
  count.
- **`getCompetitorKeywords`/`getRankings` are wired but return empty/null
  data** from `NullSEODataProvider` — no route in this epic actually calls
  them yet (the API surface's literal scope is keyword generation +
  technical/content analysis + opportunities, not competitor-keyword
  analysis or rank tracking — both are named in `SEO_ENGINE.md`'s
  capabilities list but not in this epic's own API surface section).
- **Tenant isolation tests are `it.todo` (NEEDS LIVE DB)**, same standing
  gap every prior epic's equivalent block has — this package never connects
  to a real Postgres instance (hard constraint).
