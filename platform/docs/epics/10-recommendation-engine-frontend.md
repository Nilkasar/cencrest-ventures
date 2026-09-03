# Epic 10 — Recommendation Engine (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
nothing under `api/`, `web-app/`, the repo-root marketing site, or
`platform/packages/*` was touched. No git commands were run, no database
was connected to, no real network call to any AI/payment/OAuth/external
provider was made — every request goes to `platform/apps/api`'s real Epic
10 routes (already built, documented in
`docs/epics/10-recommendation-engine-backend.md`) via
`src/lib/api-client.ts`, no fixture layer, from the first line.

## What was built

### Data layer (`src/data/recommendations/`)

- **`types.ts`** — `Recommendation`, `RecommendationsPage`,
  `ListRecommendationsParams`, `GenerateRecommendationResult`. Mirrors
  `apps/api/src/lib/recommendations/serialize.ts`'s `serializeRecommendation`
  field-for-field (read directly, not guessed from the epic spec's prose).
  `RecommendationStatus` is imported from `data/opportunities/types.ts`'s
  `OpportunityStatus` rather than redeclared — the backend reuses
  `opportunity_status` for this table's `status` column (same enum, same
  four values), so the two types can never drift apart.
- **`labels.ts`** — `ACTION_TYPE_LABEL`/`ACTION_TYPE_BADGE_VARIANT`,
  `LEVEL_LABEL` + `EFFORT_BADGE_VARIANT`/`IMPACT_BADGE_VARIANT` (effort:
  low=success/high=danger, inverted from impact, same "lower is better"
  reasoning `data/opportunities/labels.ts`'s `effortTone` documents),
  `RECOMMENDATION_STATUS_LABEL`/`_BADGE_VARIANT` (imported straight from
  `data/opportunities/labels.ts`, not redeclared, for the same enum-reuse
  reason as above), and `splitImplementationNotes` — parses the backend's
  exact `"SEO requirements: ...\n\nGEO requirements: ..."` wire format into
  two strings so the UI can render the dual SEO+GEO requirement as two
  visibly distinct blocks (falls back to one undivided block if the
  delimiter is ever missing, defensive only).
- **`client.ts`** — `listRecommendations` (`GET
  /brands/me/recommendations`, a 404/no-brand degrades to an empty page,
  same "let the empty state carry it" precedent
  `data/opportunities/client.ts`'s `listOpportunities` uses),
  `generateRecommendation` (`POST
  /opportunities/:id/recommendations/generate`, throws
  `OpportunityNotFoundError` on a 404), `updateRecommendationStatus`
  (`PATCH /recommendations/:id`, throws `RecommendationNotFoundError` on a
  404). `NoBrandProfileError` is this module's own copy, same convention
  `data/seo/client.ts` and `data/opportunities/client.ts` each use their
  own copy for the identical situation.

### UI

- **`src/components/opportunities/evidence-trail.tsx`** (new, factored out
  of `opportunity-card.tsx`) — `useEvidenceTrail(opportunityId)` (lazy
  `GET /opportunities/:id`, idle/loading/error/success states) and
  `EvidenceTrailPanel` (the loading skeleton / retry-on-error / evidence
  list + "Formula vX · last updated" footer, exactly as it rendered before
  this epic). Extracted so the standalone Recommendations screen's
  `RecommendationCard` can show the identical "link to its source
  opportunity's evidence" disclosure without a second, drifting copy of
  the fetch/loading/error/render logic — same fetch, same component, same
  styling, in both places.
- **`src/components/opportunities/opportunity-card.tsx`** (extended, per
  the task's explicit instruction, not duplicated) — now also accepts
  `recommendation`/`recommendationLoading`/`generatingRecommendation`/
  `onGenerateRecommendation`/`updatingRecommendationStatus`/
  `onRecommendationStatusChange` and renders `NextActionPanel` beneath the
  existing evidence disclosure and dismiss-reason flow. Nothing about the
  opportunity's own status control, dismiss-reason flow, or score tiles
  changed. `openEvidence()` opens (never toggles closed) the card's
  existing evidence disclosure when the next-action panel's "View
  evidence" link is clicked, so effort/impact/priority AND the backing
  evidence live in the same card, one click apart, per the epic's "never a
  bare instruction with no backing" requirement.
- **`src/components/recommendations/next-action-panel.tsx`** (new) — the
  opportunity's "next action" per the epic's UI-surface requirement:
    - No recommendation yet -> "No next action generated yet for this
      opportunity" + a "Generate recommendation" button
      (`onGenerateRecommendation`).
    - Loading (the list fetch this screen joins against hasn't resolved
      yet — see "Known limitations" #1) -> a skeleton row, never a
      premature "no recommendation" flash.
    - A recommendation exists -> its title, `actionType`/effort/impact/
      status badges, its `evidenceSummary` (the real quoted numbers,
      inline), a status `<Select>` of its own (`new`/`in_progress`/
      `completed`/`dismissed`, PATCHed independently of the opportunity's
      own status), a "View evidence" link into the card's own disclosure,
      a "Show/Hide implementation brief" disclosure rendering the SEO and
      GEO requirement blocks as two clearly labeled columns (via
      `splitImplementationNotes`), and a "Regenerate" button (idempotent
      re-run — safe after a Recompute changes the opportunity's evidence).
- **`src/components/opportunities/opportunities-view.tsx`** (extended) —
  fetches `listRecommendations({ limit: 100 })` alongside
  `listOpportunities`, joins the two client-side by `opportunityId` into a
  `Map` (`recommendationsByOpportunityId`), and passes each opportunity's
  match (or `undefined`) into its `OpportunityCard`. This is the exact
  join the backend's own completion doc names as the frontend's
  responsibility (its "known limitations" #1) rather than a change to
  Epic 9's already-verified list route. `handleGenerateRecommendation` /
  `handleRecommendationStatusChange` call the client above, toast on
  failure, and reload the recommendations list (not the opportunities
  list) on success — the opportunity row itself never needs to refetch
  for its next action to update.
- **`src/components/recommendations/recommendation-card.tsx`** (new) — the
  full-detail row for the standalone Recommendations screen: title,
  `actionType` badge, description, effort/impact badges, `priorityRank`
  (mono, accent-colored, matching the score-tile convention Epic 9's card
  uses for `opportunityScore`), the evidence summary as a bordered inline
  block, a status `<Select>`, a "View/Hide source evidence" disclosure
  (`EvidenceTrailPanel`/`useEvidenceTrail`, the same component
  `opportunity-card.tsx` uses), and the dual SEO+GEO implementation-notes
  blocks always visible (this IS the primary view for a recommendation, so
  unlike the inline `NextActionPanel` the brief isn't behind a second
  disclosure).
- **`src/components/recommendations/recommendations-view.tsx`** (new) —
  the "top 10 prioritized recommendations" screen
  (`docs/09-ux/CUSTOMER_JOURNEY.md`'s onboarding Step 6 + Stage 4
  dashboard). Filters: action type and status (both real
  `GET /brands/me/recommendations` query params, trigger a refetch) plus a
  "Show: Top 10/25/50" control (`limit`, defaulting to 10 to match the
  journey doc's short, prioritized list framing while still letting
  someone widen the window). List is never re-sorted client-side —
  `priorityRank` desc, server-side, same convention
  `opportunities-view.tsx` already documents for `opportunityScore`.
  Distinct empty states for "no recommendations exist yet" vs. "filters
  matched nothing," same pattern `opportunities-view.tsx` uses.
- **`src/app/(app)/recommendations/page.tsx`** (new) — renders
  `RecommendationsView`, `metadata.title = "Recommendations"`.
- **`src/data/nav.ts`** (extended) — added `{ href: "/recommendations",
  label: "Recommendations", icon: Sparkles }` as the first item in the
  "Execution" group, before `Actions` (Epic 13, not yet built) — this is
  the bridge between Epic 9's "what should I do next" opportunity list and
  Epic 13's eventual "what have I done" execution log, and unlike its
  Execution-group siblings it carries no `epic:` marker because it's real,
  wired data today.

## Design decisions worth naming

1. **One extra list fetch, joined client-side, not an N+1 per card.**
   `opportunities-view.tsx` fetches `listRecommendations({ limit: 100 })`
   once and joins by `opportunityId` — never a `GET .../recommendations`
   call per rendered `OpportunityCard`. This is also why
   `recommendationLoading` is a prop (the shared list's loading state),
   not a per-card fetch flag.
2. **Two different levels of detail for the same data, by design, not
   inconsistency.** `NextActionPanel` (inline on Opportunities) shows the
   brief behind a "Show implementation brief" disclosure because that
   screen's primary subject is the opportunity, not the recommendation.
   `RecommendationCard` (the standalone Recommendations screen) shows the
   full brief unconditionally because that screen's whole purpose IS the
   recommendation. Both pull from the exact same `Recommendation` object
   and the exact same `splitImplementationNotes` parser — no duplicated
   template logic, only duplicated-on-purpose layout.
3. **Evidence disclosure is one shared component, not two.**
   `evidence-trail.tsx`'s `useEvidenceTrail`/`EvidenceTrailPanel` is used
   by both `opportunity-card.tsx` (unchanged behavior, now factored out)
   and `recommendation-card.tsx` (new) — the same lazy `GET
   /opportunities/:id` fetch, the same loading/error/success rendering,
   in both places. Satisfies the epic's "link to its source opportunity's
   evidence" requirement without a second implementation to keep in sync.
4. **A recommendation's status is independent of its opportunity's
   status**, exactly as the backend models it (two different tables, two
   different `PATCH` endpoints, two different audit-log actions —
   `opportunity.status_changed` vs. `recommendation.status_changed`). The
   UI never conflates the two `<Select>`s or assumes changing one changes
   the other.
5. **"Regenerate" is exposed, not hidden, once a recommendation exists.**
   Since `POST .../generate` is idempotent (documented and tested
   server-side), re-running it after a Recompute changed the opportunity's
   evidence is a safe, expected action — the button label says
   "Regenerate" rather than being disabled once a recommendation exists.

## Known limitations (documented, not silently skipped)

1. **The Opportunities screen makes two real network requests where a
   single joined backend response would make one** — `listOpportunities`
   and `listRecommendations({ limit: 100 })` are fetched independently and
   joined client-side. This is the frontend side of the exact tradeoff the
   backend's own completion doc calls out (its "known limitations" #1):
   avoiding a change to Epic 9's already-verified `GET
   /brands/me/opportunities` response shape. At 100 recommendations this
   is one extra small request per page load, not a pagination concern
   today; if the recommendation count grows well past what a brand
   realistically has open opportunities for, this join should move
   server-side.
2. **The recommendations join only covers the current opportunities page.**
   `opportunities-view.tsx` requests up to 100 opportunities and up to 100
   recommendations; if a brand ever has more than 100 open opportunities,
   opportunities beyond the first page won't have a chance to show a
   locally-joined recommendation even if one exists server-side (their own
   card would just show "No next action generated yet," which is
   incorrect in that specific overflow case). Not reachable in practice
   today — Epic 9's own opportunities list has no observed brand anywhere
   near that volume — but flagged rather than silently assumed away.
3. **No inline "generate" action on the standalone Recommendations
   screen.** That screen only ever displays recommendations that already
   exist (`GET /brands/me/recommendations`) — generating one is only
   reachable from the Opportunities screen's `NextActionPanel`, which
   already has the specific opportunity in scope. Intentional: a
   "generate for opportunity X" action needs an opportunity picker with no
   natural home on a screen whose entire premise is "recommendations that
   already exist, ranked."
4. **No bulk actions.** Each recommendation's status is changed one at a
   time, matching `opportunity-card.tsx`'s own one-at-a-time precedent for
   opportunity status changes — no epic asked for bulk status changes on
   either resource.
5. **`effort`/`impact` have no client-side filter on the Recommendations
   screen**, matching the exact same limitation
   `opportunities-view.tsx` already documents for `unified_opportunities`
   (`GET /brands/me/recommendations` has no `effort`/`impact` query
   params server-side — only `status`/`actionType`/`limit`/`offset`).
6. **No automated frontend tests** — `@bebest/web` has no test runner
   configured for any screen in this codebase (checked: no `*.test.*`
   files anywhere under `apps/web/src`, no `test` script in
   `apps/web/package.json`), so this epic's frontend work follows the
   same convention as every other already-shipped `apps/web` epic.
   Verified instead via `typecheck`/`lint`/`build`, all clean (see below).

## Verification

- `turbo run typecheck --filter=@bebest/web` — clean.
- `turbo run lint --filter=@bebest/web` (`eslint .`) — clean.
- `turbo run build --filter=@bebest/web` (`next build`) — clean; the route
  table includes the new `○ /recommendations` static route alongside every
  pre-existing route, none of which regressed.
- `turbo run test --filter=@bebest/web` — no task configured (see "Known
  limitations" #6), consistent with the rest of this app.
- Manually traced against the backend's documented response shapes
  (`docs/epics/10-recommendation-engine-backend.md`) field-for-field
  before writing `data/recommendations/types.ts`, not guessed from the
  epic spec's prose.

## Files touched

New:
- `platform/apps/web/src/data/recommendations/{types,labels,client}.ts`
- `platform/apps/web/src/components/opportunities/evidence-trail.tsx`
- `platform/apps/web/src/components/recommendations/{next-action-panel,recommendation-card,recommendations-view}.tsx`
- `platform/apps/web/src/app/(app)/recommendations/page.tsx`
- `platform/docs/epics/10-recommendation-engine-frontend.md` (this file)

Extended (Epic 9's files, per the task's explicit "extend rather than
duplicate" instruction — no other behavior in either file changed):
- `platform/apps/web/src/components/opportunities/opportunity-card.tsx`
- `platform/apps/web/src/components/opportunities/opportunities-view.tsx`
- `platform/apps/web/src/data/nav.ts`
