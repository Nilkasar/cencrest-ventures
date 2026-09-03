# Epic 14 — Measurement & Learning Loop (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
nothing under `api/`, `web-app/`, the repo-root marketing site, or
`platform/packages/*` was touched. No git commands were run, no database
was connected to, no real network call to any external provider was made —
every request goes to `platform/apps/api`'s real Epic 14 routes (read
directly from `routes/{measurements,action-measurement}.ts` and
`lib/measurement/{scoring,attribution,serialize}.ts` before writing a line
of this frontend, not guessed from the backend's own completion doc or
`docs/epics/14-measurement-learning-loop.md`'s prose — the standing rule on
this project) via `src/lib/api-client.ts`, no fixture layer, from the first
line.

Per the task brief, the delta surfaces **on the completed action it
measures** — the existing Epic 13 Actions screen
(`src/components/actions/`) was extended, not duplicated into a parallel
screen.

## What was built

### Data layer (`src/data/measurement/`)

- **`types.ts`** — `AttributionConfidence` (`high|medium|low`, reusing the
  backend's `claim_confidence` vocabulary), `GeoScoreComponent`,
  `SeoScoreComponent`, `ScoreSnapshot`, `ScoreDeltaBasis`, `Measurement`
  (mirrors `lib/measurement/serialize.ts`'s `serializeMeasurement` output
  field-for-field), `UnmeasuredActionSummary` +
  `ActionMeasurementResponse` (the `measured: false | true` discriminated
  union `GET /actions/:id/measurement` actually returns),
  `MeasurementsListResponse` (`GET /brands/me/measurements`'s shape).
- **`client.ts`** —
  - `getActionMeasurement(actionId)` — `GET /actions/:id/measurement`,
    always-200 poll-style response, translates a 404 to a named
    `ActionNotFoundError`.
  - `listBrandMeasurements(params?)` — `GET /brands/me/measurements`
    (limit/offset), 404-with-no-brand degrades to an empty page. Written
    for completeness against the real route but **not currently rendered
    by any screen** — the task brief's UI surface is the delta-on-the-
    action-that-produced-it view, not a standalone measurement-history
    screen; kept here so that future screen has a real data-access
    function rather than reinventing one.
- **`labels.ts`** — `ATTRIBUTION_CONFIDENCE_LABEL` (always renders as
  "High/Medium/Low-confidence **estimate**," never a bare confidence word,
  per the epic's non-negotiable #4) and `ATTRIBUTION_CONFIDENCE_BADGE_VARIANT`
  (`high→success, medium→warning, low→outline` — the identical mapping
  `data/seo/labels.ts`'s `KEYWORD_CONFIDENCE_BADGE_VARIANT` already
  establishes for the same three-value vocabulary, reused rather than
  invented).

### UI (`src/components/actions/measurement-panel.tsx`)

- **`MeasurementPanel`** — mounted inside `action-card.tsx`'s existing
  `Outcome` block, rendered for both `completed` and `rolled_back` actions
  (rollback reverts the publish record, not a measurement already taken
  while the action was live — the backend never clears a `measurements`
  row on rollback). Self-fetches `GET /actions/:id/measurement` via
  `useAsyncData`, the same per-row-self-fetch convention
  `keyword-group-card.tsx` (Epic 4) already establishes, rather than the
  parent `actions-view.tsx` bulk-loading every action's measurement up
  front (there is no bulk route for that — `GET /actions/:id/measurement`
  is the only way to ask, one action at a time, matching how the backend
  itself scopes it).
- **Loading / error / not-yet-measured / measured** are all explicit UI,
  no bare `if (loading) return null`:
  - Loading → skeleton bars.
  - Error → compact `ErrorPanel` with retry.
  - `measured: false` → an honest empty state, not a spinner: explains a
    baseline was captured at approval (or, if it wasn't, that the effect
    can't be measured at all — the backend's own "no before-score" case),
    and gives a real ETA (`executedAt + 28 days`, the backend's own 4-week
    `FOUR_WEEKS_MS` trigger) rather than a vague "check back later."
  - `measured: true` → the delta headline (↑/↓/flat icon + colored
    `±N.N pts`, or "Not enough data" when `scoreDelta` is `null`), the
    before→after values on whichever basis (`AI Visibility Score` or `SEO
    Health Score`) the backend actually compared, the attribution
    confidence badge, and **the backend's own `attributionNotes` text
    rendered verbatim** — this frontend never writes its own certainty
    language, only surfaces the string `estimateAttribution` already
    produced.
- **Score-must-show-its-work drill-down**: an expandable "Show score
  breakdown" reveals the full before/after `GeoScoreComponent` (mention /
  recommendation / position / coverage + formula version) and/or
  `SeoScoreComponent` (technical / content + pages analyzed + formula
  version) — the same four-component GEO shape `score-panel.tsx` (Epic 7)
  already renders, reused conceptually here rather than re-invented. When
  `afterAiRunId` is present, a link offers "View raw AI responses in AI
  Visibility" — routed to `/ai-visibility` generally, not a precise
  deep link, because Epic 7's run detail is client-state-selected within
  that page (no `/ai-visibility/runs/:id` route exists to link to); this
  mirrors `action-origin.tsx`'s own honest "resolves to the closest real
  destination, never a broken or absent link" fallback for exactly this
  situation.

### One derived value not returned by the API: `basis`

`GET /actions/:id/measurement` returns `scoreDelta` (a number) but not
which of GEO/SEO it was computed from — that label only lives inside the
free-text `attributionNotes` sentence. `measurement-panel.tsx`'s
`pickDeltaBasis()` re-derives it from `beforeScore`/`afterScore` using the
**identical preference order** `lib/measurement/scoring.ts`'s
`computeScoreDelta` documents (GEO preferred whenever both sides have a
GEO component, SEO as fallback, `"none"` otherwise) — flagged in a comment
as a duplication that must move if the backend's own preference order ever
changes, since there was no other way to label the before→after row
without it.

## Every field/enum reconciled against the real backend response

| Frontend field | Backend source (verified by reading the file) |
|---|---|
| `Measurement.attributionConfidence: "high"\|"medium"\|"low"` | `packages/database/prisma/schema.prisma`'s `claim_confidence` enum, reused verbatim by `measurements.attribution_confidence` (not a new enum) |
| `Measurement.scoreDelta: number \| null` | `serialize.ts`: `row.score_delta === null ? null : Number(row.score_delta)` — `Decimal(6,2)` coerced to `number`, nullable when neither side is comparable |
| `Measurement.beforeScore` / `.afterScore: ScoreSnapshot` | `scoring.ts`'s `ScoreSnapshot` interface — `{ geo: GeoScoreComponent \| null; seo: SeoScoreComponent \| null; capturedAt: string }`, JSONB on the DB side, returned as-is |
| `GeoScoreComponent` fields | `scoring.ts`'s `GeoScoreComponent` — `aiRunId, aiVisibilityScore, mentionScore, recommendationScore, positionScore, coverageScore, formulaVersion, measuredAt`, matched 1:1 |
| `SeoScoreComponent` fields | `scoring.ts`'s `SeoScoreComponent` — `overallScore, technicalScore, contentScore, pagesAnalyzed, formulaVersion, measuredAt`, matched 1:1 |
| `ActionMeasurementResponse` (`measured: false` branch) | `routes/action-measurement.ts`'s literal not-yet-measured JSON: `{ measured: false, action: { id, status, executedAt, beforeScoreCapturedAt } }` |
| `ActionMeasurementResponse` (`measured: true` branch) | same route, `{ measured: true, measurement: serializeMeasurement(measurement) }` |
| `MeasurementsListResponse` | `routes/measurements.ts` — `{ items, total, limit, offset }`, `measured_at` desc |
| 404 on an unknown/foreign action id | `action-measurement.ts`'s `NOT_FOUND_ERROR` — never a 403, tenant isolation preserved; mapped to `ActionNotFoundError` in `client.ts` |
| Attribution language | `attribution.ts`'s `estimateAttribution` — every `notes` string is estimate-phrased ("plausible," "cannot rule out," never "proof"/"caused"); the frontend renders this string as-is and additionally prefixes its own badge label with "…-confidence **estimate**," so the word "estimate" appears twice, never presented as a verdict |

## Results

- `pnpm --filter @bebest/web typecheck` → **clean**, zero errors.
- `pnpm --filter @bebest/web lint` → **clean**, zero errors/warnings (exit
  code 0).
- `pnpm --filter @bebest/web build` → **succeeds** (`next build`,
  Turbopack) — compiled, typechecked again by `next build` itself, all 31
  routes generated, `/actions` included and unchanged in route shape (a
  client component addition, not a new route).

## Honest scope boundaries / known limitations

1. **No standalone measurement-history screen.** `listBrandMeasurements`
   (`GET /brands/me/measurements`) is wired in the data layer but not
   rendered anywhere — the task brief's UI surface is explicitly "on the
   completed action it measures," matching `docs/09-ux/CUSTOMER_JOURNEY.md`'s
   Actions screen answer to "what have I done and what happened?," not a
   fifth screen. A weekly-digest email (the retention mechanic the brief
   also names) is a notification-delivery concern outside this epic's
   scope (no email/notification epic exists yet to hang it off of).
2. **`basis` (GEO vs. SEO) is re-derived client-side**, not returned as its
   own field by the API — see "One derived value not returned by the API"
   above. A future backend change that alters `computeScoreDelta`'s
   preference order silently desyncs this unless `pickDeltaBasis` is
   updated alongside it; flagged in-code, not otherwise guarded.
3. **The "raw AI responses" link is not a precise deep link.** It routes to
   `/ai-visibility` generally, not the specific `afterAiRunId` run, because
   Epic 7's run detail has no addressable URL of its own (client-state
   selection only) — same category of honest degrade `action-origin.tsx`
   already ships for an agent run outside its resolution window.
4. **No per-row loading cap.** `MeasurementPanel` fires one `GET
   /actions/:id/measurement` request per rendered completed/rolled-back
   `ActionCard` — correct for this build's data volumes (matches how the
   card itself renders one row per action, no virtualization anywhere in
   this codebase yet), but an org with very many completed actions would
   fan out one request per row with no batching, same unbounded-list
   characteristic `GET /brands/me/actions` itself already has server-side
   (no pagination on that route either — pre-existing, not introduced
   here).
5. **Not yet handed to `qa-tester`** for full-flow verification (approve →
   execute → simulated 4-week trigger → measurement appears on the card)
   per this project's own standing "don't self-certify a flow as done"
   rule — the backend's `run-measurement.test.ts`/`immutability.test.ts`
   cover the pipeline in isolation, but no test in this build drives the
   real UI against a live measured row end-to-end (no live DB available in
   this environment either way, per the hard constraint).

## Files created / changed

**Created:**
- `platform/apps/web/src/data/measurement/types.ts`
- `platform/apps/web/src/data/measurement/client.ts`
- `platform/apps/web/src/data/measurement/labels.ts`
- `platform/apps/web/src/components/actions/measurement-panel.tsx`
- `platform/docs/epics/14-measurement-learning-loop-frontend.md` (this file)

**Changed:**
- `platform/apps/web/src/components/actions/action-card.tsx` — imports and
  renders `MeasurementPanel` inside the `completed`/`rolled_back` branch,
  alongside the existing `Outcome` block.
