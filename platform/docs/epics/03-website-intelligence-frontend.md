# Epic 3 — Website Intelligence (Crawler) (frontend half)

Status: built, verified locally (typecheck + lint + production build all
pass for `@bebest/web`; `next start` smoke-tested the new route plus a few
neighbors at 200). No backend exists for this epic yet — the Prisma schema
for it is already ported (`crawl_jobs`/`pages`/`page_issues`, see "Schema
reconciliation" below), but there is no `apps/api` route to call, so
everything here reads/writes through a `localStorage`-backed mock that
mirrors the shape a real `apiClient` call will take, per the brief ("no
live backend, use typed fixtures ... wired through `src/lib/api-client.ts`'s
pattern" — same instinct as Epic 2's original onboarding wizard).

Scope: the Epic 3 UI surface
(`docs/epics/03-website-intelligence.md` §"UI surface") — an empty state
before the first crawl that explains what will happen and triggers one
manually, a progress screen with real step-by-step status while it runs,
and a page-issues list grouped by severity once it's done — plus a new
"Website Intelligence" nav destination to reach it from, and a crawl-history
view so a re-crawl doesn't feel like it silently discards the last one.

## What was built

### Route — `/website-intelligence`

`apps/web/src/app/(app)/website-intelligence/page.tsx`, added to the
"Intelligence" nav group in `src/data/nav.ts` (before "SEO Intelligence,"
since Epic 4 consumes this epic's crawl data — `docs/epics/04-seo-intelligence.md`
depends on pages/issues existing). No `epic:` tag on the nav item, matching
how CRM's items are un-tagged — this is real, working UI for the epic
actually being delivered, not a placeholder pointing at a future one.

### `src/components/website/` — the screen's own component set

One `WebsiteIntelligenceView` orchestrator, five focused pieces below it,
each handling exactly one state the epic's UI surface calls out:

- **`crawl-empty-state.tsx`** — before the first crawl. Names the real
  limits from the epic's own "Crawl limits" section (depth 3, 500-page cap,
  robots.txt, 2 req/sec) instead of a vague "we'll analyze your site," and
  the button is a real trigger (`useCrawlJob`'s `start()`), not a stub
  toast — this is the epic actually shipping, not a forward reference to
  one that hasn't.
- **`crawl-progress-panel.tsx`** — the real step-by-step status the epic's
  UI surface explicitly asks for ("not a generic spinner"): a vertical
  timeline of six named steps (queued → validating → discovering →
  crawling → analyzing → finalizing), each with its own description of
  what's actually happening. The active "fetching pages" step shows a live
  `142 of ~236 pages fetched` counter, a progress bar, and the URL just
  fetched — not just a percentage.
- **`crawl-failed-panel.tsx`** — a crawl that stopped partway (epic's
  end-to-end flow step 3: "the job records a clear per-page error rather
  than crashing the whole job"). Names what happened and how far it got;
  "Start a new crawl" retries. Pages fetched before the failure are still
  rendered as real partial results by `PageIssuesList` below this panel,
  not hidden.
- **`page-issues-list.tsx`** — the page-issues list grouped by severity.
  Three stat tiles (critical/warning/info counts) plus a severity-tab
  filter that doubles as the spec's "filterable by issue severity," a
  "Load N more" button standing in for real pagination (see "What's
  stubbed" below), and a real empty state ("No issues found — this crawl
  came back clean") when a filter or a genuinely clean crawl has zero rows.
- **`crawl-history.tsx`** — every past crawl for the brand, not just the
  latest, with a "View results" action per completed/failed row. This is
  what makes the epic's end-to-end flow step 5 ("re-crawl the same site ...
  a new `crawl_jobs` row is created, history preserved") an actual,
  clickable behavior instead of a doc claim: starting a new crawl doesn't
  remove the previous one from this list, and its issues stay viewable.

`WebsiteIntelligenceView` ties these together purely from `useCrawlJob`'s
state (`loading | error | empty | ready`) plus a `viewingJobId` the history
table can override — clicking an older row shows that crawl's issues with a
"Back to latest" link, without losing the live progress/failed panel for
whatever the *latest* job is actually doing.

### Data layer — `src/data/website/{types,fixtures,client}.ts`

Follows `data/crm/{types,fixtures,client}.ts`'s established shape (a
per-domain folder, not one flat file) rather than Epic 2's original
single-file `onboarding-client.ts`, since this domain has three related
entities (jobs/pages/issues) the way CRM has four (leads/deals/accounts/
activities).

- **`types.ts`** — `CrawlJob`, `Page`, `PageIssue`, plus two UI-only types
  the schema doesn't have: `CrawlStep`/`CrawlProgress` (the synthesized
  step-by-step view — see "Progress simulation" below).
- **`fixtures.ts`** — a single self-contained `crawlBrand` fixture (tied to
  `currentOrganization` from the root fixtures, not to
  `useBrandProfile`/`onboarding-client`, which now call the *real* Epic 2
  API and would have nothing to answer them here — see "Why not read the
  real brand profile" below); the six-step crawl schedule; a deterministic
  page/issue generator (`generateCrawlResults`) built from a 24-path URL
  catalog and modulo rules (page 11 is always missing a meta description,
  page 23 is always missing a title, etc.) — pure functions of a page
  index, no `Math.random()`, so a given job id always produces the same
  result on reload instead of a different one each time.
- **`client.ts`** — the seam. Every exported function's doc comment shows
  the one-line `apiClient` call it becomes once `POST /brands/:id/crawl`,
  `GET /crawl-jobs/:id`, and `GET /brands/:id/pages` exist. Persists to
  `localStorage["bebest.website-crawls.v1.<brandId>"]`.

### `src/hooks/use-crawl-job.ts`

Loads the latest job, then polls `getCrawlProgress` once a second for as
long as it's `pending`/`running` — the client-side mirror of polling a real
status endpoint — and stops the moment a job goes terminal. Exposes
`start()` (loading state kept separate from the initial "does a job already
exist" check, so the empty state's button doesn't flash the whole screen
back to a skeleton) and `reload()` for the error state's retry.

## Progress simulation: honest about the compression

The epic's own UI surface note quotes `CUSTOMER_JOURNEY.md` Stage 3 Step 4:
a full crawl is "10–15 minutes, customer can leave." Actually waiting 10–15
real minutes would make this screen unreviewable, so `fixtures.ts`'s
`CRAWL_STEP_SCHEDULE` compresses the whole job to **~26 seconds** of
wall-clock time — long enough that the step-by-step progression is visibly
real (a page reload mid-crawl reconstructs the *same* step and page count
it would've shown without the reload, because it's a pure function of
`Date.now() - job.startedAt` against the fixed schedule, not a `setInterval`
mutating in-memory state), short enough to actually watch finish. This is
flagged here rather than silently presented as "10 minutes" — the real
backend replaces the elapsed-time derivation in `computeElapsedState` with
actual progress from the job queue; the six named steps and their
descriptions are what should survive that swap unchanged.

**Simulated failure** — append `?bbDemoError=1` before clicking "Start a
crawl" (same convention as `data/crm/client.ts`'s `bbDemoError`) to see the
failed-job path: the crawl behaves normally through discovery, then halts
132 pages into the 236-page crawl with a message naming an SSRF-guard
rejection (a redirect resolving to a private IP), and the 132 pages already
fetched remain visible as partial results. One simplification flagged
explicitly: the real crawler (per the epic's own text) is expected to
record a per-page error and keep going past it, not halt the whole job —
this fixture halts the job outright to keep the demo timeline to one
outcome rather than modeling N independent per-page failure modes. The flag
is captured once, at `startCrawl` time, so removing it mid-crawl doesn't
change an already-started job's outcome.

## Why not read the real brand profile

Epic 2's frontend was later rewired (`docs/epics/02-brand-intelligence-frontend.md`'s
"post-verification fixes" section) to call the real `apps/api` brand
endpoints instead of a `localStorage` mock. This epic has no live backend
running in this environment, so depending on `useBrandProfile` here would
mean every state in this screen is actually "the Epic 2 API call failed" —
not a useful demonstration of Epic 3's own states. `crawlBrand` in
`data/website/fixtures.ts` is a small, self-contained stand-in (same
`organizationId` as the shell's `currentOrganization`, so the tenant story
stays consistent) rather than a real integration. Wiring this screen to a
brand the user actually onboarded is a small change once both this epic's
and Epic 2's backends are live at the same time — swap `crawlBrand.id` for
the real brand id from `useBrandProfile`.

## Schema reconciliation (backend-architect: read this before Epic 3's backend)

Unlike Epic 2, this epic's Prisma schema is already ported
(`packages/database/prisma/schema.prisma`'s "WEBSITE INTELLIGENCE
(crawler)" section) — so this frontend was built against the **real**
schema, not the spec prose, wherever they disagree:

- **`crawl_jobs.status`** is `pending | running | completed | failed |
  cancelled` in the schema (`crawl_status` enum). The spec's own prose says
  `queued | running | completed | failed`. Followed the schema; the UI
  still *displays* "Queued" for `pending` (`STATUS_LABEL` in
  `fixtures.ts`) — the stored enum value and the customer-facing word don't
  have to match.
- **`page_issues.severity`** is `critical | warning | info`
  (`issue_severity` enum) in the schema, not the spec prose's
  `low | medium | high`. Followed the schema.
- **No `sitemaps` table exists** in the ported schema, though the spec's
  domain model section lists one (`sitemaps — id, brand_id,
  organization_id, url, url_count, last_fetched_at`). Checked
  `packages/database/DECISIONS.md` for any note about this being dropped
  deliberately — none exists, so this looks like an actual gap rather than
  an intentional cut. Not built here, for the same reason Epic 2's frontend
  didn't build an `entities` onboarding step for a table its own UI surface
  never mentioned: the epic's UI surface section (crawl progress + issues
  list + empty state) never describes a sitemap-facing screen either way,
  so there's nothing this frontend needs from that table regardless of
  whether the backend adds it. Flagging it here rather than silently
  dropping it from the domain model.
- **`page_issues.severity` is a per-row column, not fixed per
  `issue_type`** in the schema (two `missing_title` rows could technically
  have different severities). This frontend's fixture generator uses a
  fixed `SEVERITY_BY_ISSUE_TYPE` map instead (a `missing_title` finding is
  always "critical") — a deliberate simplification for fixture data, not a
  claim about how the real analyzer should work; flagged in
  `data/website/fixtures.ts`'s own comment on that map.
- **`pages`/`page_issues` have no `word_count`-based `thin_content_flag` or
  severity precomputed on the row** — those live on the separate
  `content_analyses` model (Epic 11's territory per the schema comments
  near it), not on `pages` itself. This frontend's `Page` type matches
  `pages`' actual columns only (`word_count`, `schema_types`, etc.), not
  `content_analyses`'.

## What's stubbed vs. real

**Real**: every loading/error/empty state is a genuine code path (the
corrupted-`localStorage`-JSON failure mode throws a real, catchable error
with a real retry path — same honesty standard as `onboarding-client.ts`'s
version of this — not a simulated one); the step-by-step progress is
derived from actual elapsed time against a fixed schedule, not a fake
timer that always looks the same regardless of when you check; a crawl
started, then abandoned via a page reload, resumes exactly where it should
be by elapsed time when you come back; crawl history is never overwritten
by a re-crawl; the severity filter and "Load more" pagination genuinely
slice a real (fixture) dataset rather than always rendering everything.

**Stubbed (explicitly)**: there is no backend — `client.ts`'s header
comment says so, and every exported function is written to be a near
drop-in for a real `apiClient` call. The crawl timeline is compressed from
"minutes" to ~26 seconds (see "Progress simulation" above). The simulated
failure always halts the whole job rather than modeling independent
per-page failures. `getPageIssues`'s pagination is real *within* the
fixture layer (a `page`/`pageSize` param, a real `total`), but there is
obviously no server round trip behind it. RBAC (who can trigger a crawl vs.
just view results) is not enforced client-side — no real session/role to
check yet, same gap Epic 2's frontend flagged for the same reason. No
"cancel a running crawl" action — the epic's API surface doesn't list a
cancel endpoint, so none was invented; `cancelled` exists in the type only
because it's a real value in the schema's `crawl_status` enum.

## Verification performed

- `pnpm --filter @bebest/web typecheck` — clean.
- `pnpm --filter @bebest/web lint` — clean.
- `pnpm --filter @bebest/web build` — succeeds; all 27 routes prerender,
  including the new `/website-intelligence` (static).
- `next start` + `curl` smoke test — `/website-intelligence`, `/overview`,
  `/seo-intelligence`, `/query-universe`, and `/settings` all return 200.

Not done (no browser tooling available in this session, same gap Epic 0's
and Epic 2's frontend docs both flagged): a visual/screenshot pass in an
actual browser, a dark-mode spot check, and a manual click-through of the
full crawl → progress → completion → history → re-crawl loop (traced by
reading the code and the derivation math in `client.ts`, not by watching it
run for 26 seconds in a browser).

## Files touched

New:
- `apps/web/src/app/(app)/website-intelligence/page.tsx`
- `apps/web/src/components/website/{crawl-empty-state,crawl-progress-panel,crawl-failed-panel,page-issues-list,crawl-history,website-intelligence-view}.tsx`
- `apps/web/src/data/website/{types,fixtures,client}.ts`
- `apps/web/src/hooks/use-crawl-job.ts`

Edited:
- `apps/web/src/data/nav.ts` (added the "Website Intelligence" nav item and
  its `Globe` icon import — re-read immediately before editing since this
  is a shared file another epic's agent had already touched this session,
  adding "Query Universe"; merged alongside it rather than overwriting)
