# Epic 19 — Production Hardening (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) and `platform/packages/ui`
(`@bebest/ui`). Branch `rebuild/platform`. Nothing under `apps/api`,
`packages/database`, `api/`, `web-app/`, or the repo-root marketing site
was touched. Per the epic spec's own split
(`docs/epics/19-production-hardening.md`'s "UI surface"), this is a
cross-cutting audit-and-fix pass over the app shell and every screen built
since Epic 0 — not a new feature, and not a rebuild of anything already
covered by `docs/epics/19-production-hardening-backend.md`.

Three items, matching the epic spec's UI surface exactly:

1. Error-boundary quality — a broken request must never produce a blank
   screen or an unhandled promise rejection anywhere in the app.
2. Pagination controls — every list view added since Epic 0 needs real
   paging in the UI, not an unbounded fetch to a backend that now enforces
   a page-size cap (backend item 6).
3. Wire the new `GET /brands/me/crawl-jobs` endpoint (backend item 5),
   replacing Epic 3's `localStorage` pointer-list workaround.

---

## Item 1 — Error-boundary quality audit

**Found.** Zero `error.tsx`, zero `global-error.tsx`, zero `not-found.tsx`
existed anywhere in `apps/web/src/app` — confirmed by an exhaustive
`find`/`Glob` over the tree, not sampled. Every one of the 39 routes across
all four route groups (`(app)`, `(auth)`, `(marketing)`, `(onboarding)`)
plus the root segment had no error boundary at all: an unhandled render
error anywhere in that tree would have produced React's default "blank
white screen + console-only stack trace," not a fallback UI. This matches
the epic spec's framing exactly — it's the one item this epic's own UI
surface names as the reason to run this audit at all.

**Fixed.** A shared `RouteError` component
(`apps/web/src/components/patterns/route-error.tsx`) is the one real
fallback every boundary in the app renders — built once so N screens don't
each get a copy-pasted version. It:

- Renders a real heading, a real (non-generic-for-generic's-sake) message,
  a `digest` reference when the server provided one, a "Try again" button
  wired to Next 16.3's `retry()` prop (re-renders the boundary's children
  in place, no full navigation), and a "go back" link scoped to whichever
  route group it's in.
- Logs a structured, JSON-shaped `console.error` line — the same
  `{level, ...}` convention `apps/api`'s request logger and its new
  `ErrorTracker` interface use server-side
  (`19-production-hardening-backend.md` item 3). No client-side tracking
  SDK (e.g. `@sentry/nextjs`) is wired up — see "What's not done" below for
  why that's an honest, separate gap, not silently skipped.
- Moves focus to its own heading on mount (`tabIndex={-1}` + a ref), so a
  screen-reader or keyboard user lands on the error state instead of
  wherever focus happened to be when the crash occurred — WCAG 2.1 AA
  focus-management, not just a visual fallback.

A matching `RouteNotFound` component
(`apps/web/src/components/patterns/route-not-found.tsx`) is the shared
404 body.

**Boundaries added**, one per route group (Next.js's `error.js`/
`not-found.js` file convention cascades a boundary down to every nested
page/layout below it automatically — a per-page file per screen would have
been redundant, not more thorough):

| File | Covers | "Go back" target |
|---|---|---|
| `app/(app)/error.tsx` | Every authenticated screen (Overview, AI Visibility, SEO Intelligence, Competitors, Opportunities, Actions, Content, Reports, Agents, CRM, Query Universe, Settings, Website Intelligence, Agency) | `/overview` |
| `app/(app)/not-found.tsx` | Any unmatched in-app URL | `/overview` |
| `app/(auth)/error.tsx` | `/login`, `/login/check-email`, magic-link verify | `/login` |
| `app/(marketing)/error.tsx` | `/snapshot`, `/snapshot/[token]` (public lead capture — the highest-traffic unauthenticated surface) | `/snapshot` |
| `app/(onboarding)/error.tsx` | The onboarding wizard (industry → brand basics → claims → competitors → use-cases → done) | `/overview` (mirrors the layout's own "Exit") |
| `app/error.tsx` | The root segment (`app/page.tsx`'s redirect to `/overview`) and anything not caught by a more specific group boundary above | `/overview` |
| `app/global-error.tsx` | A crash inside the root layout itself — the one case that escapes every boundary above (`error.js` never wraps the `layout.js` in its own segment, only ones nested below it) | full reload to `/overview` |
| `app/not-found.tsx` | Any URL outside every route group (a signed-out visitor's stale/mistyped link) | `/login` |

`(app)/error.tsx` deliberately wraps `(app)/layout.tsx`'s **children**
only, not `AppShell` itself (Next's own file convention: "`error.js` does
not wrap the `layout.js` above it in the same segment") — so a broken
screen still leaves the sidebar/topbar navigation usable, and only the
content area is replaced. One honest consequence of that same rule,
documented in `app/error.tsx`'s own header comment: a render error inside
`AppShell`/`Sidebar`/`Topbar` itself (not its `children`) would skip
`(app)/error.tsx` and fall through to the root `app/error.tsx`, losing the
app-shell chrome for that one case — an inherent Next.js boundary-nesting
property, not a gap this pass left open.

`global-error.tsx` needed special handling: per Next's own docs, it
replaces the root layout entirely and does **not** receive this app's
global stylesheet or fonts. Its inline styles are a hand-picked,
self-contained subset of `@bebest/ui`'s real light/dark token values
(`packages/ui/src/styles/tokens.css`) — checked against that file, not
guessed — so a root-layout crash still roughly matches the app's actual
palette (and the viewer's OS dark/light preference) instead of a jarring,
unbranded default.

**Verified.** `pnpm --filter @bebest/web build` (production build,
Turbopack) compiles every route cleanly with all eight boundary files in
place; `/_not-found` appears in the route manifest, confirming Next picked
up the root `not-found.tsx`.

---

## Item 2 — Pagination controls audit

**Audited every list view the parent task named**, checking each list's
real backend contract (not assumed) before deciding whether a UI fix was
possible: leads, deals, brands/accounts, competitors, keywords, query
sets, crawl jobs, opportunities, recommendations, content drafts, actions,
measurements, reports, notifications.

### Fixed — real server-paginated lists that had no way to reach page 2

Built one reusable `Pagination` component
(`packages/ui/src/components/pagination.tsx`, exported from `@bebest/ui`)
— real Prev/Next controls against a `{ total, limit, offset }` response
(the convention every already-real list endpoint in this codebase
returns), reusing `Button`'s existing focus-visible/disabled styling
rather than a one-off pattern. Renders nothing when everything already
fits on one page, so a small org's screen never grows a dead control.
Wired into every list that (a) hits a real, capped backend endpoint and
(b) already returns real `limit`/`offset`/`total` — i.e. every gap a
frontend-only pass could actually close:

- **Opportunities** (`components/opportunities/opportunities-view.tsx`) —
  was a fixed `limit: 100` fetch with no way to reach anything past the
  first 100, despite `GET /brands/me/opportunities` already supporting
  `offset`. Now pages at 25/page; every server-side filter (status/type/
  priority) resets to page 1 on change.
- **SEO Opportunities panel**
  (`components/seo/opportunities-panel.tsx`) — the SEO-intelligence
  screen's own `seo_opportunities` list (a different table/route than the
  one above), same fixed-`limit`-no-paging gap. Now pages at 25/page.
- **Recommendations** (`components/recommendations/recommendations-view.tsx`)
  — had a "Show 10/25/50" selector but nothing past whichever size was
  selected. That selector is now a real page-size control paired with
  real Prev/Next.
- **Reports** (`components/reports/reports-view.tsx`) — fixed `limit: 50`,
  no paging. Now pages at 25/page.
- **Crawl jobs** — see item 3 below; same component, same treatment, as
  part of wiring the new endpoint.

### Reviewed — real technical ceilings, not fixable from the frontend alone

Every one of these hits an endpoint whose response is a **flat array**
with no `limit`/`offset` query params accepted and no `total` returned —
confirmed by reading the actual route handler in `apps/api/src/routes/`,
not assumed from the frontend. Building real Prev/Next controls against
these is structurally impossible without a backend response-shape change,
which is outside a frontend-only pass and outside what
`19-production-hardening-backend.md` scoped (it added a `take: 100`
technical ceiling to each of these as part of its own item 6, explicitly
framed as a safety ceiling rather than real pagination — the same
"documented, not invented" precedent that doc's own
`query-sets.ts`/`5000`-row exception sets):

- **Actions** (`GET /brands/me/actions`) — all four status-bucketed
  sections (pending/in-progress/completed/rolled-back), each capped at
  100, newest-first, no offset param, no counts. The Action Center
  ("What have I done and what happened?") is exactly the kind of screen
  that accumulates real history over an account's lifetime, so this is a
  genuine, real ceiling worth flagging as follow-up work, not a
  false-alarm.
- **Agent runs** (`GET /brands/me/agents`), **AI-visibility runs**
  (`GET /brands/me/ai-runs`), **competitor AI runs**
  (`GET /brands/me/competitors/:id/ai-runs`) — same shape, same 100 cap,
  no offset/total.
- **Agency clients** (`GET /agency/clients`,
  `GET /agency/clients/incoming`) — same shape; bounded in practice by how
  many client orgs one agency realistically manages, lower real-world risk
  than Actions/AI-runs.
- **Keyword groups** (`GET /brands/me/seo/keyword-groups`) — same shape;
  bounded in practice (one brand rarely has more than a handful of
  keyword groups).
- **Content briefs/drafts** (`components/content/content-view.tsx`) —
  `GET /brands/me/content-briefs` DOES return real `{ total, limit,
  offset }` (unlike the list above), but this screen's "Awaiting approval"
  tab needs a cross-brief scan (which briefs have a `"generated"` draft) —
  there is no bulk "all drafts across every brief" endpoint (the file's
  own header comment already names this), so the fetch is a full,
  100-capped scan the "Active briefs"/"Awaiting approval" tabs both
  derive from. Splitting that into a properly-paginated "Active briefs"
  list while keeping the cross-brief "Awaiting approval" derivation
  correct is a real restructuring, not a contained UI fix — left
  unchanged and documented here rather than done partially/riskily in
  this pass. In practice brief counts are small (one per approved
  content-type recommendation, a deliberate human action each time), the
  same "not a performance risk in practice" reasoning the file's own
  comment already gives.
- **Query sets** (`GET /brands/me/query-sets`) — bounded by real
  cardinality (draft + active + a handful of archived per brand); not a
  practical risk.
- **A query set's queries** (`GET /brands/me/query-sets/:id/queries`) —
  this is `19-production-hardening-backend.md` item 6's own named,
  deliberate exception (`take: 5000`, flat array, "real fix needs a
  coordinated frontend change... tracked as follow-up work, not invented
  here"). Confirmed still true from this side: the response has no
  `limit`/`offset`/`total` to build real paging against. Not touched here,
  per that doc's own framing.

### Reviewed — not a pagination gap

- **Notifications** (`components/shell/notification-bell.tsx`) — a
  dropdown tray (`max-h-[420px] overflow-y-auto`, fixed at 50 most-recent
  items), the same bounded-recent-tray pattern any bell/notification
  center uses (Slack, Gmail) rather than a full list view. There is no
  separate "all notifications" page for this pattern to be wrong for.
  Reviewed, no fix needed.
- **Measurements** (`data/measurement/client.ts`'s `listBrandMeasurements`)
  — already supports real `limit`/`offset`, but has zero UI consumers
  anywhere in the app today. No standalone "Measurements" screen exists
  (measurement data surfaces as per-action evidence, not its own list) —
  nothing renders this unbounded, so there is no gap to fix. Noted here so
  it isn't mistaken for an oversight.
- **Leads / Deals / Accounts (CRM)** — `data/crm/client.ts` is still the
  local, in-memory fixture layer Epic 1's own frontend completion doc
  describes (`docs/epics/01-crm-frontend.md`: "fixture sets are small
  enough (11/10/4)... a real API wire-up should add [pagination]") —
  real `leads.ts`/`deals.ts`/`accounts.ts` routes exist in `apps/api`, but
  the web app was never wired to call them; that's Epic 1's own
  already-tracked, already-documented gap, not one of Epic 19's 7 named
  backend items. Wiring the real API is a separate, materially larger
  undertaking (auth-scoped request shapes, response mapping, mutation
  semantics) than adding pagination controls to an already-real list —
  doing it inside this audit-and-fix pass would be exactly the kind of
  scope creep the epic spec explicitly rules out ("do not invent hardening
  work not already flagged"). Left as-is, documented here rather than
  silently skipped.
- **Competitors** (`GET /brands/me/competitors`) — flat array, no
  offset/total, but bounded by realistic competitor-tracking cardinality
  (a brand's entitlement caps how many competitors it can track at all).
  Reviewed, low real-world risk, same category the backend audit used for
  similarly-shaped small lists.

---

## Item 3 — Wire the new crawl-jobs endpoint

**Confirmed the real response shape first**, per this project's standing
rule to read the actual backend change rather than assume it: read
`apps/api/src/routes/crawl-jobs.ts`'s `crawlJobsListRoute` directly —
`GET /brands/me/crawl-jobs`, query params `status?`/`limit` (1–100,
default 25)/`offset`, response `{ crawlJobs: [...], pagination: { total,
limit, offset } }`, tenant-scoped, newest-first, 404 with no brand
profile — matching `GET /brands/me/pages`'s exact established convention.

**Fixed.** `data/website/client.ts` rewritten:

- All `localStorage` pointer-list machinery removed entirely
  (`TRACKED_JOBS_PREFIX`, `MAX_TRACKED_JOBS`, `hasLocalStorage`,
  `readTrackedJobIds`/`writeTrackedJobIds`, `recordJobId`/`forgetJobId`) —
  no client storage of any kind is used for crawl history any more.
- `listCrawlJobs(params?: { status?, limit?, offset? })` now calls the
  real endpoint directly and returns `{ crawlJobs, pagination }`.
- `getLatestCrawlJob()` is now a thin `listCrawlJobs({ limit: 1 })`
  wrapper — the "does a job already exist" check the progress screen
  makes on load.
- `startCrawl()` dropped its now-unused `organizationId` parameter (it
  existed only to call `recordJobId`).
- `use-crawl-job.ts` and `website-intelligence-view.tsx` updated to match
  — the hook still takes `organizationId` (used for its own effect-reset
  semantics when an org switches), but no longer threads it through to
  the removed pointer-list calls.

**Real pagination added to the crawl-history table** — the underlying
gap this endpoint closes is exactly a pagination gap (a browser/device
that never crawled couldn't see history at all; now it always can, for
every past crawl, not just the last 20 a browser happened to remember).
`website-intelligence-view.tsx` pages the history table at 10/page using
the same `Pagination` component as every other fixed list above.

A different device or a cleared browser now sees the exact same crawl
history as any other device on the same org — the gap
`19-production-hardening-backend.md` item 5 named
("`localStorage`... losing this list... loses the history view") is
closed, not just narrowed.

---

## Verification

- `pnpm --filter @bebest/web typecheck` (`tsc --noEmit`) — clean.
- `pnpm --filter @bebest/web lint` (`eslint .`) — clean, 0 problems (one
  `@next/next/no-location-assign-relative-destination` warning surfaced on
  `global-error.tsx`'s forced full-reload button; resolved with a targeted,
  reasoned `eslint-disable-next-line` — a `useRouter().push()` can't be
  trusted after the root layout's own providers just crashed, so a real
  reload is the correct choice there, not a lint violation to work around
  blindly).
- `pnpm --filter @bebest/ui typecheck` / `lint` — clean (the new
  `Pagination` component).
- `pnpm --filter @bebest/web build` (production build, Turbopack) —
  compiles successfully, all 31 routes generate, `/_not-found` present in
  the manifest.
- No test suite exists for `@bebest/web` (`package.json` has no `test`
  script) — nothing to run beyond the above; consistent with how prior
  frontend-half epics in this codebase verify.

## Files touched

**New:**
- `packages/ui/src/components/pagination.tsx` (+ export in `src/index.ts`)
- `apps/web/src/components/patterns/route-error.tsx`
- `apps/web/src/components/patterns/route-not-found.tsx`
- `apps/web/src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`
- `apps/web/src/app/(app)/error.tsx`, `(app)/not-found.tsx`
- `apps/web/src/app/(auth)/error.tsx`
- `apps/web/src/app/(marketing)/error.tsx`
- `apps/web/src/app/(onboarding)/error.tsx`

**Modified:**
- `apps/web/src/data/website/client.ts` — `localStorage` pointer-list
  removed; `listCrawlJobs`/`getLatestCrawlJob`/`startCrawl` now call the
  real `GET /brands/me/crawl-jobs`.
- `apps/web/src/hooks/use-crawl-job.ts` — updated call sites for the
  above.
- `apps/web/src/components/website/website-intelligence-view.tsx` — real
  pagination on the crawl-history table.
- `apps/web/src/components/opportunities/opportunities-view.tsx`,
  `apps/web/src/components/seo/opportunities-panel.tsx`,
  `apps/web/src/components/recommendations/recommendations-view.tsx`,
  `apps/web/src/components/reports/reports-view.tsx` — real pagination
  controls, replacing fixed-limit fetches.

## What's not done (honest scope boundary)

- **No client-side error-tracking SDK is wired into the new error
  boundaries.** `RouteError`/`global-error.tsx` log a structured
  `console.error` (the same shape `apps/api`'s `ErrorTracker` interface
  uses server-side) as the default, but there is no `@sentry/nextjs` (or
  equivalent) dependency in this app and none was added — that would be a
  new package + real DSN this build environment shouldn't fabricate,
  matching every other epic's `NullXProvider` discipline (build the
  console default correctly now, wire the real SDK when there's a real
  account to wire it to). The epic spec's own item 3 names this as part of
  "apps/web's error boundaries" alongside the backend's `onError` wiring;
  the backend half is done (`ErrorTracker`/`SentryErrorTracker`, never
  connected), the frontend default-console half is done here, and the
  actual SDK connection remains explicitly open on both sides.
- **Actions, agent runs, AI-visibility runs, competitor AI runs, agency
  clients, and keyword groups cannot get real pagination controls without
  a backend response-shape change** (accepting `limit`/`offset`, returning
  `total`) — see item 2's "Reviewed — real technical ceilings" above for
  the specific reasoning per endpoint. Not fixed here because it isn't
  fixable here; flagged as real follow-up work for whoever picks up a
  coordinated backend+frontend pass, not silently left unmentioned.
- **Content briefs/drafts** — the "Active briefs"/"Awaiting approval" tabs
  share one 100-capped, cross-brief fetch with no bulk pending-drafts
  endpoint to split cleanly against; real pagination here needs either a
  new backend endpoint or a careful restructuring of that join, neither of
  which this pass attempted. See item 2 for the full reasoning.
- **CRM (leads/deals/accounts) is still fixture-backed, not wired to the
  real `apps/api` routes that already exist for it** — Epic 1's own
  already-tracked, already-documented gap (`docs/epics/01-crm-frontend.md`),
  unrelated to any of Epic 19's 7 named backend items. Not attempted here;
  wiring it is a materially larger, separate undertaking than this
  pagination-and-error-boundary pass, and doing it now would be scope
  creep this epic's spec explicitly rules out.
- **A render error inside `AppShell`/`Sidebar`/`Topbar` itself** (not
  their `children`) skips `(app)/error.tsx` and falls through to the root
  `app/error.tsx`, losing the app-shell chrome for that one case — an
  inherent property of how Next.js nests `error.js` boundaries (never
  wraps the same-segment `layout.js`), not a gap this pass left open.
