# Epic 11 — Content Intelligence & Generation (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
nothing under `api/`, `web-app/`, the repo-root marketing site, or
`platform/packages/*` was touched. No git commands were run, no database
was connected to, no real network call to any AI/external provider was
made — every request goes to `platform/apps/api`'s real Epic 11 routes
(already built, documented in
`docs/epics/11-content-intelligence-generation-backend.md`) via
`src/lib/api-client.ts` (the corrected `Authorization: Bearer` + refresh-on-401
pattern), no fixture layer, from the first line. Every response shape below
was read directly from `apps/api/src/lib/content/serialize.ts` and the
route files themselves, not guessed from the epic spec's prose.

## What was built

### Data layer (`src/data/content/`)

- **`types.ts`** — `ContentBrief`, `ContentDraft`, `ContentQualityCheck`,
  `ContentApproval`, plus every route's request/response wrapper
  (`ContentBriefsPage`, `GenerateContentBriefResult`, `ContentBriefDetail`,
  `GenerateDraftResult`, `ContentDraftDetail`, `QualityChecksResult`,
  `ApproveDraftResult`). Mirrors `serializeBrief`/`serializeDraft`/
  `serializeQualityCheck`/`serializeApproval` field-for-field. `details` on
  `ContentQualityCheck` is kept as a loose `Record<string, unknown>` — it
  genuinely differs per `checkType` (read directly from
  `apps/api/src/lib/content/quality-checks.ts`'s five result builders) — and
  is narrowed to a specific per-check shape only at the one render site that
  needs to (`quality-check-list.tsx`).
- **`labels.ts`** — status/type label + badge-variant maps for
  `ContentBriefStatus` (`draft|in_review|approved|archived` — only `draft`
  is reachable today, since no route in this epic's backend ever transitions
  a brief past it; documented here rather than silently narrowing the type),
  `ContentDraftStatus` (`generated` → "Awaiting approval", `approved` →
  "Approved — ready to publish" — no `"published"` label exists because
  the value itself cannot exist, per ADR-007), the five `QualityCheckType`s
  in their fixed run order (`QUALITY_CHECK_ORDER`, matching
  `runAllQualityChecks`'s literal order), and `splitImplementationNotes` —
  the exact same `"SEO requirements: ...\n\nGEO requirements: ..."` parser
  `data/recommendations/labels.ts` already has, since a brief's
  `implementationNotes` is that same recommendation field carried forward
  verbatim.
- **`client.ts`** — one function per route: `listContentBriefs` (`GET
  /brands/me/content-briefs`, 404/no-brand degrades to an empty page, same
  "let the empty state carry it" precedent every other `listX` in this app
  uses), `generateContentBrief` (`POST
  /recommendations/:id/content-brief`, throws
  `RecommendationNotFoundError`/`RecommendationNotApprovedError`/
  `RecommendationNotContentTypeError` on 404/409/422 respectively),
  `getContentBrief` (`GET /content-briefs/:id`), `generateDraft` (`POST
  /content-briefs/:id/draft`), `getContentDraft` (`GET
  /content-drafts/:id`), `getQualityChecks` (`GET
  /content-drafts/:id/quality-checks`), `approveDraft` (`POST
  /content-drafts/:id/approve` — a 403 from an insufficient role, or an
  editor approving a draft they didn't themselves generate, is surfaced
  as-is; there is no client-side role pre-check because there is no real
  client-side source of the current user's role yet anywhere in this app —
  checked directly: `lib/auth-state.ts` stores only tokens, and the one
  place that reads a role client-side, `components/settings/billing-panel.tsx`,
  reads it from `data/fixtures`, which this epic's "no fixture layer" rule
  rules out using).

### UI

- **`src/components/content/quality-check-list.tsx`** (new, shared) — the 5
  quality-check results, always rendered in `QUALITY_CHECK_ORDER`, never
  behind a click. Per-`checkType` detail rendering (risky/grounded phrases
  for `fact_check`, brand-name/AI-disclaimer signals for `brand_voice`,
  title-similarity + most-similar URL for `duplicate_content`, title/meta
  length + the reused-checklist findings for `seo_checklist`, the 4 GEO
  signals for `geo_structure`) reads each check's own `details` shape
  directly from the backend's check builders — not a generic "dump the
  JSON" fallback. Used by both the "awaiting approval" list AND the
  approval screen, so the two never render checks differently.
- **`src/components/content/brief-row.tsx`** (new) — one row in "Active
  briefs": title, content-type + status badges, target query, a "Show
  brief" disclosure (evidence summary, the SEO/GEO requirement split, brand
  claims/keywords — same "Show implementation brief" disclosure pattern
  `next-action-panel.tsx` already established for Epic 10), a "Generate
  draft"/"Regenerate draft" button (`POST .../draft`), and — once its
  per-brief detail fetch resolves — a compact version-badge list (`v1`,
  `v2`, ...) each linking straight to `/content/drafts/:id`.
- **`src/components/content/pending-draft-card.tsx`** (new) — one draft
  awaiting approval: title, version, brief context, and its full
  `QualityCheckList` rendered inline (the epic's literal UI requirement —
  "not hidden behind a click"), with a "Review & approve" button that goes
  to the dedicated approval screen rather than approving from the list
  (approving here, without the brief's requirements in view, would be
  exactly the "approving blind" the epic spec calls out).
- **`src/components/content/content-view.tsx`** (new) — the `/content`
  screen: three tabs, "Active briefs (`n`)" / "Awaiting approval (`n`)" /
  "Published" (counts real, from the joined fetch below), matching the
  epic's literal UI-surface list. "Published" is a static empty state
  naming Epic 13 — this epic's backend deliberately has no
  `published_content` code path to call.
- **`src/components/content/draft-approval-view.tsx`** (new) — the
  `/content/drafts/:id` approval screen. `GET /content-drafts/:id` already
  returns `{ draft, brief }` together specifically for this screen (see the
  backend route's own header comment), rendered as a two-column
  side-by-side layout: **left** = the brief's original requirements (target
  query, evidence summary, the SEO/GEO split, brand claims referenced,
  keywords), **right** = the generated draft (title, meta description,
  full body, provider/model/`promptVersion`, word count) — this is the
  epic's literal requirement made structurally true, not just visually
  adjacent. Below that: the same `QualityCheckList`, always visible. Below
  that: the Approve action (optional notes, `POST .../approve`) — absent
  entirely once `draft.status === "approved"`, replaced by a plain "ready
  to publish, nothing published automatically" confirmation. A sibling
  version-pill row (fetched via one extra `GET /content-briefs/:id`,
  reusing the brief id already in hand) lets a reviewer jump between
  versions of the same brief without going back to the list.
- **`src/app/(app)/content/page.tsx`** (replaced the Epic-0-era
  `ComingSoon` placeholder) — renders `ContentView`.
- **`src/app/(app)/content/drafts/[id]/page.tsx`** (new) — renders
  `DraftApprovalView`.
- **`src/data/nav.ts`** (extended) — removed `epic: 11` from the `/content`
  nav item, same "no longer carries a future-epic marker once it's real,
  wired data" treatment Epic 10's frontend doc documents for
  `/recommendations`.
- **`src/components/recommendations/next-action-panel.tsx`** (extended,
  Epic 10's file) — added a self-contained "Generate content brief" button,
  shown only when `recommendation.actionType` is `create_page`/
  `update_page` (the client-side mirror of
  `isContentTypeRecommendation`; the server still re-checks and 409/422s
  regardless — this only decides whether the button renders). This is the
  epic's actual pipeline entry point ("Receive content brief... from an
  approved, content-type Recommendation") — without it, `POST
  /recommendations/:id/content-brief` would have no UI trigger anywhere in
  the product. Calls `generateContentBrief` directly and toasts
  success/failure; nothing else in the file's existing behavior (status
  select, evidence link, implementation-notes disclosure, Regenerate)
  changed.

## Design decisions worth naming

1. **Briefs and their draft history are joined client-side, not fetched
   per-card on demand.** `GET /brands/me/content-briefs` returns briefs
   only; the draft list only comes back from the per-brief `GET
   /content-briefs/:id`. `content-view.tsx`'s `loadContentOverview` fetches
   every brief's detail up front (in parallel) so the "Awaiting approval"
   tab can be populated and counted on first render, rather than lazily
   per row — the epic's "not hidden behind a click" requirement applies to
   the quality checks specifically, but the same reasoning extends to
   "which drafts are even pending" needing to be known without a click.
   Documented tradeoff (see "Known limitations" below), same class of
   decision `opportunities-view.tsx`'s own header comment already
   documents for its opportunity/recommendation join.
2. **The Approve action lives ONLY on the dedicated approval screen, never
   inline on the list.** `PendingDraftCard` renders the full quality-check
   results (satisfying the "visible, not hidden" requirement) but its only
   action is a link to `/content/drafts/:id` — approving from there is the
   one place the brief's original requirements are actually in view,
   per the epic spec's own "approving blind... defeats the point" framing.
3. **No client-side approve-permission gate.** Every other permission-gated
   mutation in this app (recommendation status changes, opportunity
   dismissal, etc.) also has no client-side role pre-check — there is
   currently no real source of the logged-in user's role anywhere in
   `apps/web` outside one legacy fixture-backed panel (`billing-panel.tsx`),
   which this epic's "no fixture layer" rule rules out reaching for. A 403
   from `POST .../approve` (wrong role, or an editor approving someone
   else's draft) is caught and shown as a toast, same as every other
   permission failure in this app today.
4. **`content_briefs.status` is rendered with its full 4-value vocabulary
   even though only `"draft"` is reachable today.** No route added by this
   epic's backend ever writes `in_review`/`approved`/`archived` — that's a
   backend-documented gap (`content-briefs-backend.md` doesn't claim
   otherwise), not a frontend oversight. Keeping the full label/badge map
   means a future epic that starts writing those values needs no frontend
   change to display them correctly.
5. **`published_content`/"Published" tab is a static, un-fetched empty
   state.** There is no backend route to call — the backend's own
   completion doc lists this as explicitly out of scope for Epic 11
   (Epic 13's territory) — so this tab makes zero network requests, unlike
   the other two.

## Known limitations (documented, not silently skipped)

1. **`loadContentOverview` makes `1 + N + M` requests** (1 briefs list, N
   per-brief detail fetches for draft history, M quality-check fetches for
   whichever drafts turn out to be pending) **where a purpose-built
   aggregate endpoint would make one.** There is no bulk "all drafts across
   every brief" or "all pending drafts with their checks" route in this
   epic's API surface (checked directly against the backend's own
   documented routes) — a brief's own draft history is genuinely only
   reachable via its `:id`. Acceptable at the epic's real current scale
   (one brief per approved content-type recommendation, a handful of
   versions each); if brief/draft volume grows substantially, this join
   should move server-side, same caveat Epic 10's frontend doc raises for
   its own opportunity/recommendation join.
2. **No pagination UI.** `listContentBriefs({ limit: 100 })` is called with
   a single fixed page size; the "Active briefs" tab has no "load more" —
   matching the same 100-item ceiling `opportunities-view.tsx`/
   `recommendations-view.tsx` already use for the same reason (no observed
   brand anywhere near that volume yet).
3. **No brief-status filter UI.** `listContentBriefs`'s `status` param is
   wired end-to-end in `client.ts`/`types.ts` but not exposed as a
   `<Select>` on the screen, since every brief in practice is `"draft"`
   today (see design decision #4) — a filter over a single-valued field
   would be dead UI. Trivial to add once a future epic starts writing the
   other three statuses.
4. **No inline draft-body editing.** A generated draft is read-only in this
   UI (view + approve only) — this epic's own spec never asks for
   human-edited drafts, only "regenerate" (a new version) or "approve."
5. **No automated frontend tests** — `@bebest/web` has no test runner
   configured for any screen in this codebase (checked: no `*.test.*`
   files anywhere under `apps/web/src`, no `test` script in
   `apps/web/package.json`), consistent with every other already-shipped
   `apps/web` epic (see Epic 9's and Epic 10's own frontend completion
   docs). Verified instead via `typecheck`/`lint`/`build`, all clean.

## Verification

- `turbo run typecheck --filter=@bebest/web` — clean.
- `turbo run lint --filter=@bebest/web` (`eslint .`) — clean.
- `turbo run build --filter=@bebest/web` (`next build`) — clean; route table
  includes the new `○ /content` (now real, not `ComingSoon`) and
  `ƒ /content/drafts/[id]` routes, none of the pre-existing routes
  regressed.
- `turbo run test --filter=@bebest/web` — no task configured (see "Known
  limitations" #5), consistent with the rest of this app.
- Every response shape (`ContentBrief`/`ContentDraft`/`ContentQualityCheck`/
  `ContentApproval` and each route's wrapper) manually traced against
  `apps/api/src/lib/content/serialize.ts` and the four route files
  (`content-brief-generate.ts`, `content-briefs.ts`,
  `content-brief-details.ts`, `content-drafts.ts`) directly, field-for-field
  — not guessed from `docs/epics/11-content-intelligence-generation-backend.md`'s
  prose summaries alone. Each quality check's `details` shape was likewise
  read from `apps/api/src/lib/content/quality-checks.ts`'s five result
  builders before writing `quality-check-list.tsx`'s per-`checkType`
  renderers.
- No database connection, no git command, and no real AI/external network
  call was made at any point building this half of the epic — every
  request this UI makes goes to `platform/apps/api`'s real routes; the AI
  provider call itself happens server-side, inside a route this frontend
  never bypasses.

## Files touched

New:
- `platform/apps/web/src/data/content/{types,labels,client}.ts`
- `platform/apps/web/src/components/content/{quality-check-list,brief-row,pending-draft-card,content-view,draft-approval-view}.tsx`
- `platform/apps/web/src/app/(app)/content/drafts/[id]/page.tsx`
- `platform/docs/epics/11-content-intelligence-generation-frontend.md` (this file)

Replaced (Epic-0-era placeholder, not extended — it had no real behavior to preserve):
- `platform/apps/web/src/app/(app)/content/page.tsx`

Extended (Epic 10's file, per the same "extend rather than duplicate"
precedent its own frontend completion doc documents — nothing else in the
file changed):
- `platform/apps/web/src/components/recommendations/next-action-panel.tsx`

Extended (one-line marker removal):
- `platform/apps/web/src/data/nav.ts`
