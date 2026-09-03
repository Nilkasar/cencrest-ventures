# Epic 9 — Opportunity Engine (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
no other branch touched, nothing under `api/`, `web-app/`, the repo-root
marketing site, `platform/apps/api`, or `platform/packages/*` was modified.
**Backend was already built** by a prior agent — this pass reads
`platform/docs/epics/09-opportunity-engine-backend.md` and the actual route/
serializer source (`routes/opportunities.ts`, `routes/opportunity-details.ts`,
`lib/opportunities/serialize.ts`, `lib/opportunities/merge-scoring.ts` — not
just the doc prose) and wires directly against it.

**No git commands were run.** No database connection, no real network call
to any AI/payment/email provider — this is a pure frontend pass; the app
talks to `platform/apps/api` over `fetch`.

---

## What was built

### `platform/apps/web/src/data/opportunities/`

- **`types.ts`** — `Opportunity`, `OpportunityDetail`, `OpportunityEvidence`,
  `OpportunitiesPage`, `RecomputeResult`/`RecomputeSummary`, transcribed
  field-for-field from `lib/opportunities/serialize.ts`'s actual
  `serializeOpportunity`/`serializeOpportunityDetail` output (read the source,
  not just the backend doc's response-shape prose). One deliberate gap
  documented inline: the list endpoint (`GET /brands/me/opportunities`) does
  **not** inline evidence — only `GET /opportunities/:id` does — which is why
  `OpportunityDetail` extends `Opportunity` rather than the two being the same
  shape.
- **`labels.ts`** — display maps for `type`/`status`/`priority`, plus
  `scoreTone`/`effortTone` (impact-shaped scores: higher = better = success;
  effort is the one score where the thresholds invert, so a 60-effort tile
  doesn't read "good" for the wrong reason) and `scoreBand` (the
  high/medium/low bucketing the effort/impact filters use — see "Known
  limitation" below). `unified` is the only opportunity type that gets the
  system's one accent (verdant) badge color, per `packages/ui/DESIGN.md`'s
  "reserved for the single most important signal on a screen" rule — it's the
  literal high-SEO-demand-AND-high-GEO-gap intersection this whole epic exists
  to surface.
- **`client.ts`** — the data-access seam, same role as
  `data/seo/client.ts`/`data/competitive-intelligence/client.ts`:
  `listOpportunities`, `recomputeOpportunities`, `getOpportunity`,
  `updateOpportunity`. Calls `/api/brands/me/opportunities`,
  `/api/brands/me/opportunities/recompute`, `/api/opportunities/:id` from the
  first line — no fixture layer. Three typed errors mirror the backend's
  exact 404 shapes: `NoActiveQuerySetError` (recompute's own precondition,
  same shape as Epic 7/8's `AiRunPreconditionError` but kept as its own class
  since this route's error set is narrower — just the one precondition plus
  the shared "no brand" case), `NoBrandProfileError`, `OpportunityNotFoundError`
  (never surfaced as a confirming 403, matching `opportunity-details.ts`'s
  own tenant-isolation convention).

### `platform/apps/web/src/components/opportunities/`

- **`opportunities-view.tsx`** — the screen's orchestrator
  (`docs/09-ux/CUSTOMER_JOURNEY.md`'s "What should I do next?" — per that
  doc's own framing, arguably the single most important screen in the
  product). A "Recompute" button in the page header runs the real merge and
  toasts a summary built from the response's own `summary` object
  (`created`/`updated`/`reactivated` counts — never invented client-side); a
  precondition failure (no active query set / no brand) renders as an inline
  banner with a direct link to fix it, not a generic toast, same pattern
  `competitor-run-start-error.tsx` uses. Five filters sit above the list:
  type/status/priority are real server-side query params on
  `GET /brands/me/opportunities` (each change triggers a refetch); impact/
  effort are client-side (see "Known limitation" below).
- **`opportunity-card.tsx`** — one opportunity. Always visible: title, type/
  status/priority badges, the intent text it was scored against, and all four
  scores (SEO demand, GEO gap — either can be `—` when that signal doesn't
  exist for this row — effort, impact) plus the headline opportunity score,
  colored by `scoreTone`/`effortTone`. Two things are load-bearing per the
  epic's UI-surface requirement:
  - **Evidence, inline or one click away.** A "Show evidence" toggle
    lazy-fetches `GET /opportunities/:id` the first time it's opened (cached
    locally after that so re-toggling doesn't re-fetch) and renders every
    `opportunity_evidence` row's `summary` **verbatim** — the exact sentences
    `buildQueryComparisonSentence`/the keyword-volume line produce
    server-side are displayed as-is, never reformatted or truncated, so
    `PRODUCT_VISION.md`'s own evidence example ("1,200 monthly searches...
    competitor appears 84%... your brand 2%... no page on this topic") reads
    on screen exactly as written.
  - **A visible next action.** A status `Select` (New / In progress /
    Completed / Dismissed) is always present. Choosing anything but Dismissed
    commits immediately; choosing Dismissed opens an inline reason prompt
    (the same "commit-on-confirm, not on-select" pattern
    `deal-detail-view.tsx`'s lost-reason box uses for the CRM's own
    required-reason transition) and refuses to submit an empty reason
    client-side, matching the backend's own 422 (`dismissalReason` required
    when transitioning to `dismissed`). Content-brief generation (the epic
    spec's other named next action) is Epic 10/11 — out of scope here, so
    "dismiss with a reason" is this screen's one real terminal action today,
    exactly as the spec anticipates.

### Wiring changes

- **`app/(app)/opportunities/page.tsx`** — now delegates to
  `<OpportunitiesView />`, replacing the Epic-0-era `ComingSoon` stub.
- **`data/nav.ts`** — removed the `epic: 9` marker from the "Opportunities"
  nav item now that it's built (every other completed epic's nav item carries
  no such marker).
- **`EPICS.md`** — row 9 updated: frontend doc linked, status note updated to
  reflect the frontend is now wired (kept at `BUILT`, not bumped to
  `VERIFIED` — that label is reserved for an independent qa-flow-tester pass
  in this repo's convention, which this task did not run).

---

## Known limitation (documented, not silently guessed at)

**Effort/impact filtering is client-side only.** The epic spec's UI surface
explicitly asks for "filterable by effort/impact/type." `type` (and, as a
bonus beyond the spec's literal ask, `status`/`priority`) are real
server-side query params — `GET /brands/me/opportunities` supports exactly
`status`/`type`/`priority` (see `routes/opportunities.ts`'s `listQuerySchema`)
and nothing else. There is no `minImpact`/`maxEffort` param on the real route.
Rather than inventing a fake filter that silently does nothing, or skipping
the requirement, `opportunity-card.tsx`'s parent view buckets the
already-fetched, real page of opportunities into high/medium/low bands
(`scoreBand`, thresholds 70/40) and filters client-side. This is real data,
never a fixture — but it only narrows whatever page is currently loaded
(`limit: 100`), not the server-side total shown in the "X total" count. A
future epic could add real `minImpact`/`maxEffort` query params to the list
route if a brand's opportunity count regularly exceeds 100.

---

## Design notes

- **Why a card list, not a table.** Each row needs to grow into a full
  evidence trail on demand (a variable number of sentences, some spanning a
  full line) — a table cell can't do that without an awkward full-width
  `<tr>` hack. `OpportunitiesPanel`/`OpportunityRow` (Epic 4's SEO
  Opportunities list) already established exactly this pattern in this
  codebase; this screen reuses the same shape rather than inventing a second
  one, deliberately, since the two lists sit one page apart in the product
  and should read as the same system.
- **Why the status control is a single `Select`, not a separate "Dismiss"
  button plus a progress stepper.** The backend's `PATCH` schema treats every
  status value symmetrically (any status can move to any other, with the one
  extra rule that `dismissed` needs a reason) — a single control that mirrors
  that symmetry, with one special case in the UI for the one status that
  needs an extra field, is a more honest reflection of the real state machine
  than inventing a linear "Start → Complete" stepper the backend doesn't
  actually enforce.
- **Why evidence is lazy-fetched per card instead of fetched for the whole
  list up front.** The list endpoint's response is deliberately light (no
  evidence inlined — see `types.ts`'s header comment); fetching
  `GET /opportunities/:id` for every row on page load would turn one list
  request into `N+1` requests before the user has expressed interest in any
  card's evidence. Fetching on first expand, then caching, means a user who
  never opens a disclosure pays zero extra requests, and one who opens
  several pays exactly as many as they opened.

---

## Verification performed

- `apps/web`: `npx tsc --noEmit` (via `turbo run typecheck --filter=@bebest/web`) —
  clean.
- `apps/web`: `npx eslint .` (via `turbo run lint --filter=@bebest/web`, whole
  app, not just changed files) — clean, zero warnings.
- `apps/web`: `npx next build` (via `turbo run build --filter=@bebest/web`) —
  succeeds; `/opportunities` compiles as a static route alongside every other
  screen.
- `apps/api`: re-ran `src/routes/opportunities.test.ts` +
  `src/lib/opportunities/merge-scoring.test.ts` as a baseline sanity check
  even though this pass touched zero backend files — 26/26 passed, confirming
  the exact contract (response shapes, error codes, idempotency/dismissal
  semantics) this frontend was built against is what the deployed routes
  actually return.
- Manually traced every response field this frontend renders back to
  `routes/opportunities.ts` / `routes/opportunity-details.ts` /
  `lib/opportunities/serialize.ts` source before writing `types.ts`, per the
  epic's standing "wire directly against the real deployed routes" rule.
- No live server was run (no `DATABASE_URL`/provider credentials available in
  this environment) — this is a static/type-level verification pass,
  consistent with every prior epic's frontend completion doc in this repo
  (e.g. `08-competitive-intelligence-frontend.md`'s own verification
  section).
- `apps/web` has no test runner configured (consistent with every prior
  epic's frontend in this repo).

## Not done / left for later epics

- **No live end-to-end run against a real running API + database** — this
  environment has no live server or DB per the hard constraints; the contract
  was verified by reading source and re-running the backend's own test suite,
  not by observing a live round-trip. A `qa-flow-tester` pass with a real
  backend should still walk the epic spec's numbered end-to-end flow before
  this moves to `VERIFIED`.
- **Effort/impact filters are client-side-only**, as documented above — a
  known, deliberate limitation given the real route's actual query params,
  not a silently-guessed shortcut.
- **No dedicated detail/deep-link page for a single opportunity.** The list's
  inline expand-for-evidence already satisfies the epic's "evidence inline or
  one click away" requirement, and Epic 4's own SEO Opportunities screen
  (the closest precedent in this codebase) also has no separate detail route
  — this screen deliberately matches that same altitude rather than adding a
  `/opportunities/[id]` page nothing else in the app links to yet. A future
  epic (e.g. once content-brief generation needs a stable URL to hand off to)
  can add one without touching this list.
- **`content`/`technical`-typed opportunities have labels defined but are
  never actually produced today** — inherited directly from the backend's own
  documented limitation #2 (only `classifyIntentGaps`'s single-intent finding
  type feeds the GEO side of the merge); this frontend's type union and label
  maps already cover both values so no frontend change is needed the day a
  future epic starts producing them.
