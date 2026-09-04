# Overview Dashboard — completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`, no
other branch touched, nothing under `platform/apps/api`, `platform/packages/*`,
`web-app/`, or the repo-root marketing site was modified. **No git commands
were run** (orchestrator handles git). No database connection, no migration,
no real external network call — this is a pure frontend aggregation pass; the
app talks to `platform/apps/api` over `fetch`, exactly as every other screen
in this codebase does.

## Why this existed as a stub

A route-wiring audit found `platform/apps/web/src/app/(app)/overview/page.tsx`
— the first "Workspace" nav destination, the app's de facto landing screen —
was still 100% `ComingSoon`, with copy blocking it on "Epic 0's backend and
Epic 2," both long since built and VERIFIED. No epic doc (`docs/epics/*.md`)
specs an "Overview"/dashboard screen of its own — this was always meant to be
a synthesis screen pulling from already-built epics' own real data
(`docs/09-ux/CUSTOMER_JOURNEY.md`'s "Stage 4 — Overview Dashboard" bullet
list), not a new epic's UI surface. This build is exactly that: an
aggregation/rollup job, not a new backend concept.

## What was built

### `platform/apps/web/src/app/(app)/overview/page.tsx`

Replaced the `ComingSoon` stub. Thin: `PageHeader` (unchanged eyebrow/title,
refreshed description) + `<OverviewView />`.

### `platform/apps/web/src/components/overview/`

- **`overview-view.tsx`** — the screen's orchestrator. Gates on
  `useBrandProfile(currentOrganization.id)` (the exact hook
  `seo-intelligence-view.tsx` already uses for the same purpose) so a
  genuinely brand-new org — no brand profile at all — sees ONE clear "set up
  your brand" empty state, not four independently-broken-looking tiles all
  asking for the same prerequisite. An org mid-onboarding sees the same tile
  grid plus a one-line "resume onboarding" banner. Once onboarding is
  complete, the four tiles render unconditionally — deliberately NOT gated
  behind "has a baseline run finished yet," because that single boolean would
  hide real, legitimate partial progress (a brand that's run AI Visibility
  but not SEO yet, or vice versa). Each tile instead owns its own honest
  loading/error/empty sub-state, mirroring the per-section pattern
  `SeoIntelligenceView`'s three independent panels already establish.
- **`stat-tile.tsx`** — the one new visual primitive this build adds:
  `StatTile` (a `Card` from `@bebest/ui`, wrapped in a `next/link` so the
  entire card — not a small "View" affix — is the click target, clearing the
  44px hit-area minimum everywhere) and `StatTileSkeleton` (same footprint,
  so the grid never reflows once real data lands). Reuses the exact
  hover/focus treatment `ai-visibility/score-panel.tsx`'s clickable
  formula-component cards already establish (`hover:border-accent` +
  `focus-visible:ring-ring`) rather than inventing a new interaction
  pattern. This is the only new "primitive," and it was added deliberately
  (composing the real `Card`, not hand-rolled from scratch) rather than
  inline in the page, per this app's design-system rule.
- **`ai-visibility-tile.tsx`** — AI Visibility Score, with trend.
- **`seo-health-tile.tsx`** — SEO Health Score. See "Honest gap" below —
  this tile is intentionally not wired to a fetch.
- **`opportunities-tile.tsx`** — active opportunities count.
- **`next-action-tile.tsx`** — the single next thing to do.

## Exactly which real data-layer functions were reused

No new client function, no new type, no new backend route was written or
invented anywhere in this build. Every number on this screen comes from a
function that already existed and is already called by an already-VERIFIED
screen:

| Tile | Function(s) reused | Same real route | Already called by |
|---|---|---|---|
| AI Visibility | `listAiRuns()` — `data/ai-visibility/client.ts` | `GET /brands/me/ai-runs` | `AiVisibilityView` (via `useAiRun`) |
| SEO Health | *(none — see below)* | — | — |
| Opportunities | `listOpportunities({ status, limit: 1 })` ×2 — `data/opportunities/client.ts` | `GET /brands/me/opportunities` | `OpportunitiesView` |
| Next action | `getActionsOverview()` — `data/actions/client.ts` | `GET /brands/me/actions` | `ActionsView` |
| Next action | `listRecommendations({ status: "new", limit: 1 })` — `data/recommendations/client.ts` | `GET /brands/me/recommendations` | `RecommendationsView` |
| Gate | `useBrandProfile()` — `hooks/use-brand-profile.ts` | (onboarding store) | `SeoIntelligenceView` |

Selection logic added on top of those real responses (all client-side, none
of it a new fetch):

- **AI Visibility trend**: `listAiRuns()` returns newest-first; the tile
  filters to `status === "completed" && aiVisibilityScore !== null` and
  diffs the two most recent completed runs. `AiRun.aiVisibilityScore` is read
  straight off the row — never recomputed — same field `score-panel.tsx`
  reads via `AiRunScore`, just sourced from the list endpoint instead of the
  per-run score endpoint (the list already carries it, so `getAiRunScore` is
  not called an extra time just for this tile).
- **Opportunities count**: "active" = `new` + `in_progress` totals, each read
  from that status's own real, server-computed `pagination.total` (two
  `limit: 1` calls — cheap, no full page ever fetched for a count).
- **Next action precedence**: a pending approval (from `getActionsOverview()`)
  wins over a recommendation whenever one exists — it's already been turned
  into a concrete, reviewed action waiting on a single click, versus a
  recommendation nothing has acted on yet. Within pending approvals, the
  highest `priority` (`critical` > `high` > `medium` > `low`) wins, since
  `GET /brands/me/actions` only sorts `pending` by `created_at` desc, not
  priority (confirmed against `apps/api/src/routes/actions.ts`). When nothing
  is pending, the fallback is the single top recommendation, fetched with
  `status: "new", limit: 1` so the API's own real sort (`priorityRank` desc —
  `routes/recommendations.ts`) — never re-derived client-side — picks it.

## The no-baseline-yet state

Two real states, both driven by the real backend, not a hypothetical:

1. **No brand profile at all** (`profile.status === "not_started"` or no
   profile): `OverviewView` short-circuits to a single centered card — "Set
   up your brand to get started" + a button straight to `/onboarding` — the
   same shape `SeoIntelligenceView` already uses for this exact situation.
   No tiles render.
2. **Brand profile exists, but no AI Visibility run has ever completed**:
   the four tiles DO render (onboarding is done — there's a real dashboard
   to show, even if some of it is still empty), and `AiVisibilityTile`'s own
   `runs.length === 0` branch shows "Not started" with copy naming the real
   mechanics (which four assistants, that it's backgroundable) rather than a
   generic spinner, linking to `/ai-visibility` where the actual "Run
   baseline" trigger lives — this tile does not duplicate that trigger or
   its precondition-error handling (`AiQueryLimitError`,
   `AiRunPreconditionError`), which stays owned by `AiVisibilityView`/
   `useAiRun`, the one place that already handles it correctly. While a
   baseline is queued/running, the tile shows live `progressPct` (still from
   `listAiRuns()`'s already-real `AiRun.progressPct`/`completedJobs`/
   `totalJobs` fields, no new polling loop added — a user who wants the full
   step-by-step agent-progress view still goes to `/ai-visibility`, which
   already has one).

The Opportunities and Next-action tiles independently show the same
"nothing yet, here's exactly why and what to do" pattern for their own empty
case (zero active opportunities; no pending approval and no recommendation),
each following `docs/09-ux/CUSTOMER_JOURNEY.md`'s literal empty-state rule
(explain why, say what to do, one click away) — reusing that doc's own
"We're still analyzing your brand..." example phrasing for the opportunities
case.

## Honest gap: SEO Health Score has no persisted read

`SeoHealthTile` is deliberately **not** wired to a fetch. Read directly
against the real backend source (`apps/api/src/routes/seo.ts`), there is no
`GET` route for `seo_analyses` at all — only `POST /brands/me/seo/analyze`,
which always computes a fresh score and returns it inline, once, with
nothing persisted for a later read. This is the exact gap
`technical-health-panel.tsx`'s own doc comment already names: "there is no
GET history route for seo_analyses... a page reload goes back to idle until
analyze is run again. That is a real gap in the backend's literal API
surface, not a frontend shortcut."

Two options were rejected on purpose:

- **Auto-POSTing `/analyze` on every Overview page load** — a mutating,
  non-idempotent call (re-scores every crawled page, writes fresh
  `seo_analyses` rows) is never an acceptable side effect of just looking at
  a dashboard.
- **Reading a cached number from `TechnicalHealthPanel`'s in-session state**
  — that state is genuinely session-scoped React state, not backend truth;
  showing it here would be presenting a number the Overview didn't actually
  fetch as if it had, on a route that may never have mounted that component
  at all.

Instead, the tile honestly shows a dash and a direct link to
`/seo-intelligence`, where the real "run (or re-run) your Page Analysis
Checklist" action lives. **This is a real, pre-existing backend gap this
build did not introduce and was explicitly out of scope to fix** (hard
constraint: nothing outside `platform/apps/web`, no DB/migration work). Once
Epic 4's backend grows a persisted brand-level read route, this tile is a
straight swap to a `useAsyncData` fetch exactly like `AiVisibilityTile`'s —
no reshaping of the surrounding grid needed.

## Verification

Run from `platform/`:

- `pnpm --filter @bebest/web typecheck` — clean.
- `pnpm --filter @bebest/web lint` — clean (one unused-import error caught
  and fixed during the build).
- `pnpm --filter @bebest/web build` — succeeds; `/overview` compiles as a
  static (`○`) route alongside every other screen.

Not run (per the hard constraints this build operated under): no
`qa-flow-tester` pass, no live-database exercise of the four real routes
this screen depends on. All four are already independently VERIFIED by
their own screens (`/ai-visibility`, `/opportunities`, `/actions`,
`/recommendations`) — this build's own responsibility was correct reuse and
selection logic on top of them, checked by `typecheck`/`lint`/`build` plus
direct reading of the actual route source for the two precedence/ordering
claims above (`routes/actions.ts`'s pending sort, `routes/seo.ts`'s route
list).
