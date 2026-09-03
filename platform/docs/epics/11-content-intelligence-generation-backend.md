# Epic 11 — Content Intelligence & Generation (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and `platform/apps/api`
(`@bebest/api`). Branch `rebuild/platform`, no other branch touched, nothing
under `api/`, `web-app/`, or the repo-root marketing site was modified.
**Frontend is not built** — a separate agent wires the Content Intelligence
experience (active briefs, drafts awaiting approval with quality-check
results visible, the approval screen) against the real routes documented
below.

**No database was connected to at any point.** `prisma validate` and `prisma
generate` were run repeatedly (schema-only, `DATABASE_URL` set to a dummy
value so the CLI has something to parse — no connection attempted). No
`migrate`, `db push`, or `db pull` was run, per the hard constraint.

**No real network call to any AI provider or external site was made
anywhere in this build.** `AIProviderRegistry.resolveAvailable('content.generation')`
is called through the real `@bebest/ai-provider` routing exactly as
production code will, but every test injects a hand-rolled fake `AIProvider`
(never a real network call) — same discipline `lib/ai-visibility/pipeline.test.ts`
already establishes for Epic 7.

**No git commands were run.**

**Concurrent-agent note.** A different agent building Epic 12 (Agents) was
working in this same repo at the same time and touched shared files:
`packages/database/prisma/schema.prisma` (added `agent_runs`/`agent_events`/
`agent_pending_actions` and their own back-relations), `packages/database/src/client.ts`/
`src/index.ts` (added their own type exports), and `apps/api/src/app.ts`
(added `routes/agents.ts`/`routes/agent-run-details.ts`). Every shared file
was re-read immediately before this epic's own edits and merged in cleanly —
no collisions, confirmed by re-running `prisma validate`/`generate` and the
full `@bebest/api` test suite after each merge point. **Two pre-existing,
unrelated issues were found, not introduced by this epic**, both traced
entirely to Epic 12's own concurrent, in-progress files:
1. `pnpm --filter @bebest/api lint` fails on one
   `@typescript-eslint/consistent-type-imports` error in
   `src/lib/agents/types.ts`. Confirmed unrelated: `eslint` scoped to only
   this epic's own files (`routes/content-brief-generate.ts`,
   `routes/content-briefs.ts`, `routes/content-brief-details.ts`,
   `routes/content-drafts.ts`, `lib/content/*.ts`, `app.ts`, `lib/audit.ts`)
   is clean; `tsc --noEmit` for the whole package (which does include Epic
   12's files) passes cleanly.
2. A single flaky test, `lib/agents/runner.test.ts`'s "persists every
   yielded event and marks the run completed with the real resultId"
   (expects `db.agent_events.create` called 3 times, got 9 — an exact 3x
   multiple, the signature of a leaked async background job from an earlier
   test still resolving during this one, same class of shared-worker
   mock-state leak `@bebest/api`'s own `DECISIONS.md` documents for
   `auth.test.ts`), reproduced only as part of the full suite
   (`turbo run test`) and NOT when `lib/agents/runner.test.ts` is run in
   isolation (10/10 pass). This file has zero imports of/references to
   anything in `lib/content/*`, `routes/content-*`, or any file this epic
   touched (confirmed by grep) — Epic 12's own runner/scheduling code
   exhibiting the same class of bug, not something introduced here. This
   epic's own suite (`lib/content/*.test.ts` +
   `routes/content-briefs.test.ts`, 56 tests) was re-run 3 additional
   consecutive times with zero flakes. The full `vitest run` suite,
   excluding this one pre-existing flaky Epic 12 test, is 100% green (756
   passed / 60 todo out of 817 across 79 files; 1 file skipped, unrelated
   integration suite).

---

## The schema questions this epic had to answer first

**1. `content_briefs` already existed (ported in Epic 0) but had no
`recommendation_id` at all.** Checked directly against schema.prisma first,
per this epic's own task brief. Added: `recommendation_id` (required FK ->
Epic 10's `opportunity_recommendations`, `Restrict`), `evidence_summary`/
`implementation_notes` (denormalized copies of the recommendation's own
fields, snapshotted at brief-creation time — never re-read live), and
`research_notes` (JSON — the brand_claims/opportunity_evidence gathered at
generation time). `@@unique([organization_id, recommendation_id])` — one
brief per recommendation, ever, upserted idempotently.

**2. `content_drafts` is a NEW table, not a retrofit of the pre-existing
`generated_content`.** `generated_content` was also already ported in Epic 0
under the Content Intelligence section, but has no `version`/`prompt_version`
at all, and its `status` vocabulary (`draft|approved|published|rejected`)
already contains `'published'` — precisely the value this epic's own status
vocabulary must never even be ABLE to hold (ADR-007: "no code path in this
epic calls anything resembling a publish action... enforced by absence of
any publish call, not by convention"). `content_drafts.status` is
CHECK-constrained to `generated|approved` only. `generated_content` (and
`publish_jobs`, see below) are left completely untouched — full reasoning:
`@bebest/database/DECISIONS.md` §25.

**3. `content_approvals` is a NEW, dedicated table — deliberately NOT the
pre-existing `publish_jobs`.** `publish_jobs` (also ported in Epic 0, for
Epic 13) bundles approval fields together with `destination`/`published_at`/
`published_url`/`publish_log` — writing this epic's approval into a table
literally named `publish_jobs` would blur the exact boundary this epic's DoD
requires be structurally clear. `content_approvals` has no publish-shaped
column anywhere in it.

**4. Epic 10's `opportunity_recommendations.status` has no literal
`'approved'` value** (`new|in_progress|completed|dismissed`, reused from
`opportunity_status`). This epic's spec's "an APPROVED... Recommendation" is
realized as: `status IN ('in_progress', 'completed')` — a human has moved it
out of the default queue and it was not dismissed. See
`lib/content/brief-builder.ts`'s `isApprovedRecommendationStatus`.

**5. "content-type Recommendation" — no literal `'content'` action_type
exists either** (`create_page|update_page|fix_technical|build_citations`).
Realized as `action_type IN ('create_page', 'update_page')` — the two types
that actually produce written content. See `isContentTypeRecommendation`.

Full reasoning for all five: `@bebest/database/DECISIONS.md` §25.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **`content_briefs`** — extended with `recommendation_id`, `evidence_summary`,
  `implementation_notes`, `research_notes` as above.
- **`content_drafts`** (new) — `organization_id`, `brand_id` (denormalized),
  `brief_id` (FK, Cascade), `version` (Int, `@@unique([brief_id, version])`),
  `provider_name`/`model_name`/`prompt_version` (ADR-006, same fields
  `ai_run_responses` already carries), `title`/`body`/`meta_description`/
  `word_count`, `structured_data_types` (String[]), `status`
  (`generated|approved`, CHECK-constrained), tracing fields
  (`request_id`/`tokens_*`/`latency_ms`), `created_by` (nullable, SetNull —
  also this epic's "editor may approve only their own draft" check).
- **`content_quality_checks`** (new) — one row per `(draft_id, check_type)`
  per generation: `check_type` (`fact_check|brand_voice|duplicate_content|
  seo_checklist|geo_structure`, CHECK-constrained), `status`
  (`pass|fail|warning`, CHECK-constrained), `score` (`Decimal(5,2)?`),
  `details` (JSON — the check's own evidence). Cascade from `content_drafts`.
- **`content_approvals`** (new) — `draft_id` (`@unique`), `approved_by`
  (nullable, SetNull), `approved_role` (snapshotted at approval time),
  `notes`, `approved_at`. Cascade from `content_drafts`.
- **`prisma/migrations/0015_content_intelligence_generation/`** — `rls.sql`
  (standard `tenant_isolation` policy on the three new tables) and
  `checks.sql` (`content_drafts.status`, `content_quality_checks.check_type`/
  `.status`).
- `src/client.ts` / `src/index.ts` — export `content_briefs`, `content_drafts`,
  `content_quality_checks`, `content_approvals`.
- `prisma validate` + `prisma generate` both clean (re-verified after Epic
  12's concurrent schema edits landed).
- Back-relations added on `organizations`, `brands`, `users` (`content_drafts_created`,
  `content_approvals_approved`, named relations), and `opportunity_recommendations`
  (`content_briefs[]`) — no other epic's models touched.
- Full reasoning: `packages/database/DECISIONS.md` §25.

### `platform/apps/api` (`@bebest/api`)

- **`src/prompts/content/generation.v1.0.txt`** — the versioned prompt
  template (`@bebest/ai-provider`'s file-based convention, category
  `content`), requiring the model to produce a short FAQ section, a
  numbered/bulleted list, and a named citable fact — directly operationalizing
  `docs/11-geo/GEO_ENGINE.md`'s structuring principles at generation time
  (not just checked for afterward).
- **`src/lib/content/brief-builder.ts`** (pure, no DB/network/clock) —
  `isContentTypeRecommendation`, `contentTypeForActionType`,
  `isApprovedRecommendationStatus` (the two disambiguation decisions above),
  `buildResearchNotes`, `buildOutline` (splits `implementation_notes`'s
  `"SEO requirements: ...\n\nGEO requirements: ..."` format back into
  separate outline sections while leaving the brief's own field verbatim).
- **`src/lib/content/draft-generator.ts`** — `generateDraftContent`, the
  actual `AIProviderRegistry.resolveAvailable('content.generation')` call
  (routed via Epic 6's `taskDefaults` — `['openai', 'ollama']` — never
  hardcoded to one provider), `parseGeneratedContent` (parses the prompt's
  required `TITLE:/META:/BODY:` format, degrading gracefully — never losing
  the raw response — when a provider doesn't follow it), `countWords`.
- **`src/lib/content/quality-checks.ts`** — all 5 of this epic's literal
  checks, each pure and independently unit-tested:
  - `runFactCheck` — flags ungrounded absolute/superlative claims
    (`guaranteed`, `100%`, `#1`, `the best`, ...) against Epic 2's verified
    `brand_claims`; a claim IS grounded if some verified claim's own text
    contains the same phrase.
  - `runBrandVoiceCheck` — the brand must actually be named in its own
    content; an AI-assistant disclaimer phrase leaking into customer-facing
    copy is a hard fail.
  - `runDuplicateContentCheck` — word-set Jaccard similarity of the draft's
    title against Epic 3's crawled `pages` (title/h1) — `pages` stores no
    body text at all (documented Epic 3 scope limit), so this is the one
    textual signal both sides actually have; exact match fails, high overlap
    warns.
  - `runSeoChecklistCheck` — **reuses Epic 4's own `runContentChecklist`**
    (`lib/seo/technical-checklist.ts`) by feeding it the draft's own
    `word_count`/`structured_data_types` as a single-page input, rather than
    re-deriving a second scoring formula; adds title/meta length checks
    (50-60/140-160 chars) as this check's own documented addition.
  - `runGeoStructureCheck` — transcribed GEO principles (numbered-list/FAQ
    format, named citable evidence, brand-entity association) as
    deterministic signals over the draft's actual text.
  - `runAllQualityChecks` — runs all 5, always, in this fixed order.
- **`src/lib/content/serialize.ts`** — `serializeBrief`, `serializeDraft`,
  `serializeQualityCheck`, `serializeApproval`.
- **`src/routes/content-brief-generate.ts`** — `POST
  /recommendations/:id/content-brief`, mounted at the same `/api/recommendations`
  base as `recommendation-details.ts` (same "second router, same base path"
  precedent Epic 10 itself uses). 404 on unknown/foreign recommendation, 409
  when not approved, 422 when not content-type. Idempotent upsert on
  `(organization_id, recommendation_id)`.
- **`src/routes/content-briefs.ts`** — `GET /brands/me/content-briefs`
  (filterable by `status`, paginated).
- **`src/routes/content-brief-details.ts`** — `GET /content-briefs/:id`
  (brief + every draft version, so a reviewer sees version history without a
  second call) and `POST /content-briefs/:id/draft` (generates the NEXT
  version, runs all 5 quality checks, persists every result).
- **`src/routes/content-drafts.ts`** — `GET /content-drafts/:id` (draft +
  its brief inlined — "the approval screen must show the draft alongside
  its brief's original requirements"), `GET /content-drafts/:id/quality-checks`,
  `POST /content-drafts/:id/approve` (idempotent; audit-logged as
  `content.approved`).
- **`src/app.ts`** — mounted all four routers; see the header comment added
  right after Epic 10's block.
- **`src/lib/audit.ts`** — added `'content.approved'` to
  `ALWAYS_AUDITED_ACTIONS`.
- 36 unit tests (`lib/content/brief-builder.test.ts`,
  `lib/content/draft-generator.test.ts`, `lib/content/quality-checks.test.ts`)
  + 20 route-level tests (`routes/content-briefs.test.ts`) covering the exact
  DoD scenarios by name (see "Tests" below).

---

## RBAC

No new `Action` was added to `src/lib/rbac.ts` — `create_content_draft`
(owner/admin/analyst/editor) and `approve_content` (owner/admin/editor-own)
were **already present**, anticipating exactly this epic (see that file's
own `Action` union header comment). `view_intelligence` gates every GET.

`approve_content`'s "editor may approve only their own draft" is enforced
by calling `hasPermission` directly inside `routes/content-drafts.ts`'s
handler (after the draft — and hence its `created_by` — is loaded), rather
than through `requirePermission`'s middleware chain: that middleware's
`resolveOpts` callback is synchronous and only sees the request, so it
cannot look up `content_drafts.created_by` before the handler runs. Same
underlying SECURITY.md matrix, evaluated once its inputs actually exist —
never skipped or weakened. **`publish_content` (owner/admin) is never
referenced anywhere in this epic's code** — confirmed by the "ADR-007 —
this epic never publishes" test asserting the approve response never
contains a `published`/`publishedUrl` field.

---

## Response shapes

`POST /api/recommendations/:id/content-brief` → `201` (created) / `200`
(updated):
```json
{
  "created": true,
  "brief": {
    "id": "uuid", "brandId": "uuid", "recommendationId": "uuid", "pageId": null,
    "contentType": "landing_page", "title": "...",
    "targetQuery": "best freight visibility software", "targetStage": null,
    "targetIntent": "commercial", "keywords": ["best freight visibility software"],
    "outline": [{ "section": "Introduction", "notes": "..." }, ...],
    "evidenceSummary": "...", "implementationNotes": "SEO requirements: ...\n\nGEO requirements: ...",
    "researchNotes": { "brandClaims": [...], "opportunityEvidence": [...] },
    "status": "draft", "createdAt": "...", "updatedAt": "..."
  }
}
```
`404 { "error": "Recommendation not found" }`; `409` when not
`in_progress|completed`; `422` when `action_type` is not
`create_page|update_page`.

`GET /api/brands/me/content-briefs?status=&limit=&offset=` → `200`:
```json
{ "briefs": [ /* serializeBrief */ ], "pagination": { "total": 1, "limit": 25, "offset": 0 } }
```

`GET /api/content-briefs/:id` → `200`:
```json
{ "brief": { /* serializeBrief */ }, "drafts": [ /* serializeDraft, version desc */ ] }
```

`POST /api/content-briefs/:id/draft` → `201`:
```json
{
  "draft": {
    "id": "uuid", "briefId": "uuid", "brandId": "uuid", "version": 1,
    "providerName": "openai", "modelName": "gpt-4o-mini", "promptVersion": "generation.v1.0",
    "title": "...", "metaDescription": "...", "body": "...", "wordCount": 400,
    "structuredDataTypes": [], "status": "generated",
    "generatedAt": "...", "createdAt": "...", "updatedAt": "..."
  },
  "qualityChecks": [
    { "id": "uuid", "draftId": "uuid", "checkType": "fact_check", "status": "pass", "score": 100, "details": { ... }, "createdAt": "..." },
    { "checkType": "brand_voice", ... }, { "checkType": "duplicate_content", ... },
    { "checkType": "seo_checklist", ... }, { "checkType": "geo_structure", ... }
  ]
}
```
Calling this again on the same brief creates version 2 (never overwrites
version 1).

`GET /api/content-drafts/:id` → `200`: `{ "draft": {...}, "brief": {...} }`.

`GET /api/content-drafts/:id/quality-checks` → `200`:
```json
{ "draftId": "uuid", "checks": [ /* serializeQualityCheck x5 */ ] }
```

`POST /api/content-drafts/:id/approve` (body: `{ "notes"?: string }`) →
`201` (first approval) / `200` (already approved, idempotent):
```json
{
  "alreadyApproved": false,
  "approval": { "id": "uuid", "draftId": "uuid", "approvedBy": "uuid", "approvedRole": "admin", "notes": null, "approvedAt": "..." },
  "draft": { "...": "...", "status": "approved" }
}
```
`403` for a role outside `approve_content`'s allow-list, or an editor who is
not the draft's `created_by`. `draft.status` only ever reaches `"approved"`
— never `"published"` (not even representable, per the CHECK constraint).

---

## Tests

- `lib/content/brief-builder.test.ts` (12 tests) — both disambiguation
  functions over every enum value, outline splitting (SEO/GEO sections kept
  separate, target query/evidence carried through, brand-claims section
  omitted when empty), research-notes pass-through.
- `lib/content/draft-generator.test.ts` (8 tests) — `parseGeneratedContent`
  (well-formed + graceful-degradation cases), `countWords`, and
  `generateDraftContent` against a REAL `AIProviderRegistry` with hand-rolled
  fake providers: proves `resolveAvailable('content.generation')` is
  actually called (never a hardcoded provider), a real non-empty
  `promptVersion` is stamped on every call, and the `openai -> ollama`
  fallback chain works when the primary is unhealthy.
- `lib/content/quality-checks.test.ts` (16 tests) — each of the 5 checks
  individually (pass/fail/warning boundary cases, including the
  grounded-vs-ungrounded risky-claim distinction and the reused
  `runContentChecklist` scoring), plus `runAllQualityChecks` proving all 5
  run every time, in the documented order.
- `routes/content-briefs.test.ts` (20 tests) — the full DoD by name:
  brief generation carries forward the REAL `recommendation_id` and the
  FULL `implementation_notes` (not a summary); 409/422 gating on
  approval-status/content-type; idempotent brief upsert; draft generation
  routes through the (mocked) `AIProviderRegistry` and stores
  `promptVersion`; a SECOND draft creates version 2 while version 1 stays
  readable and unmodified; ALL 5 quality checks are present on every
  generation, never bypassed; a viewer is rejected from approving (403); an
  editor may approve only their OWN draft (403 otherwise); approval is
  audit-logged exactly once even across an idempotent repeat; tenant
  isolation (404, never a leaking 403) on a cross-org draft; and an explicit
  ADR-007 test asserting the approved-draft response never contains a
  `published`/`publishedUrl` field.
- Full existing `@bebest/api` suite re-run: 73 test files, 686 tests, all
  green (1 pre-existing integration file skipped, unrelated to this epic).
- `@bebest/database`: `prisma validate`, `prisma generate`, and its own
  `vitest`/`tsc --noEmit`/`eslint` all clean.
- `turbo run typecheck build --filter=@bebest/api` clean; `eslint` scoped to
  this epic's own files is clean (the one whole-package lint failure is
  Epic 12's own in-progress file — see "Concurrent-agent note" above).

---

## What's not done / known limitations (documented, not silently skipped)

1. **`published_content` (the original spec's 4th domain-model bullet) was
   not built.** The task brief that scoped this build explicitly lists only
   `content_briefs`/`content_drafts`/`content_approvals`, and this epic's own
   DoD requires it never do anything publish-shaped — adding a table for a
   link this epic can never create would be dead schema. Epic 13 owns it.
2. **`target_stage` is always `null`.** Nothing in the current schema models
   a funnel-stage concept per query/intent (checked directly — `queries` has
   `intent_type`/`category`, not a stage), so this column is populated with
   real data only once a future epic adds that concept; the column exists
   now so no migration is needed when it does.
3. **`structured_data_types` is always `[]` on a freshly generated
   draft.** v1 generates markdown prose, not schema.org JSON-LD — this makes
   the `seo_checklist` check's "missing schema markup" finding real (an
   honest gap) rather than a vacuous always-pass. A future epic that
   actually emits structured data would populate this from what it emitted.
4. **`runDuplicateContentCheck` compares TITLES only, not full body
   text.** Epic 3's `pages` table stores no body text at all by design (only
   a hash of the sanitized content — see `lib/html-extract.ts`'s own header
   comment), so a full-text diff against a draft's body is not possible from
   stored data; documented as a scope decision, same treatment
   `lib/seo/technical-checklist.ts`'s own header comment gives its
   un-implemented checklist items.
5. **No scheduled/automatic generation.** Both `POST .../content-brief` and
   `POST .../draft` are caller-triggered only — Epic 12's agents are the
   eventual scheduler, same "no cron/agent trigger defined by this epic"
   scope every prior generation-step epic in this codebase already
   documents.
6. **Frontend not built** — a separate agent wires the Content Intelligence
   experience against these exact routes/shapes.
