# Epic 8 — Competitive Intelligence (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root
marketing site was modified. **Frontend is not built** — a separate agent
wires the Competitors screen against the real routes documented below.

**No database was connected to at any point.** `prisma validate` and
`prisma generate` were run (schema-only, `DATABASE_URL` set to a dummy
value so the CLI has something to parse — no connection attempted). No
`migrate`, `db push`, or `db pull` was run, per the hard constraint.

**No real network call to any AI provider was made anywhere in this build**
— this epic adds zero new provider calls of its own; it reuses Epic 7's
pipeline verbatim, and every test exercising it uses the same hand-rolled
fake `AIProvider` pattern `lib/ai-visibility/pipeline.test.ts` already
established.

**No git commands were run.** No other agent's concurrent changes were
observed in the files touched here; `schema.prisma`/`app.ts` were re-read
immediately before editing regardless, per the task's standing instruction.

---

## The one schema question this epic had to answer first

The brief: "add a nullable `competitor_id` on `ai_runs`, check first whether
Epic 0's ported schema already anticipated this." It did — but for the
**legacy** pipeline, not the one this epic reuses. `competitor_mentions`,
`competitor_visibility`, `gap_analysis`, and `geo_gaps` all already compare
a brand to its competitors, but every one of them keys off `analyses`/
`prompt_runs`/`intents` (the pre-Epic-7 pipeline), not `ai_runs`. Repurposing
any of them would either couple this epic's writes to an unrelated legacy
system, or bolt an `ai_runs` FK onto a table whose other columns don't fit.
Full reasoning: `packages/database/DECISIONS.md` §21.

**The fix**: one column. `ai_runs.competitor_id String? @db.Uuid`, FK to
`competitors` (`onDelete: Restrict`), plus `idx_ai_runs_competitor`. `NULL`
= Epic 7's original brand-visibility run, unmodified; non-null = the
identical run pointed at that `competitors` row instead. No new migration
folder — a plain FK + `@@index` is fully expressible in `schema.prisma`
directly (no CHECK, no new RLS policy, no partial index needed) — see
DECISIONS.md §21 for why that's not an oversight.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- `ai_runs.competitor_id` (nullable FK to `competitors`) + back-relation
  `competitors.ai_runs` + `idx_ai_runs_competitor`. That's the entire schema
  change. `prisma validate` + `prisma generate` both clean.

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/ai-visibility/pipeline.ts`** — the ONLY change to Epic 7's
  pipeline: `runAiVisibilityRun` now reads `run.competitor_id` off the row
  it already fetches and, when set, resolves that `competitors` row's
  `name`/`aliases` instead of the brand's for the extraction prompt. Every
  other line — QUEUE, EXECUTE's two-call-per-job evidence guarantee,
  AGGREGATE's formula v1.0 — is byte-for-byte unchanged. The extraction
  prompt template (`prompts/geo/extraction-brand-observation.v1.0.txt`) was
  already entity-agnostic prose ("the name ... of one specific brand") and
  needed zero edits.
- **`src/lib/ai-visibility/schedule-run.ts`** (new) — the
  `setImmediate`-and-mark-failed-on-throw block factored out of
  `routes/ai-runs.ts` so both that route and the new competitor route
  schedule EXECUTE identically instead of maintaining two copies.
- **`src/lib/ai-visibility/competitor-usage.ts`** (new) —
  `countTrackedCompetitors`, the usage counter for "how many competitors
  have ACTIVE AI-run tracking" (distinct `competitor_id`s with at least one
  `ai_runs` row), reusing `lib/entitlements.ts`'s existing
  `competitors_tracked` `PLAN_LIMITS` entry per this epic's instruction to
  reuse Epic 2's entitlement pattern rather than invent a new one. See "Two
  different caps, one number" below.
- **`src/lib/ai-visibility/competitive.ts`** (new) — every formula, pure and
  deterministic, zero database/provider/clock dependency:
  `computeShareOfAiVoice`, `computeCompetitiveGap`,
  `computePerIntentTypeGaps`, `computeQueryStats` + `positionBucket`,
  `buildQueryComparisonSentence`, `classifyIntentGaps` /
  `classifyContentGaps` / `classifyEntityGaps` / `classifySourceGaps`,
  `computeCompetitorMovement`. 26 unit tests
  (`competitive.test.ts`) including the DoD's explicit Share-of-AI-Voice
  boundary cases.
- **`src/lib/ai-visibility/competitive-dataset.ts`** (new) — the shared read
  path: resolves the brand's active `query_set`, the brand's and every
  tracked competitor's most recent **completed** run on that exact
  query_set, and each run's `brand_observations`. See "Why 'same query set'
  is a hard requirement" in that file's own doc comment.
- **`src/routes/competitor-ai-runs.ts`** (new) — `GET` + `POST
  /:competitorId/ai-runs`, mounted at
  `/api/brands/me/competitors/:competitorId/ai-runs`.
- **`src/routes/competitive-intelligence.ts`** (new) — `GET
  /competitive-gaps`, `GET /share-of-voice`, `GET
  /competitors/:competitorId/movement`, mounted at `/api/brands/me`.
- **`src/routes/ai-runs.ts`** — minimal touch: `GET /` now filters
  `competitor_id: null` (the brand's own history list never mixes in
  competitor runs — those are listed per-competitor by the new route);
  `POST /` now writes `competitor_id: null` explicitly; both routes now
  schedule via `schedule-run.ts` instead of an inline `setImmediate` block.
  All three existing `ai-runs.test.ts` behaviors re-verified unchanged.
- **`src/lib/ai-visibility/serialize.ts`** — `serializeAiRun` now includes
  `competitorId` (`null` for a brand run).
- `app.ts` wired the two new route files.

---

## API surface (exact response shapes)

All routes: `requireAuth` -> `requireOrgFromToken('viewer')` -> RBAC. Every
read route uses the pre-existing `view_intelligence` action
(owner/admin/analyst/editor/viewer); the trigger route uses the pre-existing
`run_ai_analysis` action (owner/admin/analyst) — no new RBAC action needed.

### `POST /api/brands/me/competitors/:competitorId/ai-runs`

Body: none. Runs Epic 7's identical pipeline against this competitor on the
brand's `active` query_set.

- `404 { error: 'Brand profile not found', message }` / `404 { error:
  'Competitor not found' }` (the latter also covers "belongs to another
  org/brand" — tenant isolation, never a 403 that confirms existence).
- `404 { error: 'no_active_query_set', message }`, `422 { error:
  'query_set_empty', message }` — identical to the brand route.
- `402 { error: 'competitor_tracking_limit_reached', message, metric,
  limit, current, plan, upgradeTo }` — only checked the FIRST time this
  competitor is run (a competitor already tracked can always be re-measured
  without consuming another "slot").
- `402 { error: 'ai_query_limit_reached', message, metric, limit, current,
  requested, plan, upgradeTo }` — identical shape/ordering to the brand
  route's own check (same monthly pool, brand and competitor runs pooled
  together).
- `202 AiRun` (`status: 'queued'`, `competitorId` set) on success.

### `GET /api/brands/me/competitors/:competitorId/ai-runs`

`200 -> AiRun[]`, newest first, scoped to exactly this competitor (never
mixed with the brand's own runs or another competitor's).

`AiRun` is Epic 7's shape (see `07-ai-visibility-engine-backend.md`) plus
one new field:

```ts
interface AiRun {
  id: string;
  brandId: string;
  competitorId: string | null; // NEW — null for a brand-visibility run
  querySetId: string;
  providers: string[];
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  progressPct: number;
  aiVisibilityScore: number | null;
  scoringFormulaVersion: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`GET /api/brands/me/ai-runs` (Epic 7's own list route) now always returns
`competitorId: null` rows only.

### `GET /api/brands/me/competitive-gaps`

**Always 200** — `computed: false` (empty arrays) is the normal response
before the brand itself has a completed run on the current active query
set, the same "poll like run status, don't guess whether the shape means
error" convention `GET /ai-runs/:id/score` established. `404 {
error: 'no_active_query_set' }` only when the brand has no `active`
query_set at all.

```ts
interface CompetitiveGapsResponse {
  querySetId: string;
  computed: boolean; // true once the BRAND has a completed run on this query_set
  brandRun: { id: string; aiVisibilityScore: number | null; completedAt: string | null } | null;
  competitors: Array<{
    competitorId: string;
    competitorName: string;
    run: { id: string; aiVisibilityScore: number | null; completedAt: string | null } | null; // null = not yet run on THIS query_set
    competitiveGap: number | null; // Competitor AVS − Your AVS, aggregate
    perIntentTypeGap: Array<{
      intentType: string; // queries.intent_type, or 'uncategorized'
      queryCount: number;
      yourScore: number;
      competitorScore: number;
      gap: number;
    }>;
  }>;
  perQueryBreakdown: Array<{
    queryId: string;
    queryText: string;
    intentType: string | null;
    category: string | null;
    yourStats: { mentionRatePct: number; position: 1 | 2 | 3 | 4 | null };
    competitors: Array<{
      competitorId: string;
      competitorName: string;
      stats: { mentionRatePct: number; position: 1 | 2 | 3 | 4 | null };
      sentence: string; // the signature evidence sentence, verbatim-shaped
    }>;
  }>;
  gaps: Array<IntentGapFinding | ContentGapFinding | EntityGapFinding | SourceGapFinding>;
}
```

`gaps` is a single flat array — every finding carries its own `gapType`
(`'intent_gap' | 'content_gap' | 'entity_gap' | 'source_gap'`) so a
consumer never has to infer which of the four it's looking at (this epic's
end-to-end flow step 4, verified directly in
`competitive.test.ts`'s "every gap finding carries an explicit gapType"
test). The four shapes:

```ts
interface IntentGapFinding {
  gapType: 'intent_gap';
  severity: 'high' | 'medium';
  queryId: string; queryText: string;
  yourMentionRatePct: number; // always 0 for a finding of this type
  competitors: Array<{ competitorId: string; competitorName: string; mentionRatePct: number }>;
}
interface ContentGapFinding {
  gapType: 'content_gap';
  severity: 'medium';
  queryId: string; queryText: string;
  citedDomains: string[]; // domains a competitor's responses cite for this query
}
interface EntityGapFinding {
  gapType: 'entity_gap';
  severity: 'high' | 'medium';
  category: string; // queries.category
  yourPresencePct: number; // always 0 for a finding of this type
  competitors: Array<{ competitorId: string; competitorName: string; presencePct: number }>;
}
interface SourceGapFinding {
  gapType: 'source_gap';
  severity: 'high' | 'medium';
  domain: string;
  citedByCompetitors: Array<{ competitorId: string; competitorName: string; citationRatePct: number }>;
}
```

**Example sentence** (hand-verified in `competitive-intelligence.test.ts`):
`'For "best freight visibility software," CompetitorA appears in 75% of responses at position 1, you appear in 25% of responses at position 4.'`
— matches the spec's exact shape
(`docs/11-geo/GEO_ENGINE.md`: `'For the query "X," CompetitorA appears in
84% of responses at position 1. You appear in 2%.'`), with the "at position
N" clause omitted (never fabricated) when that side was never mentioned at
all for that query.

### `GET /api/brands/me/share-of-voice`

Same `computed`-free, always-200-once-a-query-set-exists shape (a missing
run on either side contributes 0 mentions, which is the mathematically
correct answer, not a distinct "unknown" state).

```ts
interface ShareOfVoiceResponse {
  querySetId: string;
  yourMentions: number;
  yourSharePct: number;
  totalMentions: number; // yourMentions + sum of every competitor's mentions
  competitors: Array<{
    competitorId: string;
    competitorName: string;
    mentions: number;
    sharePct: number;
    tracked: boolean; // false = no completed run yet on this query_set
  }>;
}
```

**Boundary guarantee** (this epic's DoD's explicit requirement,
`competitive.test.ts`'s `computeShareOfAiVoice` suite + a route-level
integration test): zero mentions anywhere -> every share is exactly `0`,
never `NaN`/`Infinity`; zero competitor mentions -> brand share is exactly
`100`; a single tracked competitor is not special-cased — the formula is
generic over any competitor count, including one.

### `GET /api/brands/me/competitors/:competitorId/movement`

The "build the comparison logic now" piece of the spec's movement-alerts
note — exposed on demand (no schedule/cron; Epic 12's Competitor Agent owns
the actual trigger, per this epic's own spec text). Compares the
competitor's two most recent **completed** runs (not required to share a
query_set — a visibility trend legitimately spans query-set versions).

```ts
interface MovementResult {
  previousScore: number | null;
  latestScore: number | null;
  delta: number | null;
  direction: 'increase' | 'decrease' | 'flat' | null;
  sentence: string | null; // "CompetitorA just increased their AI visibility by 15 points." or null if no previous run exists yet
}
```

---

## Two different caps, one number ("competitors_tracked")

Epic 2's `routes/competitors.ts` already enforces `competitors_tracked`
(free=2/starter=5/growth=10/pro=20/unlimited above) against "how many
non-deleted `competitors` rows exist." This epic enforces the **same**
`PLAN_LIMITS` value against a **different** counter:
`countTrackedCompetitors` — "how many DISTINCT competitors have ever had an
`ai_runs` row" — checked only the first time a given competitor is run
(re-measuring an already-tracked competitor never re-checks the cap). A
brand can therefore hold up to the plan's cap worth of inert competitor
profile rows (Epic 2's check) AND, independently, run up to that same cap's
worth of them through the metered AI Visibility pipeline (this epic's
check) — same ceiling, two different things it bounds. Full reasoning:
`lib/ai-visibility/competitor-usage.ts`'s doc comment.

---

## Gap-type definitions (source: repo-root `docs/11-geo/GEO_ENGINE.md`)

`platform/docs/` doesn't carry a copy of `docs/11-geo/GEO_ENGINE.md` or
`docs/09-ux/CUSTOMER_JOURNEY.md` (the epic spec cites both by path but
neither exists under `platform/docs/`) — both were read from the repo root
(read-only; nothing under `docs/` was modified) to get the literal formulas
and the four gap-type definitions right rather than guessing:

- **Intent Gaps** — "Queries where competitors appear but the brand does
  not." Implemented literally: `yourMentionRatePct === 0` for that query AND
  at least one competitor's rate is `> 0`. Severity `high` when the
  strongest competitor is at `>= 50%`, else `medium`.
- **Content Gaps** — "Topics AI discusses that the brand has no
  authoritative content for." Operationalized per-query: a competitor's
  responses cite some domain for this query, the brand's cite none, and the
  brand is weakly present (`< 50%`) — the citation gap is only surfaced
  where the brand isn't already winning the query some other way.
- **Entity Gaps** — "AI categories or entities the brand is NOT associated
  with." Operationalized at the `queries.category` level (Epic 5's ten
  template-generation categories — GEO_ENGINE.md's own "Category X"
  language), aggregated across every query in that category: the brand has
  `0%` presence across the WHOLE category while at least one competitor has
  some.
- **Source Gaps** — "Trusted domains AI cites that contain no brand
  content." Aggregate across the whole query set: any domain a competitor's
  responses cite that the brand's own responses never cite once, with a
  citation-rate percentage per competitor.

"At position N" (the per-query sentence) has no literal list-rank field
anywhere in `brand_observations` — see `scoring.ts`'s own prior, identical
resolution of "top-3-recommended" for the precedent. `positionBucket` maps
the existing continuous `brandFirstPosition` (0..1 normalized character
offset) into an ordinal 1–4 by response-text quartile; this is NOT "the AI
ranked this brand #1 in a list," it's "the earliest mention among providers
that mentioned this entity for this query landed in the response's Nth
quarter." Documented in full in `competitive.ts`'s top-of-file comment.

---

## Tests

- `lib/ai-visibility/pipeline.test.ts` — added one test proving a
  competitor run (`ai_runs.competitor_id` set) extracts for the
  competitor's name/aliases (not the brand's), while `ai_run_responses`/
  `brand_observations` rows are written identically to a brand run
  (`brand_id` still the org's real brand). Epic 7's original test
  unmodified and still passing.
- `lib/ai-visibility/competitive.test.ts` — 26 tests: the DoD's explicit
  Share-of-AI-Voice boundaries (zero mentions everywhere, zero competitor
  mentions, single competitor, multi-competitor sum-to-100), Competitive
  Gap (including the `null`-propagation case), per-intent-type grouping,
  `positionBucket`/`computeQueryStats`, the exact evidence-sentence format
  (plus its "never fabricate a position" omission case), all four gap
  classifiers (positive and negative cases each), the "every finding has an
  explicit gapType" invariant, and movement-alert direction/sentence
  generation.
- `lib/ai-visibility/competitor-usage.test.ts` — 2 tests for the distinct-
  competitor counter.
- `routes/competitor-ai-runs.test.ts` — 7 tests: tenant isolation (404 on a
  foreign competitor), RBAC, no-active-query-set, the tracking-cap 402
  BEFORE any row is created, re-measurement NOT re-checking the cap, the
  success path's exact stored shape, and the per-competitor list.
- `routes/competitive-intelligence.test.ts` — 5 tests: no-active-query-set
  404, the `computed: false` not-ready shape, the exact per-query sentence
  format end-to-end plus every returned gap carrying a valid `gapType`, and
  Share of AI Voice's zero-everywhere and single-competitor cases exercised
  through the real route (not just the pure function).
- `routes/tenant-isolation.integration.test.ts` — a new `describe.skip`
  block (4 `it.todo`s, `NEEDS LIVE DB`, same convention every prior epic
  used) naming the scenarios specific to the competitor dimension: a
  same-named competitor in another org, competitive-gaps/share-of-voice
  never leaking a foreign org's competitor/run/observation rows, WITH CHECK
  rejecting a cross-org insert even when `competitor_id` points at a real
  row the (wrong) org owns, and `countTrackedCompetitors` never counting
  another org's tracked competitors.

Full suite after this epic's changes: `@bebest/database` (7 tests),
`@bebest/api` (461 passed + 54 todo — 4 new `it.todo` tenant-isolation
stubs added to `tenant-isolation.integration.test.ts`'s existing
`NEEDS LIVE DB` convention, same pattern every prior epic uses; 48 test
files passed, 1 integration file `.skip`ped). `tsc --noEmit`,
`eslint src --ext .ts`, and `tsc -p tsconfig.build.json` all clean for
`apps/api`; `prisma validate` + `prisma generate` clean for
`packages/database`.

---

## Not done / left for later epics

- **Movement alerts have no schedule/trigger.** Per this epic's own spec
  text ("build the comparison logic now, wire the actual schedule trigger
  in Epic 12"): `computeCompetitorMovement` + the on-demand `GET
  .../movement` endpoint exist; nothing calls it periodically or writes a
  `notifications` row (`notification_type.competitor_alert` already exists
  in the legacy enum list, unused by this epic) yet.
- **Gap severity thresholds (`>=50%`, `>=25%`) are a documented, reasonable
  default, not a value from any source doc** — none of `GEO_ENGINE.md`'s
  four gap-type examples give an explicit severity cutoff. Easy to tune
  later; centralized in `competitive.ts`'s classifier functions, not
  scattered.
- **`perIntentTypeGap` and the per-query `gaps` classification both require
  the brand AND that competitor to each have a completed run on the exact
  current active query_set** (see `competitive-dataset.ts`'s doc comment
  for why this is a hard requirement, not a preference). A competitor whose
  most recent completed run predates the current query_set version shows
  `run: null` and contributes nothing to `perQueryBreakdown`/`gaps` until
  re-run — this is a real, user-visible "re-run me" state, not a bug, but
  no UI copy for it was written here (frontend's job).
- **No opportunity/recommendation write-through.** The epic spec notes gap
  classification "is what Epic 9's Opportunity Engine consumes directly" —
  this epic only computes and returns gaps on read; nothing persists an
  `opportunity_evidence` row or similar (Epic 9, `PLANNED`).
- **Durable queue / rate limiting / concurrency tuning** — identical,
  already-documented Epic 7 limitations; this epic adds no new provider
  calls and inherits them unchanged (see
  `07-ai-visibility-engine-backend.md`'s own "Not done" section).
- **No `DELETE`/cancel route for a running competitor `ai_runs`** — same
  gap as the brand route (and the crawler before it), not solved here.
