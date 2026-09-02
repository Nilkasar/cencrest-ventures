# Epic 3 — Website Intelligence (Crawler) (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect. Depends on Epic 2 (a `brand` with a `website` must exist to crawl).

## Why this epic

SEO Intelligence (Epic 4) and every technical-SEO opportunity downstream need real crawled data on the brand's own site (and, later, competitor sites). This is also the epic where the platform's most security-sensitive code path lives — a server making outbound HTTP requests to a URL a customer typed in — so it gets built once, carefully, per `docs/08-security/SECURITY.md`, rather than each future crawl-adjacent feature reinventing SSRF protection.

## Domain model (per `docs/05-architecture/ARCHITECTURE.md`'s "Website" schema group — not detailed in `SCHEMA.md`, define now)

- `crawl_jobs` — `id, organization_id, brand_id, root_url, status (queued|running|completed|failed), pages_crawled, pages_failed, started_at, completed_at, error`.
- `pages` — `id, crawl_job_id, organization_id, url, status_code, title, meta_description, h1, canonical_url, word_count, has_schema_markup, raw_html_hash (dedupe), crawled_at`.
- `page_issues` — `id, page_id, organization_id, issue_type (missing_title|duplicate_title|thin_content|broken_link|...), severity (low|medium|high), detail`.
- `sitemaps` — `id, brand_id, organization_id, url, url_count, last_fetched_at`.

## Non-negotiable: SSRF protection (`docs/08-security/SECURITY.md`)

Any URL a customer supplies (brand website, competitor website, sitemap URL) goes through a single `safeFetch()` utility before any request is made:
- Block RFC1918 private ranges, loopback, link-local/cloud-metadata (169.254.0.0/16), IPv6 private ranges, non-HTTP(S) schemes, internal hostnames (`localhost`, `*.internal`, `*.local`).
- Resolve DNS before the request, re-validate the resolved IP against the blocklist (DNS rebinding protection) — validating the hostname alone is not enough.
- This utility lives in `packages/database`-adjacent shared code or a new `packages/crawler-core` — either way, it must be the *only* code path that makes outbound requests from user-supplied URLs; no route handler calls `fetch()` on a customer URL directly.

## Crawl limits (`docs/08-security/SECURITY.md`)

Max crawl depth 3, max 500 pages per crawl, max 2 req/sec, respect `robots.txt`, reject pages >5MB, strip/sanitize all extracted HTML before storage (crawled content is untrusted input — never rendered unescaped, never treated as instructions if it later reaches an LLM in Epic 6+).

## API surface

- `POST /brands/:id/crawl` — kicks off a `crawl_job` (background job — see Epic 0's job/queue notes; if pg-boss isn't wired yet, a documented `setImmediate` placeholder is acceptable *only* with a `// TODO: replace with durable queue` marker, matching the honesty standard set in Epic 0).
- `GET /crawl-jobs/:id` — status/progress.
- `GET /brands/:id/pages` — paginated, filterable by issue severity.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 3 Step 4 ("Website analysis kicks off (background), 10–15 minutes, customer can leave") — a progress screen with real step-by-step status (not a generic spinner), then a page-issues list grouped by severity once complete. Empty state before first crawl: explain what will happen and let the user trigger it manually (don't force a wait for a scheduled trigger).

## Definition of done

Standard DoD. Security tests are the hard gate here specifically: SSRF test suite against private IPs, loopback, metadata endpoint (`169.254.169.254`), non-HTTP schemes, and a DNS-rebinding scenario — per `docs/19-testing/TESTING_STRATEGY.md`'s explicit security-test category. Since these tests need real network behavior, qa-flow-tester should verify the *logic* (the blocklist, the resolve-then-validate order) from code and flag the live-network cases as needing an integration run.
