# Epic 17 — Free AI + SEO Growth Snapshot (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, nothing
under `api/`, `web-app/`, or the repo-root marketing site was touched.
**Frontend is not built** — a separate agent wires the public intake form,
confirmation screen, and report page against the real routes documented
below.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run (schema-only, `DATABASE_URL` set to a dummy value
so the CLI has something to parse — no connection attempted). No `migrate`,
`db push`, or `db pull` was run. **No real network call was made to any AI
provider, email provider, or external site anywhere in this build**,
including in tests — every provider/fetch dependency is dependency-injected
and mocked; the crawl step's SSRF guard tests inject a fake `fetchImpl`/
`resolveImpl` exactly like Epic 3's own test suite does. **No git commands
were run.**

**This build ran concurrently with another agent's Epic 9 (Opportunity
Engine) work in the same repo**, both editing `packages/database/
prisma/schema.prisma`, `src/client.ts`, `src/index.ts`, and `apps/api/src/
app.ts` in overlapping windows. Every shared file was re-read immediately
before each edit here and both sets of changes merged cleanly — verified by
re-running `prisma validate`/`generate`, `tsc --noEmit`, `eslint`, and the
full test suite for both packages (`turbo run typecheck lint test --filter
@bebest/database --filter @bebest/api`) after the fact. One transient
breakage was hit and fixed: `unified_opportunity_type` was referenced by
`unified_opportunities.type` before it was declared anywhere in the schema
(the other agent's edit was mid-flight); this session briefly added the
enum (values transcribed verbatim from `docs/epics/09-opportunity-engine.md`)
to unblock `prisma validate` for both of us, then removed its own copy the
moment a re-read showed the other agent had landed the same enum
independently — no duplicate declaration was left in the final schema. A
migration-folder-numbering collision WAS hit: both agents independently
claimed `0010_*` (`0010_opportunity_engine` vs. this epic's original
`0010_free_snapshot`), since each checked the existing folder list before
the other's folder existed. Resolved by renaming this epic's folder to
`0011_free_snapshot` the moment a fresh listing showed both `0010_*`
folders present — the other agent's `0010_opportunity_engine` was left
untouched, since it was already cross-referenced from multiple places in
its own `DECISIONS.md` section.

---

## What this epic is (read `17-free-snapshot.md` first)

An orchestration epic, not a new engine. `POST /snapshot` wires together
four already-built, already-VERIFIED pipelines — Epic 1 (leads), Epic 3
(crawler/SSRF guard), Epic 5 (query generator), Epic 7 (AI visibility) —
plus a slice of Epic 4 (SEO scoring), scoped down to free-tier limits, for
a public, unauthenticated top-of-funnel form. `GET /snapshot/:token`
retrieves the result.

## Why the sub-pipelines are NOT called via their existing paid-tier entry
## points (`runCrawlJob`, `runAiVisibilityRun`) — read this before assuming
## a shortcut was taken

Every one of Epic 3/7's existing orchestrator functions has a hard
precondition this epic's caller cannot satisfy: a REAL, persisted, tenant-
owned row to attach to.

- `runCrawlJob(jobId, organizationId, brandId, rootUrl)` requires an
  existing `crawl_jobs` row, itself requiring a `brands` row, whose
  `created_by` column is a **required, non-nullable** FK to `users`. A free
  snapshot request has no authenticated user, no organization, and no
  brand — there is no legitimate value to put in `created_by`.
- `runAiVisibilityRun(runId, organizationId, brandId)` requires an existing
  `ai_runs` row (`findUniqueOrThrow`), a `brands` row, and a
  `query_set_id` pointing at persisted `queries` rows. Same problem.

Fabricating a throwaway `brands`/`crawl_jobs`/`ai_runs` row per anonymous
visitor to route around this would pollute Epic 2/3/7's real tenant tables
with rows that were never a real customer's brand, and would need an
"anonymous system user" `users` row that does not exist anywhere else in
this schema's design.

**What IS reused, exactly** (per the epic brief's own repeated "reuse X
exactly" instructions) is every genuinely reusable PURE or DI-friendly
piece underneath those orchestrators:

| Reused, unmodified | From |
|---|---|
| `safeFetch`, `assertSafeToFetch`, the whole SSRF blocklist | `lib/ssrf-guard.ts` |
| `parseRobotsTxt`, `CRAWLER_USER_AGENT` | `lib/robots.ts` |
| `extractPageData` (HTML sanitization/extraction) | `lib/html-extract.ts` |
| `MAX_CRAWL_DEPTH`, `MAX_REQUESTS_PER_SECOND` | `lib/crawler/engine.ts` |
| `generateQueryUniverse` (pure, no DB) | `lib/query-generator.ts` |
| `getDefaultAiProviderRegistry()`, `registry.resolveNames('geo.query')` (all 4 cloud providers, never Ollama) | `lib/ai-visibility/provider-registry.ts` |
| The `brand-query`/`extraction-brand-observation` prompt templates, `BRAND_OBSERVATION_SCHEMA` | `lib/ai-visibility/observation-schema.ts`, `prompts/geo/*` |
| `computeAiVisibilityScore` (formula v1.0, pure) | `lib/ai-visibility/scoring.ts` |
| `runTechnicalChecklist`, `runContentChecklist` | `lib/seo/technical-checklist.ts` |
| `checkRateLimit` / the pre-built `freeSnapshotRateLimit` (1/hr/IP) | `lib/rate-limiter.ts`, `middleware/rate-limit.ts` |
| `generateOpaqueToken`/`hashToken` | `lib/tokens.ts` |
| `EmailSender` interface | `lib/email.ts` |

**One small, additive refactor was made to enable this reuse without
duplicating logic**, in each case narrowing a function's parameter type to
the minimal structural shape it actually reads (never changing behavior for
existing callers, who already pass objects satisfying the narrower shape):

1. `lib/crawler/engine.ts` — the per-page issue-detection rules that lived
   inline inside `recordPageIssues` were extracted into a new exported pure
   function, `detectPageIssues(extracted, statusCode)`. `recordPageIssues`
   now just calls it and persists the result — **zero behavior change**,
   confirmed by `engine.test.ts` passing unmodified. This is the exact same
   rule-set the free-snapshot crawl now also calls, directly, with no
   `page_issues` row to write to.
2. `lib/seo/technical-checklist.ts` — `runTechnicalChecklist`'s parameter
   type was narrowed from `pages & { page_issues: page_issues[] }` (the
   full Prisma models) to `TechnicalChecklistPageInput` (just `url`,
   `schema_types`, and each issue's `issue_type`/`severity`/`detail`) —
   every field the function body actually reads. `runContentChecklist`'s
   parameter was narrowed the same way, to `Pick<pages, 'word_count' |
   'schema_types'>[]`. `routes/seo.ts`'s existing calls with real Prisma
   objects still compile unchanged (structural typing) — confirmed by
   `seo.test.ts` passing unmodified.

## What is a deliberate simplification (documented, not hidden)

- **No `crawl_jobs`/`pages`/`page_issues`/`ai_runs`/`ai_run_responses`/
  `brand_observations` rows are ever written** for a free snapshot. The
  entire result lives in memory for one pipeline run and is folded into
  `snapshot_requests.result_json`. There is no durable, individually-
  queryable evidence trail the way a paid customer's crawl/AI run has —
  only the summarized report. This is the direct consequence of the "no
  tenant/brand to attach persisted evidence to" reasoning above.
- **No sitemap discovery, no cross-page duplicate-title pass** in the
  free-tier crawl (`lib/free-snapshot/crawl.ts`) — both are minor gaps
  relative to Epic 3's full crawl, traded for keeping this module's only
  job "walk up to N pages, reuse the same per-page rules."
- **The query-generator's realistic output for a sparse free-snapshot
  profile is well under the free tier's 50-query cap.** The intake form
  only collects name/company/website/category/competitor — no Epic 2
  `use_cases`/`differentiators`/`markets` — so `generateCandidateQueries`
  (Epic 5, unmodified) produces far fewer candidates than a real brand
  profile would. The cap (`PLAN_CATALOG.free.limits.queries_per_query_set`,
  50) is applied correctly and is an upper bound, not a guarantee every
  free snapshot reaches the spec's "20-50 queries" range. When `category`
  is omitted (it's optional per the spec), the company name itself is used
  as the sole fallback category so there is still at least one query to
  generate, rather than a fabricated unrelated one.
- **The lightweight report (`lib/free-snapshot/report.ts`) is explicitly
  NOT Epic 9/10's opportunity/recommendation engine.** It ranks whatever
  raw signal is already in hand — SEO issue frequency/severity, per-query
  brand-absence, raw competitor-mention frequency from this run's own AI
  observations — with a small, fixed, unit-tested heuristic. The report
  itself ships a `simplificationNote` field saying exactly this, per the
  epic brief's "document this as a deliberate simplification... not a
  shortcut hidden from the user" instruction.
- **"3 competitors identified"** uses only the optional `biggestCompetitor`
  form field plus raw mention-frequency auto-detection from this run's own
  AI observations — not Epic 8's full Share-of-AI-Voice engine (a
  significantly heavier, cross-run competitive analysis).
- A GEO-query provider call failing and an extraction call failing are
  treated identically here (both simply contribute no observation) — no
  separate "extraction failed but raw text preserved" evidence state,
  because there is no persisted row for that state to live on.

---

## Schema change (`@bebest/database`)

`snapshot_requests` (already existed, already correctly un-RLS'd as a
pre-signup public flow) had no token column — only its own DB `id`, which
must never be the public lookup key. Added:

```prisma
token_hash String @unique @db.VarChar(64)
```

Same "generate once with `generateOpaqueToken`, store only the SHA-256
hash, hand the raw value to the caller a single time" pattern already used
for `magic_link_tokens`/`refresh_tokens`. `prisma/migrations/
0011_free_snapshot/checks.sql` adds `CHECK (token_hash ~
'^[0-9a-f]{64}$')` — the one piece a bare `@unique` can't express. Full
reasoning: `packages/database/DECISIONS.md` §22.

`snapshot_requests`/`snapshot_status` types are now re-exported from
`@bebest/database` (`src/client.ts`, `src/index.ts`) — they existed in the
schema before this epic but were never exported for `apps/api` to import as
types.

## `EmailSender` interface addition

`sendSnapshotReady({ to, reportUrl }): Promise<void>` was added to the
`EmailSender` interface (`lib/email.ts`) and implemented on
`ConsoleEmailSender` (logs to console, same as the other two methods).
`routes/auth.test.ts`'s `FakeEmailSender` was updated with a one-line no-op
implementation so it still satisfies the interface — no assertions in that
file changed. `app.ts` now constructs exactly one `ConsoleEmailSender` and
passes it to both `createAuthRoutes` and `createSnapshotRoutes` (previously
`createAuthRoutes` constructed its own) — the "one call site" contract
`lib/email.ts`'s own header comment describes.

---

## New files (`apps/api/src/lib/free-snapshot/`)

- **`crawl.ts`** — `crawlFreeSnapshotSite(rootUrl, maxPages, deps)`. BFS,
  same-origin-only, capped at `maxPages` (never a module constant),
  reusing `safeFetch`/robots/`extractPageData`/`detectPageIssues` exactly.
  No DB writes.
- **`ai-run.ts`** — `runFreeSnapshotAiQueries(brandName, queries, deps)`.
  Same two-call-per-job (GEO query, then extraction) pattern as
  `pipeline.ts`'s `runOneJob`, fanned out to `registry.resolveNames
  ('geo.query')` (all 4 cloud providers), aggregated with the exact same
  `computeAiVisibilityScore`. No DB writes.
- **`seo-analysis.ts`** — `analyzeFreeSnapshotSeo(crawlResult)`. Thin
  adapter feeding the in-memory crawled pages into Epic 4's
  `runTechnicalChecklist`/`runContentChecklist`.
- **`report.ts`** — `buildFreeSnapshotReport(input, seoResult, aiRunResult)`.
  Pure. Produces the exact JSON shape stored in `result_json` (below).
- **`orchestrator.ts`** — `runFreeSnapshotPipeline(snapshotRequestId,
  rawToken, input, deps)`. THE explicit orchestrator the epic brief
  requires: runs crawl → query-gen → AI run → SEO analysis → report →
  persist → email, in that order, catching everything and marking the row
  `failed` rather than throwing. `maxPages`/`maxQueries` default to
  `PLAN_CATALOG.free.limits.pages_analyzed`/`queries_per_query_set` (10/50)
  and are threaded through as explicit parameters to every sub-call —
  `lib/free-snapshot/orchestrator.test.ts` asserts each one directly (the
  epic's literal DoD requirement).

## New route (`apps/api/src/routes/snapshot.ts`, mounted at `/api/snapshot`)

`createSnapshotRoutes(emailSender: EmailSender)` — same factory pattern as
`createAuthRoutes`.

### `POST /snapshot` — public, rate-limited

Order (matches the epic's literal "IN THIS ORDER" instruction):

1. `freeSnapshotRateLimit` (Hono middleware, runs before the handler body —
   1 request/hour/IP, the exact pre-built Epic 0 bucket, no new mechanism).
2. Validate the body (zod) — `website` reuses `isSafePublicHttpUrl` (same
   refinement `routes/leads.ts` uses for `leads.website`).
3. Create the `leads` row (`source: 'free_snapshot'`, internal ops org via
   `getInternalOrgId()`) — **before anything else**, per the epic's own
   ordering.
4. Generate the report token (`generateOpaqueToken`), create the
   `snapshot_requests` row (only the hash persisted), link
   `leads.snapshot_id`.
5. Write an audit event (`snapshot.created`, `actorType: 'system'`).
6. Schedule `runFreeSnapshotPipeline` via `setImmediate` (same "create the
   row synchronously, run the real work in the background" shape as
   `routes/crawl.ts`/`routes/ai-runs.ts` — no durable queue exists in this
   monorepo yet, same documented TODO).
7. Respond `202` immediately with the spec's literal confirmation copy.

**Request body:**

```jsonc
{
  "name": "Ada Lovelace",
  "email": "ada@acme.example",
  "company": "Acme Inc",
  "website": "https://acme.example",
  "category": "CRM software",       // optional
  "biggestCompetitor": "Rival Inc", // optional
  "marketingConsent": false         // optional, defaults false
}
```

**Response `202`:**

```jsonc
{
  "message": "Your snapshot is being prepared. We'll email you within 24 hours.",
  "token": "‹64 hex chars, raw, one-time›",
  "reportUrl": "https://app.bebestwith.ai/snapshot/‹token›"
}
```

The response deliberately never includes the lead's or the
`snapshot_requests` row's real database id — `token` is the only handle the
caller ever gets, and it is returned here because there is no other way
for the caller to reach `GET /snapshot/:token` at all (only the SHA-256
hash is ever persisted).

**Other responses:** `422` (validation, including a non-public-http(s) or
SSRF-blocked-shaped `website`), `429` (rate limited — `Retry-After` header
set, no lead/snapshot row created at all).

### `GET /snapshot/:token` — public, tokenized

Re-hashes the path param and looks up `snapshot_requests.token_hash` (never
`.id`) — mirrors `routes/auth.ts`'s magic-link verify exactly.

```jsonc
// pending/processing
{ "status": "processing", "message": "Your snapshot is still being prepared. Check back soon." }

// failed — internal error detail (result_json.error) is deliberately NEVER exposed here
{ "status": "failed", "message": "We hit a problem preparing this snapshot. Please try submitting the form again." }

// complete
{ "status": "complete", "report": { /* FreeSnapshotReport, see below */ } }
```

Unknown token → `404 { "error": "Not found" }`.

### `FreeSnapshotReport` shape (`result_json` once `status: 'complete'`)

```ts
{
  generatedAt: string; // ISO timestamp
  input: { name, company, website, category: string | null, biggestCompetitor: string | null };
  aiVisibility: {
    score: number; mentionScore: number; recommendationScore: number;
    positionScore: number; coverageScore: number; formulaVersion: string;
    queriesRun: number; providers: string[];
  };
  seo: { technicalScore: number; contentScore: number; pagesAnalyzed: number };
  competitors: Array<{ name: string; mentionRate: number; autoDetected: boolean }>; // up to 3
  topAiGaps: Array<{ query: string; category: string; competitorMentionedInstead: boolean }>; // up to 3
  topSeoGaps: Array<{ issueType: string; severity: 'low'|'medium'|'high'; pageCount: number }>; // up to 3
  topPriorities: Array<{ title: string; rationale: string }>; // exactly 3
  cta: "See your full analysis — book a call or sign up.";
  simplificationNote: string;
}
```

---

## Tests added (all mocked/fake — zero real network, zero real DB)

- `lib/free-snapshot/crawl.test.ts` — page cap enforced, SSRF guard reused
  exactly (a same-origin page redirecting to a private IP is blocked and
  never fetched), `detectPageIssues` reuse, root-fetch-failure handling.
- `lib/free-snapshot/ai-run.test.ts` — fans out to all 4 cloud providers
  (never Ollama for the GEO query itself), AVS formula matches a
  hand-verified fixture, the query list is used verbatim (no internal cap).
- `lib/free-snapshot/seo-analysis.test.ts` — `runTechnicalChecklist`/
  `runContentChecklist` reuse produces the expected checks/scores.
- `lib/free-snapshot/report.test.ts` — competitor ranking (provided +
  auto-detected, capped at 3), AI-gap ranking (bottom-of-funnel + competitor-
  confirmed first), SEO-gap ranking (severity then page count), the
  "always exactly 3 priorities, honest fallback copy when there's no gap
  data" invariant.
- `lib/free-snapshot/orchestrator.test.ts` — **the epic's literal DoD**:
  asserts `crawlFreeSnapshotSite` is called with `10` (never a paid-tier
  number), `generateQueryUniverse` is called with `50`, both are real
  overridable parameters (not silently ignored), the AI step only ever
  sees the already-capped query list, the row transitions
  `processing → complete` with the built report persisted, the email is
  attempted with the raw token in the link, and a sub-pipeline rejection
  marks the row `failed` (never throws) and never sends an email.
- `routes/snapshot.test.ts` — rate limit rejects BEFORE any DB write, SSRF-
  shaped URLs rejected before a lead is created, the lead is created
  strictly before the `snapshot_requests` row and before the pipeline is
  scheduled (call-order assertion), the response never contains the lead's
  or the snapshot row's real id, the token is never equal to the persisted
  `token_hash`, `GET /:token` never leaks `result_json.error` for a failed
  run and looks the token up by its hash, never by the raw path value.

Full regression suite (`turbo run typecheck lint test` for both
`@bebest/database` and `@bebest/api`): **all passing**, including every
pre-existing epic's tests, unmodified in behavior.

---

## What's not done / left for other epics

- **Frontend** (the public intake form, confirmation screen, report page) —
  a separate agent's job, against the real routes/shapes above.
- **Real email delivery** — still `ConsoleEmailSender` (logs only), same as
  every other epic; `ResendEmailSender` is a later, separate concern
  (ADR-010), and every call site already goes through `EmailSender` so
  swapping it in needs no route/orchestrator change.
- **Durable background queue** — `setImmediate`, same documented `// TODO:
  durable queue (pg-boss)` placeholder every other background step in this
  codebase (crawl, AI runs) currently uses. A process crash mid-pipeline
  leaves the `snapshot_requests` row stuck in `processing` forever, same
  known limitation as `crawl_jobs`/`ai_runs`.
- **Auto-detected competitors beyond raw mention frequency** — Epic 8's
  full Share-of-AI-Voice/gap-classification engine is not run for a free
  snapshot; see "deliberate simplification" section above.
- **No expiry/cleanup job** for old `snapshot_requests` rows —
  `expires_at` (defaulted to `now() + 30 days` at the schema level,
  pre-existing) is not yet enforced by any route or job; `GET
  /snapshot/:token` will happily return a report past its nominal
  expiry today.
- **Snapshot rows for a converted lead** — `snapshot_requests.
  converted_to_org_id`/`converted_at` (pre-existing columns) are not
  written anywhere by this epic; wiring "this free-snapshot visitor later
  signed up" is a later-epic concern (Epic 20's actual marketing-site
  integration, or a future CRM enhancement).
