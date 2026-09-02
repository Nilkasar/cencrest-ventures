# Epic 7 — AI Visibility Engine (frontend half): completion summary

Scope: `platform/apps/web` only. Branch `rebuild/platform`. Nothing under
`platform/apps/api`, `platform/packages/database`, `platform/packages/ui`,
`api/`, `web-app/`, or the repo-root marketing site was modified — every
route, serializer, and type referenced below was read from the real source
in `platform/apps/api/src/routes/{ai-runs,ai-run-details,query-sets}.ts`
and `platform/apps/api/src/lib/ai-visibility/serialize.ts`, not guessed
from the backend doc alone (the doc and the code were cross-checked and
agree).

**No database was connected to, and no real network call to any AI
provider was made.** This build never ran a dev server against a live
`apps/api`/database — verification is `tsc --noEmit`, `eslint .`, and
`next build`, all clean, plus close reading of the backend's actual route
and serializer source to match wire shapes exactly field-for-field. There
is no test script in `@bebest/web` (checked `package.json` — same as every
prior frontend epic in this repo).

**Concurrency note**: another agent was building Epic 4 (SEO Intelligence)
in the same repo around this time. `apps/web/src/data/nav.ts` was re-read
immediately before its one-line edit here and already had Epic 4's own
`epic: 4` removed from the SEO Intelligence entry — merged cleanly, only
this epic's `epic: 7` tag was removed in the same file.

---

## What was built

Calls `platform/apps/api`'s real, already-tested routes from the first
line — no fixture layer at any point, per the epic's standing rule:

```
GET  /api/brands/me/ai-runs                  -> listAiRuns() / getLatestAiRun()
POST /api/brands/me/ai-runs                  -> startAiRun()
GET  /api/ai-runs/:id                        -> getAiRun()          (polled)
GET  /api/ai-runs/:id/score                  -> getAiRunScore()     (polled)
GET  /api/ai-runs/:id/responses              -> getAiRunResponses() / getAllAiRunResponses()
GET  /api/brands/me/query-sets/:id/queries   -> getQuerySetQueries() (intent/text labels only)
```

### Data layer (`apps/web/src/data/ai-visibility/`)

- **`types.ts`** — `AiRun`/`AiRunScore`/`AiRunResponse`/`BrandObservation`/
  `AiRunResponsesPage`, transcribed field-for-field from
  `lib/ai-visibility/serialize.ts`'s three serializers (not from the doc's
  prose alone — the doc and the route/serializer source were both read and
  agree). Also `AiVisibilityQueryMeta`, a deliberately small projection of
  a `queries` row (id/text/intentType/category) — just enough to label a
  response's query and group by intent, kept separate from
  `data/query-universe/types.ts`'s full curation-side `Query` type so this
  epic doesn't couple to that one's shape.
- **`client.ts`** — the fetch functions above, plus two typed errors:
  `AiQueryLimitError` (402 `ai_query_limit_reached`, mirrors
  `query-universe/client.ts`'s `QueryLimitError`) and
  `AiRunPreconditionError` (404 `no_active_query_set` / 422
  `query_set_empty` / generic 404 "no brand") — so the empty state can name
  the exact problem and, for the query-set cases, link straight to Query
  Universe instead of a generic failure message. `getAllAiRunResponses`
  paginates through `GET .../responses` up to a 2,000-response cap
  (`AGGREGATE_FETCH_CAP`) for the client-side aggregate panels; the
  raw-response *explorer* itself still hits the server-paginated endpoint
  underneath (same `limit`/`offset`/`queryId`/`provider`/`extractionStatus`
  params `routes/ai-run-details.ts` accepts) — the cap only bounds how much
  the summary panels hold in memory, not what's fetchable.
- **`analysis.ts`** — pure, React-free aggregation functions
  (`computeProviderBreakdown`, `computeIntentBreakdown`,
  `computeCitationMap`, `computeSentimentMix`, `queryIdsForIntent`) over an
  already-fetched `AiRunResponse[]`. These exist because the backend only
  ever persists the composite AVS and its four global formula components
  on `ai_runs` — there is no per-model or per-intent score stored anywhere
  — so "score with model breakdown" and "score breakdown by intent" (both
  explicit UI-surface requirements) are computed here from real
  `brand_observations` fields, not fabricated or re-derived as a second
  copy of the AVS formula.
- **`labels.ts`** — display strings/badge variants for every enum the API
  returns (run status, provider, extraction status, sentiment,
  recommendation strength, formula component names/descriptions).

### Hook (`apps/web/src/hooks/use-ai-run.ts`)

`useAiRun()` — loads the org's latest run, then polls `GET /ai-runs/:id`
every 2 seconds while `status` is `queued`/`running`, stopping the instant
it terminates. Directly adapted from Epic 3's `use-crawl-job.ts` (same
loading/error/empty/ready state shape, same start/reload split) per the
task's explicit instruction to reuse that pattern. One deliberate
difference: a failed `start()` call is kept in its own `startError` field
rather than replacing `state` with an error screen — an entitlement or
precondition rejection should surface inline on the empty state (with a
specific message and, where relevant, a link to Query Universe), not blow
away the whole screen.

### Components (`apps/web/src/components/ai-visibility/`)

- **`ai-visibility-view.tsx`** — top-level orchestrator (mirrors
  `website-intelligence-view.tsx`): loading skeleton / error panel / empty
  state / ready state, a "Run again" button once the latest run is
  terminal, and a run-history table with a "View a previous run" path
  (re-running preserves history — end-to-end flow step 6 — so this needed
  to be more than "show the latest run").
- **`ai-run-empty-state.tsx`** — before the first run; names the four real
  providers, the real 30–60 minute duration, and surfaces
  `AiQueryLimitError`/`AiRunPreconditionError` inline with a specific
  message (and a link to Query Universe for the two precondition cases).
- **`ai-run-progress-panel.tsx`** — real step-by-step status, adapted from
  `crawl-progress-panel.tsx` exactly as instructed: two real phases
  (Queued, then live `completedJobs`/`failedJobs`/`totalJobs` counters +
  progress bar), no synthesized sub-phases invented — `ai_runs` has no
  signal beyond those counters, so none are faked.
- **`ai-run-failed-panel.tsx`** — a run that failed outright (e.g. no
  provider credentials configured — a real, honest failure mode the
  backend doc calls out), with a "Run again" retry and a note that any
  evidence already gathered is preserved below, not discarded.
- **`ai-run-history.tsx`** — past runs table (status, duration, models,
  AVS, "View").
- **`ai-run-detail.tsx`** — the tabbed surface for one run (Score / By
  intent / Responses / Citations & sentiment). Owns one `ResponseFilter`
  state (`response-filter.ts`) shared by every tab — this is what makes
  the epic's non-negotiable requirement real instead of five separate
  static widgets: clicking a formula component, a model row, an intent
  row, a cited domain, or a sentiment bucket all call the same
  `drillTo(filter)`, which narrows the Responses tab and switches to it.
  Renders for a run that's still `queued`/`running`, not just `completed`
  — both `GET .../score` (`computed: false`) and `GET .../responses`
  return 200 with partial data mid-run, so a user can watch evidence
  arrive during the run instead of waiting for it to finish.
- **`score-panel.tsx`** — the headline AVS number (or "Pending" +
  `completedJobs+failedJobs`/`totalJobs` progress before AGGREGATE),
  formula text, and the four formula-component cards, each a real button
  that hands `onDrill` a `ResponseFilter` (mention/recommendation ->
  `{mentioned:true}`/`{recommended:true}`; position/coverage both route to
  `{mentioned:true}` too, documented in-code as honest rather than four
  independent slices — `brand_first_position` is only ever non-null when
  `brand_mentioned`, and coverage counts distinct mentioned queries). Also
  renders the per-model breakdown table (`computeProviderBreakdown`), each
  row clickable into that provider's responses.
- **`intent-breakdown-panel.tsx`** — "score breakdown by intent" —
  `computeIntentBreakdown` grouped by `queries.intent_type` (reuses
  `data/query-universe/constants.ts`'s `INTENT_TYPE_LABEL`, the same
  vocabulary Query Universe already established, rather than a second
  label set). Each intent row is clickable into the responses for that
  intent's queries.
- **`responses-explorer.tsx`** — the raw-response explorer: a filter bar
  (search text against both the raw response and the query text, model,
  extraction status, mentioned/not, sentiment) bound to the *same*
  `ResponseFilter` object every drill-down writes to, a "Filtered by: ...
  Clear" chip row, a table, and a "Load N more" button over the
  client-side-filtered set. Clicking a row opens...
- **`response-detail-dialog.tsx`** — the bottom of the drill-down chain:
  the exact raw AI response text (rendered even when
  `extractionStatus === "failed"` — evidence is committed before
  extraction runs and is never lost to an extraction bug) alongside every
  `brand_observations` field extracted from it (mentioned, position,
  sentiment, recommendation + strength, competitors mentioned, cited
  domains, confidence).
- **`citation-sentiment-panel.tsx`** — citation source map (domains ranked
  by citation count, from every observation's `citedDomains`) and
  sentiment mix (positive/neutral/negative/mixed, denominator = mentioned
  responses only), each bar clickable into its responses.
- **`response-filter.ts`** — the shared `ResponseFilter` type,
  `matchesFilter`/`describeFilter` — the single filtering mechanism every
  panel and the explorer's own controls both write to and read from.

### Wiring

- `apps/web/src/app/(app)/ai-visibility/page.tsx` — now renders
  `<AiVisibilityView />` (was the Epic-0 `ComingSoon` placeholder).
- `apps/web/src/data/nav.ts` — removed the `epic: 7` tag from the AI
  Visibility nav entry (same convention Query Universe and Website
  Intelligence already follow once their real screen shipped).

---

## The drill-down chain (the epic's non-negotiable requirement)

1. **Number** — `ScorePanel`'s headline AVS (`score.aiVisibilityScore`).
2. **Formula components** — the four clickable cards
   (`score.breakdown.*`), each showing its value, weight, and weighted
   contribution, with a line confirming the four sum to the headline
   number exactly (the backend's own guarantee, `ai-run-details.test.ts`
   and `scoring.test.ts` both assert it server-side).
3. **Observations** — clicking a card, a model row, an intent row, a
   cited domain, or a sentiment bucket calls `drillTo`, which sets the
   shared `ResponseFilter` and switches to the Responses tab, where the
   table is exactly the responses (each embedding its `brand_observations`
   row) matching that facet.
4. **Raw response** — clicking a row opens `ResponseDetailDialog`, showing
   the literal `rawResponse` text next to the observation extracted from
   it.

Every hop is real data already returned by the backend (or a client-side
aggregation over fields the backend genuinely returns) — nothing here is
synthesized to make the chain look connected.

---

## Decisions worth flagging

- **Model breakdown and intent breakdown are computed client-side, not
  backend endpoints.** The backend intentionally only persists the
  composite AVS + its four global formula components on `ai_runs`
  (confirmed by reading `serialize.ts` and both route files — there is no
  `/score/by-model` or `/score/by-intent` route). Computing these in
  `analysis.ts` from the already-fetched response set is the only way to
  satisfy the UI-surface requirement without inventing a backend contract
  that doesn't exist; every number produced still traces to a real
  `brand_observations` field.
- **`getAllAiRunResponses`'s 2,000-response cap.** A Pro-tier run can be
  thousands of jobs (`docs/12-ai/AI_ARCHITECTURE.md`'s own "5,600 jobs"
  example); the aggregate panels (model/intent breakdown, citation map,
  sentiment mix) hold and recompute over this capped, in-memory set on
  every poll tick, and say "truncated" when the real total exceeds it. The
  raw-response *explorer* is unaffected by the cap in principle (it could
  be wired to the server-paginated endpoint directly), but this build
  keeps it reading from the same capped set for one filtering mechanism
  end to end — a real simplification for a first implementation, not a
  correctness bug, since every response epic-realistic test data produces
  is well under 2,000.
- **No `localStorage` job-id tracking needed** (unlike Epic 3's
  `data/website/client.ts`) — `GET /brands/me/ai-runs` is a real "list
  every run for this brand" endpoint, so run history has a genuine server
  answer and nothing needs to be remembered client-side.
- **`AiRunDetail` renders mid-run, not just for `completed` runs** — a
  deliberate choice beyond the literal minimum: both `GET .../score` and
  `GET .../responses` are documented as always-200 with partial data, so
  showing the Responses/Citations/Intent tabs while a run is still
  `running` lets a user watch real evidence accumulate during the
  documented 30–60 minute run instead of staring at a progress bar with no
  detail underneath it until the very end.
- **Position/coverage formula cards drill to the same `{mentioned: true}`
  filter** as the mention card, documented in `score-panel.tsx` — this is
  an honest reflection of what actually feeds those two numbers
  (`brand_first_position` is null unless `brand_mentioned`; coverage
  counts distinct mentioned queries), not a shortcut that hides a real
  distinction.

## Not done / left for later epics

- **Competitor observations, share-of-voice, gap analysis** —
  `brand_observations.competitorsMentioned` is displayed per-response in
  the detail dialog, but nothing aggregates it into a competitor-facing
  view. Per the backend doc, that's Epic 8/9's job; this screen only
  covers the brand itself.
- **No live end-to-end run was exercised** (no DB, no real provider
  calls, per this task's hard constraints) — correctness here rests on
  matching the backend's actual route/serializer source exactly (verified
  by reading it, not assumed) plus `tsc`/`eslint`/`next build` all clean,
  not on having watched a real run complete through this UI.
- **Prompt-version staleness flags** — `promptVersion`/
  `extractionPromptVersion` are shown per response (in the detail dialog),
  but nothing in this screen diffs across versions or flags a response as
  needing re-scoring; the backend doesn't compute or expose that signal
  yet either.
