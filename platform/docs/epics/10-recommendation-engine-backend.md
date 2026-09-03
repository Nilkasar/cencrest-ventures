# Epic 10 — Recommendation Engine (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root marketing
site was modified. **Frontend is not built** — a separate agent wires the
Recommendations experience (inline "next action" on the Epic 9 Opportunities
screen + its own "top 10 prioritized recommendations" view) against the real
routes documented below.

**No database was connected to at any point.** `prisma validate` and
`prisma generate` were run (schema-only, `DATABASE_URL` set to a dummy value
so the CLI has something to parse — no connection attempted). No `migrate`,
`db push`, or `db pull` was run, per the hard constraint.

**No real network call to any AI provider, payment provider, OAuth
provider, or external site was made anywhere in this build.** This epic is
explicitly a template-driven generator, not an LLM caller — see "Generation
approach" below. Every test uses a fully mocked `@bebest/database`.

**No git commands were run.**

**Concurrent-agent note.** A different agent building Epic 18 (Agency /
White Label / Integrations) was working in this same repo at the same time
and touched shared files: `packages/database/prisma/schema.prisma` (added
`agency_clients`/`white_label_configs`/`integrations` and their own
DECISIONS.md §23), `packages/database/src/client.ts`/`src/index.ts` (added
their own type exports immediately after this epic's), and
`apps/api/src/middleware/tenant-context.ts` (mid-edit, wiring in a new
`lib/agency-access.ts`). Each shared file was re-read immediately before
this epic's own edits and merged in cleanly — no collisions. **One
unrelated, pre-existing issue was found, not introduced by this epic**: at
the time of this epic's final verification, Epic 18's in-progress
`resolveAgencyAccess` (`lib/agency-access.ts:110`) throws
`TypeError: memberships is not iterable` when called from
`tenant-context.ts`'s `resolveOrgContext`, which fails one `orgs.test.ts`
test (`GET /orgs/:slug > 403s when the caller is not a member`, expects 403,
gets 500) and one `eslint` rule (`resolveAgencyAccess` imported but unused
in an earlier snapshot of that file). Neither `orgs.ts`/`orgs.test.ts`/
`tenant-context.ts`/`agency-access.ts` was touched by this epic. Confirmed
unrelated by running this epic's own test files in isolation (all green —
see "Tests" below) and by re-running `orgs.test.ts` in isolation, which
reproduces the exact same failure with a stack trace pointing entirely at
Epic 18's own files.

---

## The two schema questions this epic had to answer first

**1. Is the ported `recommendations` table this epic's table? No.** Same
collision, same resolution, as Epic 9's `opportunities`/`unified_opportunities`
(`@bebest/database` DECISIONS.md §22): it requires a non-null `analysis_id`
into the LEGACY `analyses` pipeline and keys off the legacy
`opportunities`/`geo_gaps` tables, and its column set (`is_recommended`,
`rec_type`, `roi_score`, `rec_status`) does not match this epic's literal
field list (`opportunity_id`, `title`, `description`, `action_type`,
`effort`, `impact`, `priority_rank`, `evidence_summary`,
`implementation_notes`, `status`) at all.

**2. `action_type` needs its own enum.** The legacy `action_type` enum
(`content|seo|pr|product|positioning|technical`, used by the legacy
`opportunities` table) shares none of this epic's four literal values
(`create_page|update_page|fix_technical|build_citations`) — checked
directly against schema.prisma, not assumed.

Resolution: a new table, **`opportunity_recommendations`**, plus a new
**`recommendation_action_type`** enum. `effort`/`impact` reuse the existing
`effort_level` enum; `status` reuses the existing `opportunity_status`
enum. Full reasoning: `packages/database/DECISIONS.md` §24.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **`opportunity_recommendations`** (new table) — `organization_id`,
  `brand_id` (denormalized), `opportunity_id` (FK to Epic 9's
  `unified_opportunities`, Cascade — a recommendation has no independent
  meaning without its source opportunity), `action_type`
  (`recommendation_action_type`), `effort`/`impact` (`effort_level`,
  reused), `priority_rank` (`Decimal(6,2)`), `title` (`VarChar(500)`),
  `description`, `evidence_summary`, `implementation_notes` (all `String`),
  `status` (`opportunity_status`, reused, default `new`), `updated_by`
  (nullable, `SetNull`). **`@@unique([organization_id, opportunity_id])`**
  is the idempotency key `POST .../generate` upserts against — one
  recommendation per opportunity, ever.
- **`prisma/migrations/0012_recommendation_engine/`** — `rls.sql` (standard
  `tenant_isolation` policy) and `indexes.sql` (one partial index,
  `idx_opportunity_recommendations_open_rank`, `WHERE status != 'dismissed'`,
  ordered `priority_rank DESC` — the "top 10 prioritized recommendations"
  view's exact read pattern).
- `src/client.ts` / `src/index.ts` — export `opportunity_recommendations`,
  `recommendation_action_type`.
- `prisma validate` + `prisma generate` both clean.
- Back-relations added on `organizations`, `brands`, `users`
  (`opportunity_recommendations_updated`, named relation), and
  `unified_opportunities` — no other epic's models touched. Full reasoning
  for every decision above: `packages/database/DECISIONS.md` §24.

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/recommendations/generator.ts`** (new, pure, no DB/network/
  clock — same discipline as `lib/opportunities/merge-scoring.ts`):
  - `actionTypeForOpportunityType(type)` — a TOTAL, documented mapping over
    all five `unified_opportunity_type` values: `seo`/`unified` ->
    `create_page` (Epic 9's merge always models these with
    `currentCoverage: 0`, i.e. no existing page for the intent); `geo` ->
    `build_citations` (a pure GEO gap with no SEO signal alongside it —
    the remedy is authority/citation-building, not a brand-new page); the
    two forward-reserved types `content`/`technical` (not yet produced by
    Epic 9's own recompute) -> `update_page`/`fix_technical` respectively.
    All four `recommendation_action_type` values are reachable.
  - `levelFromScore(score)` — buckets a 0-100 opportunity score into
    `low`/`medium`/`high` using the same 30/60 thresholds
    `merge-scoring.ts`'s `priorityFromScore` already uses, applied
    independently to `effort_score` (-> `effort`) and `impact_score` (->
    `impact`).
  - `computePriorityRank(opportunityScore, effort)` —
    `round2(opportunityScore * EFFORT_RANK_MULTIPLIER[effort])`,
    `{ low: 1, medium: 0.75, high: 0.5 }` (documented v1 judgment call, not
    a value from any source doc — same treatment `merge-scoring.ts`'s
    `MATERIAL_CHANGE_SCORE_DELTA` gets). HIGHER ranks first (`GET
    .../recommendations` sorts `priority_rank DESC`, same convention
    `opportunity_score` itself already uses): two recommendations at the
    SAME opportunity_score are ordered strictly by effort, so a cheap
    (`low`-effort) one always outranks an expensive (`high`-effort) one
    from an equal-or-higher-scored opportunity — proven by a unit test with
    exactly that fixture pair.
  - `topCompetitorName(evidence)` — picks the highest-mention-rate
    competitor out of the opportunity's `ai_runs`-sourced evidence rows, or
    `null` for a pure `seo`-typed opportunity with no GEO evidence at all.
  - `titleForRecommendation` / `descriptionForRecommendation` — per-
    `action_type` templates. `create_page` WITH a known competitor
    reproduces the epic spec's own literal quoted example verbatim:
    `"Build a comparison page: [Brand] vs [leading competitor] for
    [intent]"`.
  - `evidenceSummaryForRecommendation(opportunityScore, priority,
    evidence)` — quotes the parent opportunity's REAL `opportunity_evidence`
    sentences verbatim (already written, with real numbers, by Epic 9's
    merge — "500 monthly searches," "CompetitorA appears in 84% of
    responses") — never a generic template string with no real data
    interpolated (this epic's explicit DoD requirement).
  - `implementationNotesForRecommendation(actionType, intentText,
    competitorName)` — `SEO_REQUIREMENTS`/`GEO_REQUIREMENTS` lookup tables,
    one distinct entry per `action_type`, transcribed from
    `docs/10-seo/SEO_ENGINE.md`'s Page Analysis Checklist and
    `docs/11-geo/GEO_ENGINE.md`'s GEO Optimization Principles respectively.
    Output format: `"SEO requirements: ...\n\nGEO requirements: ..."` plus
    a one-line evidence-grounding clause. Every one of the 4 `action_type`
    values gets BOTH halves — proven by a parameterized (`it.each`) unit
    test over all 4 values, plus a route-level test proving the same thing
    through the real generate endpoint for opportunity types
    `seo`/`geo`/`content`/`technical` (all 4 resulting `action_type`
    values), not just `unified`/`create_page`.
- **`src/lib/recommendations/serialize.ts`** — `serializeRecommendation`.
- **`src/routes/opportunity-recommendations.ts`** —
  `POST /:id/recommendations/generate`, mounted at `/api/opportunities`
  (the same base path `opportunity-details.ts` already mounts at — Hono
  merges routes from multiple routers at one base, same precedent
  `/api/brands/me/competitors` already uses for `competitors.ts` +
  `competitor-ai-runs.ts`). Loads the `unified_opportunities` row + its
  `opportunity_evidence` (belt-and-suspenders org-scoped, same pattern as
  `opportunity-details.ts`), derives `action_type`/`effort`/`impact`/
  `priority_rank`, builds the brief, then upserts by
  `(organization_id, opportunity_id)` — idempotent, `201` on create,
  `200` on update, body `{ created: boolean, recommendation: {...} }`.
  Audit-logged manually as `recommendation.generated` (same
  `writeManualAuditEvent` pattern Epic 9's `POST .../recompute` uses for
  `opportunity.recomputed` — the entity id is only known after the row is
  created/updated).
- **`src/routes/recommendations.ts`** — `GET /`, mounted at
  `/api/brands/me/recommendations`. Filterable by `status`/`actionType`,
  sorted `priority_rank DESC`, paginated.
- **`src/routes/recommendation-details.ts`** — `PATCH /:id`, mounted at
  `/api/recommendations`. Body `{ status }` (one of
  `new|in_progress|completed|dismissed`) — audit-logged via the `auditLog`
  middleware (`action: 'recommendation.status_changed'`), same pattern
  `opportunity-details.ts`'s `PATCH /:id` uses. `404` for a wrong/foreign
  id (never a 403 that confirms existence — tenant isolation).
- **`src/app.ts`** — mounted all three routes; see the header comment
  added right after Epic 9's block for the exact reasoning.
- 20 unit tests (`lib/recommendations/generator.test.ts`) + 10 route-level
  tests (`routes/recommendations.test.ts`) covering the exact DoD scenarios
  by name (see below).

---

## Idempotency — spelled out

Exact behavior, as implemented and tested:

- **First `POST /opportunities/:id/recommendations/generate`** for a given
  opportunity → `201`, `{ created: true, recommendation: {...} }`.
- **Every subsequent call** (evidence unchanged OR changed — e.g. after a
  re-run of Epic 9's `POST .../recompute` updated the opportunity's
  scores/evidence in place) → `200`, `{ created: false, recommendation:
  {...} }`, the SAME row updated in place — proven by a test that calls
  `generate` twice consecutively and asserts exactly one
  `opportunity_recommendations` row exists both times, with the same `id`.
  This mirrors Epic 9's own `(organization_id, brand_id, query_id)` upsert
  discipline exactly, at the `(organization_id, opportunity_id)` grain.
- A `404` on a wrong/foreign opportunity id never creates a row (checked
  before any upsert logic runs).

---

## The dual SEO+GEO requirement — spelled out

Per the epic's DoD: "a recommendation missing either half is a spec
violation, not a style choice." Concretely, for a fixture `unified`
opportunity (`type: 'unified'`, `intent_text: 'best freight visibility
software'`, evidence citing `"500 monthly searches"` and `"CompetitorA
appears in 84% of responses"`):

```json
{
  "actionType": "create_page",
  "title": "Build a comparison page: Acme vs CompetitorA for best freight visibility software",
  "evidenceSummary": "Opportunity score 65.55/100 (priority 1). \"best freight visibility software\" gets an estimated 500 monthly searches. CompetitorA appears in 84% of responses at position 1, you appear in 0% of responses.",
  "implementationNotes": "SEO requirements: Title tag 50-60 characters containing the primary keyword; meta description 140-160 characters with a clear CTA; exactly one H1 containing the primary keyword; minimum 300 words of body content with internal links to related pages; Organization/Service schema; HTTPS, a correct canonical tag, and inclusion in the sitemap.\n\nGEO requirements: Server-render the page (no JS-only content) so AI can retrieve it (principle 1); write its claims in FAQ/numbered-list form AI can lift directly (principle 5); explicitly state the entity association between the brand and this use case (principle 2). Evidence: AI responses for \"best freight visibility software\" currently cite CompetitorA, not this brand."
}
```

Both `evidenceSummary`'s real numbers (step 1 of the epic's end-to-end
flow) and `implementationNotes`'s dual SEO+GEO coverage (step 2) are
present, and this holds for all 4 `action_type` values, not just
`create_page` — see the parameterized tests in both `generator.test.ts` and
`recommendations.test.ts`.

---

## Response shapes

`POST /api/opportunities/:id/recommendations/generate` → `201` (created) /
`200` (updated):
```json
{
  "created": true,
  "recommendation": {
    "id": "uuid",
    "opportunityId": "uuid",
    "brandId": "uuid",
    "actionType": "create_page",
    "effort": "low",
    "impact": "high",
    "priorityRank": 65.55,
    "title": "Build a comparison page: Acme vs CompetitorA for best freight visibility software",
    "description": "Publish a new page comparing Acme to CompetitorA for \"best freight visibility software\" — no page targets this intent today, and CompetitorA already dominates the AI answers for it.",
    "evidenceSummary": "...",
    "implementationNotes": "...",
    "status": "new",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```
`404 { "error": "Opportunity not found" }` for a wrong/foreign opportunity
id.

`GET /api/brands/me/recommendations?status=&actionType=&limit=&offset=` →
`200`:
```json
{ "recommendations": [ /* serializeRecommendation, sorted by priorityRank desc */ ], "pagination": { "total": 2, "limit": 25, "offset": 0 } }
```
`404` (`NO_BRAND_ERROR`) when the organization has no brand profile yet.

`PATCH /api/recommendations/:id` — body `{ "status": "new"|"in_progress"|
"completed"|"dismissed" }` → `200`, the same recommendation shape.
`404 { "error": "Recommendation not found" }` for a wrong/foreign id.
`422` on a missing/invalid `status`. Audit-logged via the `auditLog`
middleware (`action: 'recommendation.status_changed'`) regardless of the
resulting status.

---

## RBAC / permissions

No new `Action` was added to `src/lib/rbac.ts` — this epic reuses the same
two actions Epic 9's opportunity routes already use, since a recommendation
is the same "brand intelligence output" resource class: `view_intelligence`
(GET) and `create_brand_profile` (POST generate / PATCH status). Both are
already granted to `owner|admin|analyst|editor|viewer` (view) and
`owner|admin|analyst` (mutate) per `docs/08-security/SECURITY.md`'s
permission matrix — no widening or narrowing of that matrix was needed.

---

## Tests

- `src/lib/recommendations/generator.test.ts` — 20 tests: `action_type`
  mapping totality (every `unified_opportunity_type` handled, every
  `recommendation_action_type` reachable), `effort`/`impact` bucket
  thresholds, `priority_rank`'s "cheap ranks above expensive at the same
  opportunity_score" property (the DoD's literal requirement) plus a
  cross-score case, `topCompetitorName`'s highest-mention-rate selection,
  the literal spec-quoted title example, and the dual SEO+GEO
  `implementation_notes` requirement parameterized over all 4
  `action_type` values with distinct content per type (not one copy-pasted
  block).
- `src/routes/recommendations.test.ts` — 10 tests: 404 on an unknown/
  foreign opportunity id; the fixture-driven "evidence_summary quotes real
  numbers + implementation_notes cover both SEO and GEO" scenario (the
  epic's end-to-end flow step 1+2); the two-consecutive-calls idempotency
  proof (step 3); a parameterized test generating from all 5 opportunity
  types and asserting the resulting `action_type` + dual-requirement notes
  for each of the 4 distinct outcomes; the `priority_rank` ordering proof
  using two fixture opportunities with the same `opportunity_score` but
  different `effort_score` (step 4); the status-change + audit-log proof
  (step 5); and a cross-org 404 on `PATCH` (step 6, tenant isolation).
- Full existing `@bebest/api` suite re-run in isolation alongside this
  epic's own two test files (`opportunities.test.ts` +
  `recommendations.test.ts` + `generator.test.ts`): all 39 tests green,
  confirming no regression to Epic 9. The one full-suite failure
  (`orgs.test.ts`) and one full-suite lint failure are both traced to
  Epic 18's own concurrent, in-progress files — see "Concurrent-agent
  note" above.
- `@bebest/database`: `prisma validate`, `prisma generate`, `tsc --noEmit`,
  `eslint`, and its own `vitest` suite (7 tests) all clean.
- `turbo run typecheck build --filter=@bebest/api` clean (2/2 tasks); the
  full `typecheck lint test build` run for `@bebest/api` fails only on the
  pre-existing, unrelated Epic 18 issue described above.

---

## What's not done / known limitations (documented, not silently skipped)

1. **The "next action" is not inlined onto Epic 9's `GET /opportunities`/
   `GET /opportunities/:id` responses.** The epic's UI-surface section asks
   for recommendations to "surface inline on the Opportunities screen as
   the opportunity's next action." Rather than modifying Epic 9's own
   route/serializer files (a DONE, VERIFIED epic) for a feature achievable
   without doing so, every `serializeRecommendation` already carries its
   own `opportunityId` — the frontend can join
   `GET /brands/me/opportunities` against `GET /brands/me/recommendations`
   client-side by that field with no extra backend call. Flagged here as a
   deliberate scope choice, not an oversight, so the frontend agent knows
   which side owns the join.
2. **`action_type` mapping only reaches `create_page`/`build_citations`
   through Epic 9's REAL recompute pipeline today.** `update_page`/
   `fix_technical` are reachable only for `content`/`technical`-typed
   opportunities, which Epic 9's own merge logic does not yet produce
   (documented as forward-reserved in `@bebest/database` DECISIONS.md
   §22). The mapping function itself is already correct and fully tested
   for all 5 opportunity types (including via directly-inserted fixture
   rows) — the day a future epic starts producing `content`/`technical`
   opportunities, this epic's generation requires no code change.
3. **No AI-generated content, and no page is ever written.** Per this
   epic's explicit scope boundary: this produces the BRIEF only
   (title/description/evidence/checklist), deterministically, from
   structured data. Epic 11's Content Agent is the eventual consumer that
   drafts actual page copy from this brief — out of scope here by design.
4. **No scheduled/automatic generation.** `POST .../generate` is
   caller-triggered only, same "no cron/agent trigger defined by this
   epic" scope Epic 9's `POST .../recompute` already documents (Epic 12's
   agents are the eventual scheduler).
5. **Frontend not built** — a separate agent wires the Recommendations
   experience against these exact routes/shapes.
