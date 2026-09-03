# Epic 17 — Free Snapshot (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Nothing under `api/`,
`web-app/`, the repo-root marketing site, or `packages/database` was
touched — the backend (routes, orchestrator, schema) was already built and
verified by the backend agent's pass. Branch `rebuild/platform`. No git
commands were run at any point (not even read-only ones). No database
connection was made and no real network call to any AI provider, email
provider, or external site was made anywhere in this build — the only
network calls this frontend makes are to `platform/apps/api`'s own real
`POST /snapshot` / `GET /snapshot/:token` routes, which are themselves
mock-everything-external per the backend's own build.

## What was built

A new, unauthenticated `(marketing)` route group in `apps/web` — distinct
from `(app)` (behind a session), `(auth)` (the sign-in flow), and
`(onboarding)` (post-signup) — since a prospect can land on `/snapshot`
having never heard of BeBest and has no org/session context at all.

**`platform/apps/web/src/app/(marketing)/`**:

- `layout.tsx` — plain top bar (logo + "Sign in" escape hatch) and a
  one-line footer, never the authenticated `components/shell` app chrome,
  which assumes a logged-in org this visitor doesn't have.
- `snapshot/page.tsx` — the intake page. Server component (so `metadata`
  can export a real title/description) wrapping `SnapshotIntakeView`.
- `snapshot/[token]/page.tsx` — the public tokenized report page. Awaits
  Next's async `params`, hands the plain token string down, same
  server-page/client-view split `crm/leads/[id]/page.tsx` already
  establishes.

**`platform/apps/web/src/data/snapshot/`** — the data-access seam, same
role as every other epic's `client.ts` (e.g. `data/billing/client.ts`),
but the one client module in the app whose routes have no session/cookie
behind them at all:

- `types.ts` — wire shapes matching `apps/api/src/lib/free-snapshot/report.ts`'s
  `FreeSnapshotReport` (and `routes/snapshot.ts`'s request/response shapes)
  field-for-field, checked directly against that source file, not just the
  backend completion doc's prose. `SnapshotStatusResponse` is a discriminated
  union on `status` (`pending`/`processing`/`failed`/`complete`) so callers
  get real narrowing instead of an all-optional blob.
- `client.ts` — `submitFreeSnapshot()` (`POST /snapshot`, called through
  `apiClient` from `src/lib/api-client.ts` from the first line, no fixture
  layer as source of truth) and `getSnapshotReport()` (`GET /snapshot/:token`).
  Three typed errors: `SnapshotRateLimitedError` (429 — the documented 1/hour/IP
  guard, surfaced with the specific retry-after wait rather than a generic
  failure), `SnapshotValidationError` (422 — carries the zod issues, e.g. the
  SSRF-guard rejection on `website`), `SnapshotNotFoundError` (404 on the
  report GET — deliberately generic copy, matching the backend's own
  "don't leak enumerable IDs" stance).

**`platform/apps/web/src/hooks/use-snapshot-report.ts`** — polls
`GET /snapshot/:token` every 4s while `status` is `pending`/`processing`
(coarser than `use-crawl-job.ts`/`use-ai-run.ts`'s 1-2s: this pipeline runs
four other epics' engines in sequence for an anonymous, rate-limited
visitor, so a slower interval is kinder to the endpoint without a
noticeably slower reveal). Six-state result type: `loading` / `preparing`
/ `not-found` / `failed` / `error` / `ready`, so the view layer never
guesses which fields are populated.

**`platform/apps/web/src/components/snapshot/`**:

- `snapshot-intake-view.tsx` — page-level state machine: renders the form,
  swaps to the confirmation screen in place on success (no navigation, so
  the one-time report token from the 202 response is never lost to a page
  transition).
- `snapshot-intake-form.tsx` — the exact field list from
  `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 2 / the spec: name, work email,
  company, website, optional industry/category, optional biggest
  competitor. Client-side validation only checks what the server will
  cheaply re-reject anyway (required fields, email shape, URL shape via
  the same `normalizeUrl` the authenticated competitor-website field
  already uses) — the real SSRF/DNS-resolving guard
  (`isSafePublicHttpUrl`) is deliberately server-only and never duplicated
  client-side. On submit, calls `submitFreeSnapshot` directly.
- `snapshot-confirmation.tsx` — the spec's literal copy, rendered from
  `response.message` (the backend's own `CONFIRMATION_MESSAGE` constant),
  never re-typed. Links to the report page using the one-time token, since
  this environment's `ConsoleEmailSender` has no real inbox for a visitor
  to check.
- `snapshot-preparing-panel.tsx` — the report page's non-terminal state: an
  honest single spinner with a static outline of what the orchestrator is
  doing (crawl → AI queries → SEO pass → scoring), not a fake progress bar
  claiming per-step precision the anonymous, job-row-less pipeline can't
  report (documented in the backend's own `orchestrator.ts`).
- `snapshot-report-page-view.tsx` — the client half of the report route;
  switches on `useSnapshotReport`'s five non-ready states plus the ready
  report render.
- `snapshot-report-view.tsx` — the actual report: AI Visibility Score card
  (overall + mention/recommendation/position/coverage sub-scores, formula
  version, provider badges), SEO Health card (technical/content scores,
  pages analyzed), a competitor-mention comparison bar chart, top-3 AI
  gaps, top-3 SEO gaps, top-3 recommended priorities, and a CTA card
  ("book a call or sign up") — every field read straight off the real
  `FreeSnapshotReport` object with no re-derivation, using the SAME
  category/severity/provider label lookups (`QUERY_CATEGORY_META`,
  `CHECK_SEVERITY_BADGE_VARIANT`, `providerLabel`) the authenticated Query
  Universe / SEO Intelligence / AI Visibility screens already use, imported
  directly rather than redeclared. The backend's own `simplificationNote`
  (documenting the lightweight, non-Epic-9/10 scoring heuristic) is
  rendered verbatim at the bottom of the report, never hidden from the
  visitor.

## Verification

Ran at the `@bebest/web` package level (no `test` script exists for this
app — it has no test infra, matching every other frontend-only epic's
verification story):

- `pnpm --filter @bebest/web typecheck` — clean, 0 errors.
- `pnpm --filter @bebest/web lint` — clean, 0 warnings/errors.
- `pnpm --filter @bebest/web build` (`next build`, Turbopack) — compiles,
  typechecks, and prerenders successfully. Route output confirms `/snapshot`
  as a static page and `/snapshot/[token]` as a dynamic (`ƒ`) server-rendered
  route, alongside every pre-existing route with no regressions.

Cross-checked every wire type against the actual backend source (not the
backend completion doc's prose): `snapshot_requests` schema fields
(`token_hash`, `status`, `result_json`) in `packages/database/prisma/schema.prisma`,
and `FreeSnapshotReport`'s exact shape in
`apps/api/src/lib/free-snapshot/report.ts` — both match the frontend types
field-for-field, no reshaping needed at the client boundary.

## End-to-end flow, traced from the frontend

1. A visitor lands on `/snapshot` (no session, no org) and fills in the
   intake form. Client-side validation runs first (cheap, instant); on
   pass, `submitFreeSnapshot` calls `POST /api/snapshot` directly through
   `apiClient` — no fixture layer anywhere in the path.
2. A 429 (already sent one this hour, from this IP) surfaces as
   `SnapshotRateLimitedError`'s specific "try again in about N minute(s)"
   message inline in the form, not a generic failure banner — this is the
   single most important error this form can distinguish, per the epic's
   own framing of this endpoint as the highest-abuse-risk in the system.
3. A 422 (e.g. the SSRF guard rejected the website URL as non-public)
   surfaces as `SnapshotValidationError`'s server-provided message.
4. On success (202), `SnapshotIntakeView` swaps in
   `SnapshotConfirmation` with the backend's literal "Your snapshot is
   being prepared. We'll email you within 24 hours." copy and a link to
   `/snapshot/:token` built from the one-time token in the response — the
   lead already exists server-side at this point, before any of the
   crawl/query/AI/SEO pipeline has run.
5. Following that link (or a real emailed one, in production), the report
   page polls `GET /snapshot/:token` every 4s. While `pending`/`processing`,
   `SnapshotPreparingPanel` shows the backend's own status message plus a
   static step outline; nothing is faked as complete early.
6. Once `status: "complete"`, `SnapshotReportView` renders the real
   computed report — AI Visibility Score, SEO health, competitor mentions,
   top gaps, top priorities — sourced entirely from `result_json`, the
   exact object `lib/free-snapshot/report.ts` built from the real
   crawl/AI-run/SEO-checklist computations already verified in Epics 3/4/5/7.
7. If the pipeline failed server-side, the report page shows the backend's
   generic "we hit a problem, please resubmit" message — no internal error
   detail leaked to an unauthenticated visitor, matching the backend's own
   deliberate omission of `result_json.error` from that response.
8. An invalid or expired token renders a typed "this snapshot link isn't
   valid" empty state (`SnapshotNotFoundError`), distinct from a transient
   network `error` state, which offers a retry instead.
9. The CTA card at the bottom of a completed report links to `/login`
   ("Sign up") — the handoff `docs/epics/17-free-snapshot.md`'s "UI
   surface" section calls for ("book a call or sign up"), left as a plain
   link since the actual booking-CTA integration is Epic 20's
   marketing-site scope, not this one's.

## What's not done (by design, matches the backend's own scope boundary)

- No real email is sent or received in this environment (`ConsoleEmailSender`)
  — the confirmation screen's report link is a deliberate stand-in for
  "click the link the real email would contain," documented inline in
  `snapshot-confirmation.tsx`, not a claim that email delivery was tested
  end-to-end here.
- No per-step progress signal on the preparing panel — the anonymous
  pipeline has no persisted job rows to poll a real percentage from (the
  backend's own architectural call, documented in `orchestrator.ts`), so
  the panel is honestly a single spinner with static context rather than a
  fabricated progress bar.
- The eventual repo-root marketing-site integration (embedding this flow
  outside `apps/web`) is explicitly Epic 20's scope, not this one's, per
  the spec's own "UI surface" section.

## Files touched

- `platform/apps/web/src/app/(marketing)/layout.tsx` (new)
- `platform/apps/web/src/app/(marketing)/snapshot/page.tsx` (new)
- `platform/apps/web/src/app/(marketing)/snapshot/[token]/page.tsx` (new)
- `platform/apps/web/src/data/snapshot/types.ts` (new)
- `platform/apps/web/src/data/snapshot/client.ts` (new)
- `platform/apps/web/src/hooks/use-snapshot-report.ts` (new)
- `platform/apps/web/src/components/snapshot/snapshot-intake-view.tsx` (new)
- `platform/apps/web/src/components/snapshot/snapshot-intake-form.tsx` (new)
- `platform/apps/web/src/components/snapshot/snapshot-confirmation.tsx` (new)
- `platform/apps/web/src/components/snapshot/snapshot-preparing-panel.tsx` (new)
- `platform/apps/web/src/components/snapshot/snapshot-report-page-view.tsx` (new)
- `platform/apps/web/src/components/snapshot/snapshot-report-view.tsx` (new)
- `platform/docs/epics/17-free-snapshot-frontend.md` (this file)
