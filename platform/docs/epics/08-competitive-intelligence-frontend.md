# Epic 8 — Competitive Intelligence (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
no other branch touched, nothing under `api/`, `web-app/`, the repo-root
marketing site, `platform/apps/api`, or `platform/packages/*` was modified
except one shared type file noted below. **Backend was already built** by
a prior agent — this pass reads `platform/docs/epics/08-competitive-intelligence-backend.md`
and the actual route/serializer source (not just the doc prose) and wires
directly against it.

**No git commands were run.** No database connection, no real network call
to any AI/payment provider (this is a pure frontend pass — the app talks to
`platform/apps/api` over `fetch`, which itself mocks/stubs providers in
tests; nothing here calls a provider directly).

---

## What was built

### `platform/apps/web/src/data/competitive-intelligence/`

- **`types.ts`** — `CompetitiveGapsResponse`, `ShareOfVoiceResponse`,
  `MovementResult`, and the four `GapFinding` variants
  (`IntentGapFinding`/`ContentGapFinding`/`EntityGapFinding`/`SourceGapFinding`),
  transcribed field-for-field from `routes/competitive-intelligence.ts` and
  `routes/competitor-ai-runs.ts` (the actual route source, cross-checked
  against the backend completion doc's "API surface" section rather than
  trusted blind).
- **`client.ts`** — the data-access seam, same role as
  `data/ai-visibility/client.ts`: `listCompetitorAiRuns`,
  `getLatestCompetitorAiRun`, `startCompetitorAiRun`, `getCompetitiveGaps`,
  `getShareOfVoice`, `getCompetitorMovement`. Calls
  `/api/brands/me/competitors/:id/ai-runs`,
  `/api/brands/me/competitive-gaps`, `/api/brands/me/share-of-voice`,
  `/api/brands/me/competitors/:id/movement` from the first line — no
  fixture layer. Three typed errors mirror the backend's exact 402/404/422
  shapes: `CompetitorTrackingLimitError` (the epic's own
  `competitors_tracked`-reused-as-a-different-counter cap),
  `AiQueryLimitError`, `CompetitorNotFoundError`; the two PREPARE
  preconditions (`no_active_query_set`/`query_set_empty`) reuse Epic 7's
  own `AiRunPreconditionError` class directly, since they're the literal
  same brand-level check.
- **`labels.ts`** — display maps for `gapType`/severity/movement direction,
  plus `intentTypeLabel()`, which wraps Epic 5's `INTENT_TYPE_LABEL`
  (a 4-value enum map) with the fifth `'uncategorized'` case
  `perIntentTypeGap` can return, rather than widening that map's type for
  one Epic 8 caller.

Competitor CRUD itself (add/edit/remove, the entitlement-limit dialog) is
**not** re-implemented here — it already exists, fully wired to the real
API, in `lib/onboarding-client.ts` (`addCompetitor`/`updateCompetitor`/
`removeCompetitor`/`EntitlementError`) and
`components/onboarding/competitor-dialog.tsx`, built during Epic 2. The
Competitors screen imports and reuses those directly instead of a second,
parallel implementation.

### `platform/apps/web/src/hooks/use-competitor-ai-run.ts`

The per-competitor twin of Epic 7's `use-ai-run.ts`: loads a competitor's
latest run, then polls `GET /ai-runs/:id` (Epic 7's own route — it's scoped
by organization only, not by whether `competitor_id` is set, so it works
unmodified for a competitor run) every 2s while non-terminal. One instance
per `CompetitorCard`, so a portfolio of tracked competitors runs and polls
independently rather than sharing one poll loop.

### `platform/apps/web/src/components/competitors/`

- **`competitors-view.tsx`** — the screen's orchestrator. Loads the brand
  profile (`useBrandProfile`, Epic 2's real hook — competitor list +
  plan/limit banner) and `getCompetitiveGaps()` once (shared by two child
  panels below, so it isn't fetched twice). Renders the entitlement banner,
  one `CompetitorCard` per tracked competitor, then
  `ShareOfVoicePanel` / `CompetitiveGapPanel` / `GapFindingsPanel` /
  `MovementPanel`. The add/edit/remove dialog is the same
  `CompetitorDialog` component Epic 2's onboarding wizard uses.
- **`competitor-card.tsx`** — one competitor: name, priority badge,
  website, live AVS + status badge, a run/run-again trigger
  (`useCompetitorAiRun`), edit/remove actions. Expands to render
  **`AiRunDetail` — the literal same Epic 7 component** (score -> formula
  -> observation -> raw response, model breakdown, intent breakdown,
  citations/sentiment) pointed at this competitor's own `ai_runs` row. This
  is the epic's "reuse Epic 7's AI-run progress/history UI patterns"
  instruction taken literally rather than re-implemented: the in-flight
  state reuses `AiRunProgressPanel`, a failure reuses `AiRunFailedPanel`,
  and a finished run's full drill-down reuses `AiRunDetail` verbatim — zero
  duplicated run-detail UI code.
- **`competitor-run-start-error.tsx`** — typed-error -> precise inline
  message for a failed `POST .../ai-runs`, mirroring
  `AiRunEmptyState`'s `describeStartError` pattern for the competitor
  route's distinct error set.
- **`share-of-voice-panel.tsx`** — Share of AI Voice as a stacked bar (your
  share + each competitor's, widths proportional) plus the exact mention
  counts/percentages below it. Renders the DoD's boundary cases correctly
  because it renders exactly what the API returns: zero total mentions ->
  its own explicit "no mentions yet" empty state (never a NaN-shaped bar);
  a competitor with `tracked: false` is labeled "not yet run on this query
  set" rather than silently shown at 0%.
- **`competitive-gap-panel.tsx`** — the per-intent comparison table (one
  competitor at a time via a picker — a table with up to 20 competitor
  columns, the Pro-tier ceiling, would not be readable) plus the
  query-level evidence list rendering the signature sentence **verbatim**
  from the API (`buildQueryComparisonSentence`'s output is displayed
  as-is, never reformatted or summarized), satisfying the spec's "the UI
  ... should produce it verbatim-shaped" requirement literally. Handles
  every one of the backend's "not ready yet" states as its own named empty
  state (no active query set / brand hasn't completed a baseline yet / no
  competitors tracked) rather than one generic blank panel.
- **`gap-findings-panel.tsx`** — the four independently-`gapType`-tagged
  findings, filterable by type via tabs with live counts, each finding
  rendered with its type-specific fields (never a single generic "you're
  behind" line) plus a one-line explanation of what that gap type means.
- **`movement-panel.tsx`** — deliberately built as an honest **on-demand
  check**, not a fake alert feed. `GET .../movement` is real and already
  built (compares a competitor's two most recent completed runs); this
  panel exposes it per-competitor behind a "Check movement" button and, at
  the top of the section, a real empty state naming exactly what's
  missing: *"Proactive movement alerts... ship with Epic 12's Competitor
  Agent, once runs are on a schedule."* This is the task's explicit
  instruction ("a well-designed empty state naming that is correct here,
  not a fake alert") combined with actually surfacing the genuinely-built
  comparison endpoint rather than hiding it until Epic 12.

### Shared file touched

- **`data/ai-visibility/types.ts`** — added `competitorId: string | null`
  to the `AiRun` interface (re-read immediately before editing, per the
  task's shared-file instruction; no concurrent edits found). This is what
  makes `AiRunDetail`/`AiRunProgressPanel`/`AiRunFailedPanel` reusable
  as-is for a competitor run: the backend's `serializeAiRun` already
  returns this field for every run (Epic 7's original brand runs get
  `null`), the frontend type just hadn't caught up yet. Grepped the whole
  `apps/web/src` tree for any literal `AiRun` object construction that
  would need the new field added — none exists (every `AiRun` in the app
  comes from a real API response), so this was a type-only, non-breaking
  addition.
- **`data/nav.ts`** — removed the `epic: 8` marker from the "Competitors"
  nav item now that it's built (every other completed epic's nav item
  carries no such marker).
- **`app/(app)/competitors/page.tsx`** — now delegates to
  `<CompetitorsView />`, replacing the Epic-2-era stub page (a fake "Add a
  competitor" dialog that only toasted "not wired up yet," and a
  `ComingSoon` empty state for Epic 8).

---

## Design notes

- **Why cards, not one dense table, for the competitor list.** A table row
  can't grow into a full tabbed drill-down (score/intent/responses/
  citations) without becoming awkward markup (nested tables, or a
  full-width `<tr>` hack). A `Card` per competitor can expand into exactly
  that — same visual language `packages/ui/DESIGN.md` already uses for
  every other "surface with real elevation" instance in the app.
- **Why the per-intent comparison table picks one competitor at a time.**
  The backend returns `perIntentTypeGap` per competitor independently; a
  single table with N competitor columns stops being legible well before
  the Pro tier's 20-competitor ceiling. A picker (defaulting to the first
  competitor with a comparable run) keeps the table two-competitor-wide
  (you vs. one) and readable at every plan tier.
- **Why `getCompetitiveGaps()` is fetched once in the parent view.**
  `CompetitiveGapPanel` and `GapFindingsPanel` both need the identical
  response (the same `gaps` array powers the per-query evidence list and
  the classified findings list) — lifting the fetch to `CompetitorsView`
  and passing the `AsyncState` down avoids requesting it twice on every
  poll/reload.
- **No `set-state-in-effect` cascades.** The gap panel's "default to the
  first competitor with a run" logic is computed at render time from
  `gaps` (a plain derived value), not via a `useEffect` + `setState` —
  avoids the cascading-render lint violation `use-ai-run.ts`'s own
  documented exception doesn't apply to here (there's no "restart on
  reload" case to justify it).

---

## Verification performed

- `apps/web`: `npx tsc --noEmit` — clean.
- `apps/web`: `npx eslint .` (whole app, not just changed files) — clean,
  zero warnings.
- `apps/web`: `npx next build` — succeeds; `/competitors` compiles as a
  static route alongside every other screen.
- `apps/api`: `npx vitest run` — re-run as a baseline sanity check even
  though this pass touched zero backend files: 482 passed + 54 todo, 0
  failures, `competitive-intelligence.test.ts` and
  `competitor-ai-runs.test.ts` both green, confirming the contract this
  frontend was built against is exactly what ships.
- Manually traced every response field this frontend renders back to
  `routes/competitive-intelligence.ts` / `routes/competitor-ai-runs.ts` /
  `lib/ai-visibility/serialize.ts` source (not just the backend completion
  doc's prose) before writing `types.ts`, per the epic's standing "wire
  directly against the real deployed routes" rule.
- No live server was run (no `DATABASE_URL`/provider credentials available
  in this environment) — this is a static/type-level verification pass,
  consistent with every prior epic's frontend completion doc in this repo
  (e.g. `07-ai-visibility-engine-frontend.md`'s own verification section).

## Not done / left for later epics

- **No live end-to-end run against a real running API + database** — this
  environment has no live server or DB per the hard constraints; the
  contract was verified by reading source, not by observing a live
  round-trip. A `qa-flow-tester` pass with a real backend should still walk
  the epic spec's numbered end-to-end flow before this moves to VERIFIED.
- **Movement alerts remain on-demand, not proactive**, exactly as the
  backend intentionally left them — Epic 12's Competitor Agent is what
  turns `getCompetitorMovement` into an actual notification feed. The
  empty state names this explicitly rather than faking it.
- **`perIntentTypeGap`/`gaps` "re-run me" state has UI copy now** (the
  backend doc flagged this as unwritten frontend work) — `CompetitiveGapPanel`
  labels a competitor with `run: null` as "hasn't been run on this query
  set yet" both in the picker and the headline sentence.
- **No dedicated e2e/component test suite** — `apps/web` has no test
  runner configured in this repo (consistent with every prior epic's
  frontend; verification is typecheck + lint + build, per this repo's
  established convention).
