# Epic 3 — Website Intelligence (Crawler) (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, `platform/apps/web`, or
the repo-root marketing site was modified.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run repeatedly (schema-only, against a dummy
`DATABASE_URL`). No `migrate`, `db push`, or `db pull` was run, per the hard
constraint.

**This build ran concurrently with another agent's Epic 5 (Intent & Query
Universe) work in the same repo.** Both landed schema additions and
`app.ts`/`client.ts`/`index.ts` edits in the same shared files at
overlapping times (their `0004_query_universe` migration folder landed
first, so this epic's is `0005_website_intelligence`). Every shared file
was re-read immediately before each edit and both sets of changes merged
cleanly — verified by re-running `prisma validate`, `tsc --noEmit`, and the
full test suite for both `@bebest/database` and `@bebest/api` after the
fact, not assumed.

---

## The gap between the epic spec and the ported schema (read this first — mirrors Epic 2's own opening section)

`crawl_jobs`, `pages`, and `page_issues` already existed in the ported
schema (Epic 0 added `organization_id` to all three — see
`@bebest/database`'s `DECISIONS.md` §1's affected-table list). The epic
spec's own text says this schema group is "not detailed in SCHEMA.md,
define now" — meaning the epic's literal field list, not whatever the
ported schema happened to already have, is the actual source of truth here
(same situation, and same resolution rule, as Epic 2's `brands.industries`
fix — see that epic's DECISIONS.md §15). On inspection, the ported tables
diverged from the spec's field list in several real ways, not just naming:

- **`crawl_jobs` had no `root_url` column at all.** This is a functional
  gap, not cosmetic — without it there is no durable record of which URL a
  job actually crawled (a later edit to `brands.website_url` would
  silently rewrite what an already-completed job claims to have crawled).
  Added as a required column, captured at job-creation time.
- **`crawl_jobs.status`** was `pending | running | completed | failed |
  cancelled`; the spec's literal list is `queued | running | completed |
  failed`. Renamed `pending` → `queued` to match the spec's word exactly;
  kept `cancelled` as an additive extra (a real state the pipeline needs
  somewhere to land for a future "cancel" action, not a spec deviation).
- **`crawl_jobs` had `pages_found` but no `pages_failed`**, and an
  `error_message` column where the spec says `error`. Added `pages_failed`;
  renamed `error_message` → `error`. Kept `pages_found` additively (total
  links discovered, independent of failure count — useful for progress-bar
  math, not a spec conflict).
- **`page_issues.severity`** was `critical | warning | info`; the spec's
  literal list is `low | medium | high`. Changed the enum's values outright
  to match.
- **`pages.canonical`** renamed to **`pages.canonical_url`** to match the
  spec's literal field name.
- **`pages` had no `raw_html_hash`** (the spec's explicit "dedupe" field).
  Added. **`pages.schema_types` (String[]) was kept instead of the spec's
  flat `has_schema_markup` boolean** — a boolean that only ever equals
  `schema_types.length > 0` would be a column that can drift from the
  truth it's supposed to summarize; the API serializer computes
  `hasSchemaMarkup` from the array instead, at read time, so it can never
  disagree with the data it's derived from.
- **`sitemaps` did not exist under any name.** Added as a new table.

All of this is written up field-by-field, with the reasoning per item, in
`packages/database/DECISIONS.md`'s new "Epic 3 (Website Intelligence)
schema additions" section (added by this build) and inline schema.prisma
comments at each changed field. Nothing here was applied to a database —
`prisma validate`/`generate` only, same rule as every prior epic.

**A second gap, more consequential: a frontend for this epic already
exists, built before this backend, against the OLD (pre-this-build) ported
schema's field names and enum values.** See "Frontend contract
reconciliation needed" below — this is the single most important thing for
whoever picks up the Epic 3 frontend-fix pass or the eventual qa-flow-tester
verification to read.

---

## What was built

### 1. Schema (`packages/database/prisma/schema.prisma`, `DECISIONS.md`)

- `crawl_jobs`, `pages`, `page_issues` — fixed forward per the gap list
  above (`root_url`, `pages_failed`, `error`, `canonical_url`,
  `raw_html_hash`, `crawl_status`/`issue_severity` enum value renames).
  `crawl_jobs` also gained a nullable `created_by` (who triggered the
  crawl — a human action, unlike every subsequent status transition, which
  the pipeline itself makes) with the standard `SetNull`-on-user-delete FK,
  matching `DECISIONS.md` §4's rule.
- `sitemaps` (new model) — `organization_id` + `brand_id` (both
  `Restrict`), `url`, `url_count`, `last_fetched_at`, unique on
  `(brand_id, url)` (an upsert-per-URL reference record, not an
  append-only history row per fetch — re-crawls refresh `last_fetched_at`
  in place rather than accumulating duplicate rows for the same sitemap
  URL). No `created_by`/`deleted_at` — discovered and refreshed by the
  crawler itself, not human-authored data; see the model's own comment
  block for the full reasoning, mirroring `DECISIONS.md` §4's "pipeline
  tables get no created_by" rule.
- New migration folder `prisma/migrations/0005_website_intelligence/`
  (0004 was already claimed by the concurrent Epic 5 agent when this build
  checked): `rls.sql` (the one new policy, for `sitemaps` —
  `crawl_jobs`/`pages`/`page_issues` already had theirs from 0000_init and
  none of this epic's field changes touch `organization_id`) and
  `indexes.sql` (one partial index, `idx_crawl_jobs_queue_pending`, mirroring
  `idx_background_jobs_queue_pending`'s pattern for "which jobs are waiting
  to run").
- `src/client.ts` / `src/index.ts` — added `crawl_jobs`, `pages`,
  `page_issues`, `sitemaps`, `crawl_status`, `issue_type`, `issue_severity`
  to the re-exported-types list, so `apps/api` never imports
  `@prisma/client` directly for these (same rule as every other table).

### 2. `safeFetch` — extended `apps/api/src/lib/ssrf-guard.ts`, not duplicated

Per the task brief's explicit instruction, `ssrf-guard.ts` (Epic 1's
write-boundary `isSafePublicHttpUrl`) was **extended in place**, not
forked into a second SSRF module. The file now has two layers, documented
in its own top comment:

- `isSafePublicHttpUrl` — unchanged, still Epic 1's write-boundary check.
- `safeFetch(url, options)` — the new request-time guard, and **the only
  function in the codebase allowed to make an outbound HTTP request to a
  customer-supplied URL.** Verified by grep (see "Verification performed"
  below) — no route or crawler file calls `fetch(` directly; the sole real
  `fetch` reference in the entire crawl code path is `ssrf-guard.ts`'s own
  `options.fetchImpl ?? fetch` default.

`safeFetch` enforces, in order, before any socket opens:

1. URL parses and is `http:`/`https:` only.
2. Hostname isn't `localhost`/`*.internal`/`*.local` (checked with zero DNS
   calls — a plain string check).
3. A literal IP in the hostname (IPv4 or bracketed IPv6) is checked
   directly against the blocklist, no DNS round-trip needed.
4. Otherwise, DNS is resolved (via an injectable `DnsResolver`, default
   `dns.promises.lookup(host, { all: true })`) and **every** returned
   address — not just the first — is checked against the blocklist. This
   is the actual DNS-rebinding close: a hostname that looks completely
   ordinary but resolves (even only sometimes, even only on one of several
   `A`/`AAAA` records) to a private/metadata address is rejected before a
   connection is attempted.
5. Redirects are followed manually (`redirect: 'manual'` on the underlying
   fetch) and **every hop re-runs steps 1–4** — a same-origin page that
   redirects off-site into a private address is blocked exactly like the
   original URL would have been. This closes the classic "SSRF via
   redirect" bypass that a guard checking only the caller-supplied URL
   would miss.
6. The response body is read via a capped streaming reader — `maxBytes`
   (default 5MB, per the spec) is enforced while reading, not just checked
   against a `Content-Length` header that could be absent or lying.
7. A request timeout (`AbortController`, default 15s) prevents a hung
   connection from stalling the whole crawl job.

The IP-range blocklist (`isBlockedIpAddress`) is hand-rolled (no new
dependency): full IPv4 CIDR matching for RFC1918 + loopback +
link-local/cloud-metadata (`169.254.169.254` explicitly covered by the
`/16` block) + the other IANA special-purpose ranges (carrier-grade NAT,
documentation/benchmark ranges, multicast, reserved/broadcast); IPv6
loopback/unique-local/link-local, **plus IPv4-mapped IPv6 unwrapping**
(`::ffff:127.0.0.1` is checked as `127.0.0.1`, closing a real, commonly
missed bypass).

**Documented residual gap** (not silently accepted — see `safeFetch`'s own
doc comment): after validating the resolved IP, the underlying fetch is
still made by hostname, not pinned to the exact validated address. A DNS
answer with a sub-second TTL could theoretically differ between the check
and the actual connect (TOCTOU). Fully closing that needs a custom
`http.Agent`/`undici` dispatcher with a pinned `lookup`, which sits below
the `FetchLike` abstraction the task's own testing constraint (inject
`fetchImpl`, no real network in this environment) is built around. Flagged
as a follow-up hardening item for whoever wires this against a real
network, not implemented here.

### 3. `lib/robots.ts` (new)

A minimal (not full RFC 9309) robots.txt parser: groups by `User-agent`,
longest-prefix-match between `Allow`/`Disallow` (ties favor `Allow`), and
collects `Sitemap:` directives. Deliberately not a dependency — parsing
untrusted text with a hand-rolled, small, auditable parser was judged safer
than pulling in a library for this. No wildcard (`*`/`$`) pattern support
inside paths; documented as a known limitation in the file's own header for
whoever extends it later.

### 4. `lib/html-extract.ts` (new) — extraction AND sanitization

`extractPageData(html, pageUrl)` pulls `title`, `meta description`, `h1`,
`canonical` (resolved to an absolute URL), `schema.org` types (both
`itemtype` microdata and `application/ld+json`, walked recursively for
every `@type`, tolerant of malformed JSON), `noindex` (from a `robots` meta
tag), image alt-text coverage, internal/external link counts, and a SHA-256
hash of the raw HTML (`raw_html_hash`).

**"Sanitize before storage" (the epic's explicit, security-relevant
requirement) is implemented as `sanitizeExtractedText`** — every text field
this module returns has HTML tags stripped, a small safe entity set
decoded, control characters removed, whitespace collapsed, and length
capped, BEFORE it is ever handed to the database layer. This matters
because crawled content is untrusted: a malicious page's `<title>` could
carry literal markup or (once this data feeds Epic 7+'s GEO/LLM pipeline)
text crafted to look like an instruction. The raw HTML string itself is
**never** persisted anywhere — only its hash.

Deliberately regex-based, not a real DOM parser — no `cheerio`/`jsdom`
dependency exists in `apps/api` today, and adding one was judged out of
scope for this pass. This is a known, documented limitation (see the
file's own header): adversarial/malformed HTML can defeat a regex
extractor in ways a real parser wouldn't. It does not weaken the security
posture (nothing here executes or stores raw HTML), only the extraction
*accuracy* on hostile input. Flagged as a "not done" item below.

### 5. `lib/crawler/engine.ts` (new) — the orchestrator

`runCrawlJob(jobId, organizationId, brandId, rootUrl, deps)` is the entire
crawl pipeline for one job:

- BFS over **same-origin links only** (a "Website Intelligence" audit of
  the customer's own site, not a general-purpose crawler — off-site links
  are counted as `external_links` but never followed; documented explicitly
  in the file's header, including why this doesn't weaken the SSRF story: a
  same-origin page can still redirect off-site into a private address, and
  `safeFetch`'s own redirect handling catches exactly that, exercised end
  to end in `engine.test.ts`).
- Enforces every crawl limit from the spec: max depth 3, max 500 pages, max
  2 req/sec (a simple interval-gate rate limiter, injectable `sleep` for
  tests), respects robots.txt (best-effort — a missing/unreachable
  robots.txt is treated as allow-all, standard crawler behavior), and
  relies on `safeFetch` for the size cap.
- **A single page's failure (SSRF-blocked, timed out, 4xx/5xx, oversized)
  never aborts the whole job** — it's counted in `pages_failed` and
  summarized in the job's `error` field. Only a failure to fetch the ROOT
  URL itself fails the entire job (there is nothing else to crawl).
- Writes progress **incrementally** — `pages_crawled`/`pages_found`/
  `pages_failed` are updated in the database after every processed URL, not
  once at the end, so `GET /crawl-jobs/:id` reflects real mid-run progress
  (the spec's explicit "not a single jump from 0% to 100%" UI requirement).
- Runs a cross-page `duplicate_title` pass after the BFS completes (needs
  every page's title, so it can only run once the crawl is done).
- Per-page issue detection: `missing_title`, `title_too_long`,
  `missing_meta`, `meta_too_long`, `missing_h1`, `missing_canonical`,
  `thin_content` (<300 words), `noindex`, `missing_alt`, `broken_link`
  (status ≥400), plus the cross-page `duplicate_title` pass above.
  `redirect_chain` (present in the `issue_type` enum) is not populated —
  see "Not done" below.
- Best-effort sitemap discovery (`refreshSitemaps`): checks robots.txt's
  `Sitemap:` directives first, falls back to `/sitemap.xml`, counts
  `<loc>` occurrences as a cheap proxy for `url_count` (no real XML
  parsing — same "no new dependency" call as the HTML extractor), and
  upserts into the new `sitemaps` table. Never fails the crawl job.
- Runs via `setImmediate` from the route handler, with an explicit
  `// TODO: replace with durable queue (pg-boss)` comment. **Checked
  first**: no `pg-boss`, `bullmq`, or any queue package is a dependency
  anywhere in this monorepo (`grep`-verified across every `package.json`),
  and no worker/dispatcher process consumes the existing `background_jobs`
  table either — so this is the same documented, honest placeholder Epic 0
  used, not a parallel invention.

### 6. Routes (new)

Mounted in `app.ts` following the exact established Epic 2/5 convention
("the" brand resolved from the org via `lib/brand-context.ts`, never a
`brandId` in the URL) — **one deliberate, documented deviation from the
spec's literal paths**, consistent with how Epic 5's routes already adapted
the same way:

- **`POST /api/brands/me/crawl`** (spec: `POST /brands/:id/crawl`).
  `requirePermission('create_brand_profile')` (same tier as every other
  brand-profile mutation). Resolves the brand, 404s via the shared
  `NO_BRAND_ERROR` if none, 422s if the brand has no `website_url` set,
  409s (naming the existing job id) if a crawl is already `queued`/
  `running` for this brand. **Creates the `crawl_jobs` row, synchronously,
  before scheduling anything** — the literal invariant the spec's
  end-to-end flow step 1 asks for, verified by a test that asserts call
  order (`db.create` before `runCrawlJob`). Writes a manual audit event
  (`crawl_job.created`). Schedules the background crawl via `setImmediate`;
  if the crawl throws unexpectedly, the job is marked `failed` with the
  error message rather than being silently stranded in `running`.
- **`GET /api/crawl-jobs/:id`** — matches the spec's literal path exactly (a
  `crawl_jobs` row is addressed by its own id, not a brand's).
  `requirePermission('view_intelligence')` (viewer+). Scoped by
  `organization_id` in the query itself (belt-and-suspenders alongside RLS,
  same pattern every other route here uses) — a foreign org's job id 404s,
  never leaking a 403 that would confirm the id exists. Returns a computed
  `progressPct` (100 once terminal, regardless of the raw counters).
- **`GET /api/brands/me/pages`** (spec: `GET /brands/:id/pages`). Paginated
  (`limit`/`offset`, capped at 100) and filterable by `severity`
  (`low|medium|high`, matching the fixed-forward enum). Defaults to the
  brand's **most recent** crawl job (current site state), not an
  ever-growing union of every historical crawl's pages — pass `crawlJobId`
  explicitly to inspect an older one. Returns `{ pages, pagination }`; each
  page includes its `page_issues` and a computed `hasSchemaMarkup`.

---

## Frontend contract reconciliation needed (read before wiring `apps/web` to this API)

**`platform/docs/epics/03-website-intelligence-frontend.md` already
exists** — a frontend was built for this epic before this backend, against
the schema as it existed at that time (pre-this-build), with its own
"Schema reconciliation" section explicitly addressed to "backend-architect:
read this before Epic 3's backend." Per that note and the Epic 2 precedent
this build follows (DECISIONS.md §15: when frontend and backend disagree,
check the actual spec text and fix whichever side deviates from it — not
just "match what already exists"), this build resolved every divergence
**toward the epic spec's literal text**, which means the frontend's types
are now the side that needs a follow-up pass, not this backend. Precise
list for whoever does that pass:

| Contract point | Frontend (`apps/web/src/data/website/types.ts`) expects | This backend's API actually returns |
|---|---|---|
| `CrawlJob.status` | `"pending" \| "running" \| "completed" \| "failed" \| "cancelled"` | `"queued" \| "running" \| "completed" \| "failed" \| "cancelled"` |
| `PageIssue.severity` | `"critical" \| "warning" \| "info"` | `"low" \| "medium" \| "high"` |
| `CrawlJob.errorMessage` | field name `errorMessage` | field name `error` |
| `Page.canonical` | field name `canonical` | field name `canonicalUrl` |
| `sitemaps` table | flagged as "checked — doesn't exist, not built here" | now exists (no route surfaces it directly yet — see "Not done") |
| Routes | calls a `localStorage` mock; documents the intended real calls as `POST /brands/:id/crawl`, `GET /crawl-jobs/:id`, `GET /brands/:id/pages` | actual paths are `POST /api/brands/me/crawl`, `GET /api/crawl-jobs/:id`, `GET /api/brands/me/pages` (see "Routes" above for why) |

Everything else in the frontend's `CrawlJob`/`Page` shape (camelCase field
names, `rootUrl`, `pagesCrawled`, `pagesFound`, `wordCount`, `loadMs`,
`internalLinks`/`externalLinks`, `schemaTypes`) already lines up with this
backend's serializers — `loadMs` in particular is now populated (see below)
specifically to close that gap, since the frontend's `Page` type already
expected it. This backend's job is `apps/api` only per this task's scope;
updating `apps/web`'s types/fixtures/client to match the table above is
explicitly left for the epic's frontend-reconciliation pass, not done here.

---

## Decisions worth flagging individually

- **`pages.load_ms` is now populated.** The ported column existed but
  nothing wrote to it. `crawler/engine.ts` times each request from
  immediately after the rate-limit wait (not including the wait itself) to
  the response, so `load_ms` reflects actual page load time, not
  queue-wait time.
- **`crawl_jobs`/`pages` route serializers include `updatedAt`** (the
  underlying `updated_at` column already existed) — a small, free
  alignment with the frontend's expected shape, added while doing the
  reconciliation pass above.
- **No entitlement/plan-limit check on triggering a crawl.** The epic spec
  doesn't call for one (unlike Epic 2's `competitors_tracked`), so none was
  invented — `lib/entitlements.ts`'s `PlanLimits` interface was left
  untouched. Instead, a narrower, genuinely load-bearing invariant was
  added: a 409 if a crawl is already `queued`/`running` for the brand,
  preventing concurrent crawls of the same site from being triggered twice.
- **`isSafePublicHttpUrl` (Epic 1's write-boundary guard) is untouched** —
  same behavior, same tests, same file, just documented differently at the
  top now that `safeFetch` lives alongside it. No existing caller's
  behavior changed.
- **`created_by` on `crawl_jobs`, none on `pages`/`page_issues`/
  `sitemaps`.** Matches `DECISIONS.md` §4's rule exactly: a human triggers
  a crawl (real attribution), but the pages/issues/sitemap rows a crawl
  produces are pipeline output with no human author — adding a
  `created_by` there would be either always-null or would lie about who
  "wrote" an extracted `<title>` tag.

---

## What was NOT done (honest gaps)

- **`redirect_chain` issue type is never populated.** The enum value
  exists (carried over from the ported schema) but nothing in
  `recordPageIssues` detects an actual redirect chain — `safeFetch`
  resolves redirects internally and returns only the final page, so the
  crawler currently has no visibility into how many hops it took. Tracking
  hop count through `safeFetch`'s return value and threading it into issue
  detection is a small, well-scoped follow-up, not done here for time.
- **No cancel-a-running-crawl endpoint.** The spec's API surface doesn't
  list one; `cancelled` exists in the `crawl_status` enum only because it's
  a real value inherited from the ported schema (kept as a placeholder for
  when that action is built, per the frontend doc's identical note).
- **`sitemaps` has no dedicated read route.** The table is populated by the
  crawl engine but nothing exposes it over the API yet — the epic's UI
  surface section never describes a sitemap-facing screen, so nothing
  currently needs it read back. A `GET /brands/me/sitemaps` route would be
  a small addition once something wants to display it.
- **HTML extraction is regex-based, not a real DOM parser** (see
  `html-extract.ts`'s own section above) — a known accuracy limitation on
  adversarial/malformed markup, not a security gap.
- **DNS-rebinding TOCTOU is narrowed, not fully closed** (see `safeFetch`'s
  own section above) — resolve-then-validate happens correctly, but the
  actual connection is still made by hostname rather than pinned to the
  validated IP. Full closure needs a custom connection-layer dispatcher
  below the injectable-fetch abstraction this task's testing constraints
  are built around.
- **Per-request DB writes, not batched.** Each crawled page triggers up to
  three separate `withOrgContext` calls (create page, create issues, update
  job progress) — correct, but at 500 pages this is up to ~1500 database
  round-trips per crawl. Acceptable for v1 (matches every other route's
  simple per-operation style in this codebase) but worth batching if crawl
  volume becomes a real load concern.
- **The `setImmediate` placeholder's known failure mode**: a process crash
  or restart between a job going `queued`→`running` and its completion
  leaves that job stuck in `running` forever, with no retry — the same
  honest gap Epic 0 documented for `background_jobs`. A real queue
  (pg-boss, per the task brief's own suggestion) with a heartbeat/retry is
  the fix; not built here since no queue package exists anywhere in the
  monorepo yet.
- **Frontend reconciliation itself** — see the dedicated section above.
  Not done as part of this task (`apps/api`/`packages/database` only), but
  written up precisely enough that it's a checklist, not a rediscovery,
  for whoever does it.

## Live-DB-only gaps

- **Tenant isolation** — a new `describe.skip('Epic 3 tenant isolation —
  crawl_jobs / pages / page_issues / sitemaps (NEEDS LIVE DB)', ...)` block
  was added to `routes/tenant-isolation.integration.test.ts`, following the
  exact convention every prior epic used in that file. All scenarios are
  `it.todo` pending a real Postgres instance with `0000_init` through
  `0005_website_intelligence`'s `rls.sql`/`checks.sql`/`indexes.sql`
  applied, per that file's own header.
- **The SSRF logic itself was fully verified without a live DB or live
  network** — `lib/safe-fetch.test.ts`'s 25 tests inject both `fetchImpl`
  and a `DnsResolver` (mirroring `@bebest/ai-provider`'s `FetchLike`
  pattern per the task brief), covering: RFC1918 ranges, loopback, the
  literal `169.254.169.254` metadata address, non-HTTP schemes, internal
  hostname suffixes, a genuine DNS-rebinding scenario (hostname resolves to
  a private IP), a multi-address rebinding scenario (any one of several
  resolved IPs being private is enough to block), SSRF-via-redirect, the
  IPv4-mapped-IPv6 bypass, redirect-loop exhaustion, streamed size-cap
  enforcement, and request timeout. `crawler/engine.test.ts`'s fixture-site
  test additionally proves the same-origin-redirect-to-private-IP scenario
  end to end through the real crawl loop (a discovered link redirects
  off-site into a blocked address; the job records one `pages_failed` entry
  and completes normally rather than crashing). Per the epic's own DoD
  text, these are the *logic* tests it asks for; a live-network integration
  run against a real DNS resolver and a real (or intentionally
  misconfigured) target host is the remaining, explicitly out-of-scope-here
  step.
- **No migration was applied.** Same rule as every prior epic —
  `prisma validate`/`generate` only.

---

## Verification performed

- `packages/database`: `prisma validate` and `prisma generate` (dummy
  `DATABASE_URL`, schema-only) — clean. `tsc --noEmit` — clean.
  `vitest run` — 7/7 passing (`src/client.test.ts`, unchanged by this
  build).
- `apps/api`: `tsc --noEmit` — clean. `eslint src --ext .ts` — clean.
  `tsc -p tsconfig.build.json` (the real build script) — clean.
  `vitest run` — **278 passing, 38 todo (the new Epic 3 tenant-isolation
  block), 0 failing**, across 32 test files including every pre-existing
  epic's suite (confirms this build didn't regress Epic 0/1/2/5's work
  landing concurrently in shared files).
- New test files: `lib/safe-fetch.test.ts` (25 tests), `lib/robots.test.ts`
  (7), `lib/html-extract.test.ts` (13), `lib/crawler/engine.test.ts` (5,
  including the fixture-site walk, root-URL-failure, max-depth, max-pages,
  and robots.txt-disallow scenarios), `routes/crawl.test.ts` (6),
  `routes/crawl-jobs.test.ts` (3), `routes/pages.test.ts` (8).
- `grep`-verified: no direct `fetch(` call exists anywhere in the crawl
  code path (`lib/crawler/`, `lib/robots.ts`, `lib/html-extract.ts`,
  `routes/crawl*.ts`, `routes/pages.ts`) outside `ssrf-guard.ts`'s own
  `options.fetchImpl ?? fetch` default — the literal "grep for it, don't
  just trust the one call site you wrote" instruction from the task brief.
- Turbo pipeline: `npx turbo run typecheck lint test build
  --filter=@bebest/database --filter=@bebest/api` — 7/7 tasks successful.
- No git commands were run at any point. Branch `rebuild/platform` was
  never left. All writes were under `platform/`.
