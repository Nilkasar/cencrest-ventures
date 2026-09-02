# Epic 4 — SEO Intelligence (frontend half)

Written by: frontend pass against `docs/epics/04-seo-intelligence.md`'s "UI
surface" section and the already-built, already-verified backend
(`docs/epics/04-seo-intelligence-backend.md` + the actual route file,
`apps/api/src/routes/seo.ts`, read directly rather than trusted from prose).
Wired to the real, deployed `/api/brands/me/seo/*` routes from the first
line — no fixture/localStorage layer as the source of truth, per the
standing rule. `EPICS.md`'s numbered "end-to-end flow" section is traced at
the bottom.

## What shipped

- **Nav entry**: "SEO Intelligence" in the "Intelligence" group
  (`src/data/nav.ts`) — dropped its `epic: 4` stub marker now that the real
  screen exists (matching the pattern every completed epic's nav entry
  already follows).
- **Route**: `apps/web/src/app/(app)/seo-intelligence/page.tsx` — replaced
  the `<ComingSoon>` placeholder with the real view.
- **Data layer** (`apps/web/src/data/seo/`):
  - `types.ts` — `KeywordGroup`, `SeoKeyword`, `ChecklistCheck`,
    `TechnicalAnalysis`/`ContentAnalysis`/`SeoAnalyzeResult`,
    `SeoOpportunity`/`OpportunityEvidence`. Every field name matches
    `routes/seo.ts`'s actual `serialize*` functions verbatim (verified by
    reading the route file, not the spec's prose) — no `Api*` wire-shape +
    `map*` translation layer, the same "comes across as-is" situation
    `data/website/types.ts`'s header documents for Epic 3, because these
    serializers already return exactly the camelCase shape the UI wants.
  - `labels.ts` — badge-variant/label vocabulary for keyword intent/
    confidence/source, opportunity status, and a `checkLabel()` helper that
    reuses Epic 3's `ISSUE_TYPE_LABEL` for the ten pre-existing issue types
    a checklist result can surface, adding only the two ids this epic's
    checklist itself invents (`https`, `homepage_organization_schema`) —
    deliberately not a second, parallel copy of those ten labels.
  - `client.ts` — the data-access seam (same shape as
    `data/query-universe/client.ts`/`data/website/client.ts`): every
    exported function calls `apiClient` against `/brands/me/seo/*`.
    Typed errors (`NoBrandProfileError`, `AnalyzeBlockedError`,
    `NoKeywordCandidatesError`) translate the route's distinct 404/422 bodies
    into branches the UI renders as directed empty states, not error panels
    — mirrors `QueryLimitError`'s role in `data/query-universe/client.ts`.
    Also carries a small local `listPageSummariesForCrawlJob` (paginates
    `GET /brands/me/pages`, the same route Epic 3's own client reads) to
    resolve a `TechnicalAnalysis.pageId` to a URL/title for the drill-down
    table, since `seo_analyses` rows don't carry either.
- **Components** (`apps/web/src/components/seo/`):
  - `seo-intelligence-view.tsx` — orchestrator. Gates the whole screen on
    the brand profile existing at all (`useBrandProfile`, the same hook
    `WebsiteIntelligenceView` uses) so a brand-new org sees one "complete
    your brand profile" state instead of three redundant copies of it; owns
    the `refreshKey` that lets keyword generation tell the Opportunities
    panel to refetch.
  - `technical-health-panel.tsx` — technical health score + drill-down.
    Idle → "Run analysis" → score tiles (content score, avg word count,
    thin-content pages, new issues found) + a worst-score-first,
    click-to-expand per-page list showing every checklist item (pass/fail,
    severity, detail).
  - `keyword-coverage-panel.tsx` + `keyword-group-card.tsx` +
    `keyword-group-dialog.tsx` + `keyword-form-dialog.tsx` — full CRUD on
    `keyword_groups`/`seo_keywords` (create/rename/delete a group; add/edit/
    remove a keyword), plus the "Generate from brand profile" primary
    action.
  - `opportunities-panel.tsx` + `opportunity-row.tsx` — the
    `seo_opportunities` list, status-filterable, rendered in the server's
    own order; each row's evidence (demand/coverage/complexity/difficulty —
    the literal formula-v1.0 inputs) is one click away via a disclosure
    toggle, never re-derived or recomputed client-side.
- **Cross-epic fix, minimal and necessary**: `data/website/types.ts`'s
  `IssueType` and `data/website/labels.ts`'s `ISSUE_TYPE_LABEL` gained
  `not_https`/`missing_schema` — the two additive `issue_type` enum values
  this epic's backend added. `POST /brands/me/seo/analyze` writes real
  `page_issues` rows of these two types, which then flow back through
  `GET /brands/me/pages` and would render as an unlabeled raw enum string in
  Epic 3's own Website Intelligence screen (`PageIssuesList`) without this.
  Two-entry addition to an existing lookup table; nothing else in Epic 3's
  frontend was touched.

## Design decisions

- **No persisted "last analysis" view, because no such route exists.** The
  epic's literal API surface is `POST /analyze` only — there is no
  `GET /seo/analyses` history endpoint, and the backend's own completion doc
  confirms this is deliberate (append-only pipeline output, not a queryable
  resource yet). So `TechnicalHealthPanel`'s "ready" state is whatever the
  most recent `POST /analyze` call in *this session* returned; a page reload
  goes back to "idle" until the user runs it again. This is a real gap in
  the backend's literal surface, not a frontend shortcut — flagged here for
  whichever epic adds a history/list route.
- **`crawlJobId` is never exposed in the UI.** The route defaults to the
  brand's most recent crawl job when omitted, which is what every real user
  wants; a job picker would need a "list crawl jobs" route this epic's
  backend doesn't call for and Epic 3's own frontend doesn't expose either
  (same `localStorage`-tracked-ids gap `data/website/client.ts`'s header
  documents). Not implemented.
- **Generating keywords also creates opportunities server-side** (the
  backend's own documented resolution to the spec's missing
  `seo_opportunities` create endpoint) — the frontend's job is just to
  surface that: a success toast names both counts, and
  `KeywordCoveragePanel`'s `onGenerated` callback bumps a shared
  `refreshKey` so `OpportunitiesPanel` refetches without a manual reload.
- **Opportunity list is never re-sorted client-side.** `listOpportunities`
  renders `data.opportunities` in the exact order the response arrives in —
  the epic's end-to-end flow step 4's explicit requirement, verified against
  the route's own `orderBy: [{ opportunity_score: 'desc' }, { created_at:
  'asc' }, { id: 'asc' }]`.
- **`window.confirm` only for deleting a keyword group** (cascading loss of
  visibility into its keywords) — matches the existing precedent
  `query-universe-view.tsx` sets for "regenerate a draft"/"archive a set".
  Individual keyword removal and opportunity dismissal get no confirm
  dialog, matching that same file's precedent for single-row removal
  (`CategorySection`'s query removal).
- **`SeoKeywordIntent` is its own type, not reused from Epic 5's
  `QueryIntentType`.** They share three of four labels but differ
  (`navigational` vs. `comparison`) — conflating them would silently produce
  wrong labels for one value in each direction.
- Evidence is a disclosure, not a tooltip, even though `TooltipProvider` is
  already mounted app-wide (`UIProvider`) — the epic's own "evidence over
  opinion" framing (`packages/ui/DESIGN.md`) argues for evidence being
  genuinely inspectable (keyboard-reachable, touch-friendly), not hover-only.

## Verification

- `npx tsc --noEmit` (in `apps/web`) — clean.
- `npx eslint .` (in `apps/web`) — clean, including every file this epic
  touched or added.
- `npx next build` — succeeds; `/seo-intelligence` prerenders as a static
  route alongside all 26 other routes.
- No test script exists for `apps/web` (same as every prior frontend epic in
  this monorepo) — no-op, consistent with precedent.
- Manually traced against the real route file (`routes/seo.ts`) response
  shapes and status codes for every branch: `404` (no brand) → complete-
  profile state; `422 no_crawl_data`/`no_pages_crawled` → "crawl your
  website first" state with a link to `/website-intelligence`; `422
  no_candidates` on generate → inline message; successful `analyze`/
  `generate`/`dismiss` → the exact response shapes documented in
  `04-seo-intelligence-backend.md` render correctly against the types in
  `data/seo/types.ts`.
- No git commands were run, no database connection was made, and no real
  network call was made to any AI provider or external site (this frontend
  only ever calls this repo's own `apps/api`, itself mocked/`Null*` at the
  provider layer per the backend's own hard constraints) — only files under
  `platform/` were touched, on the checked-out `rebuild/platform` branch.

## End-to-end flow — frontend trace

Mirrors `04-seo-intelligence.md`'s numbered flow, frontend side:

1. **Technical + content analysis**: `TechnicalHealthPanel`'s "Run
   analysis" calls `runSeoAnalysis()` → `POST /brands/me/seo/analyze`. The
   response's `technicalAnalyses` (joined against page summaries) and
   `contentAnalysis` render directly; `issuesCreated` is shown as its own
   stat tile so a re-run's idempotency (no duplicate `not_https`/
   `missing_schema` rows) is visibly traceable, not just asserted by the
   backend's unit tests.
2. **Generate from brand profile**: `KeywordCoveragePanel`'s primary action
   calls `generateKeywordGroup()` → `POST /keyword-groups/generate`, which
   reads the brand's real `categories`/`use_cases` server-side (never a
   frontend fixture) and returns keywords whose `confidence` this UI always
   renders via a badge (`KEYWORD_CONFIDENCE_BADGE_VARIANT`) — an
   `"estimate"` row is never displayed as if it were a firm number.
3. **Opportunities traceable to evidence**: every row in
   `OpportunitiesPanel` shows its `demandScore`/`currentCoverage`/
   `contentComplexity`/`technicalDifficulty` one click away — the literal
   fields `evidence` carries, never recomputed or reformatted into a
   different number.
4. **Server-side, stable sort**: confirmed against `routes/seo.ts`'s
   `orderBy` and never re-sorted client-side (see "Design decisions" above).
5. **Tenant isolation**: out of scope for a frontend-only pass — the
   backend's own `it.todo` (NEEDS LIVE DB) blocks remain the source of truth
   for this; nothing in this frontend adds a second tenant boundary to
   verify.

## What's not done

- No history view for past `seo_analyses` runs — no such route exists (see
  "Design decisions").
- No crawl-job picker for `analyze` — always the brand's most recent crawl,
  matching the route's own default.
- No pagination UI on the opportunities list beyond a fixed `limit: 50` —
  the backend supports `limit`/`offset`, but no brand in this system's
  current lifecycle plausibly exceeds one generation's `MAX_GENERATED_KEYWORDS
  = 100` opportunities yet; a "load more" control is a trivial follow-up
  once that stops being true (same shape `PageIssuesList`'s "Load more"
  already establishes as this codebase's precedent).
- Every other documented gap in `04-seo-intelligence-backend.md`'s "What's
  not done" (no real paid `SEODataProvider`, no entitlement gating, no
  keyword-to-content coverage mapping, several checklist items not
  derivable from stored data) is inherited as-is — this frontend renders
  exactly what the backend computes and does not attempt to work around any
  of them client-side.
