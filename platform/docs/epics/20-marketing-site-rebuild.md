# Epic 20 — Marketing Site Rebuild (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect (one new public route), and whichever agent builds the root-level HTML/CSS/JS. Depends on Epic 1 (CRM — leads table, `apply_form`/`free_snapshot` source enum, already built), Epic 17 (Free AI + SEO Snapshot — the real public snapshot flow, VERIFIED). Scheduled last among product epics per `platform/EPICS.md`'s own sequencing note: the site's claims should describe a platform that actually exists by the time this epic runs.

## Why this epic

`platform/EPICS.md` describes this epic as "Root site rebuilt clean on top of the finished platform." Two things make that non-trivial rather than cosmetic:

1. **TD-001 / D-O10 / `docs/08-security/SECURITY.md`'s own HIGH risk entry ("Apply form has no backend — data lost")** — every lead-capture form on the live site (`index.html`'s `#apply` section, `contact.html`) currently does `event.preventDefault()` and shows a fake success message. No data is captured anywhere. This has been true since before the platform rebuild started and remains true today — it is the single most important gap this epic closes.
2. **The root site has already drifted from its own documented spec.** The root `CLAUDE.md` (checked into this repo) describes a Cencrest-branded, 11-section, single-`index.html` site with hardcoded `$24,000` / `$65,000` / `$12,000/mo` pricing. The site actually deployed today is BeBest-branded (`bebestwithai.com`), spans 15 HTML pages (`index.html`, `about.html`, `services.html`, `pricing.html`, `contact.html`, `blog.html`, `resources.html`, `ai-visibility-snapshot.html`, `ai-visibility-audit.html`, `ai-recommendation-strategy.html`, `privacy-policy.html`, `terms.html`, `cookie-policy.html`, `design-bible.html`, plus `sitemap.xml`/`robots.txt`), and has already replaced every hardcoded price with `FREE` / `GET IN TOUCH` / `MONTHLY RETAINER` — correctly anticipating `docs/16-billing/BILLING_ARCHITECTURE.md`'s "prices are UNDECIDED, never hardcode a price" rule before that rule was ever written down for this repo. **Decision: this epic targets the site as it actually exists today (BeBest brand, current page set, current no-hardcoded-price copy), not the stale root `CLAUDE.md`.** Updating root `CLAUDE.md` to match reality is part of this epic's Definition of Done — a checked-in spec that contradicts the deployed product is itself a defect.

This epic does **not** redesign the site. It makes four specific, previously-fake things real: the apply/contact forms, the free-snapshot CTAs, one CORS bug blocking both, and the domain-name inconsistency between the marketing site and the API.

## Scope

**In scope:**
- `index.html`, `contact.html`, and any other root HTML file with a lead-capture form (currently: `index.html#apply`, `contact.html`) — wire to a real backend.
- `index.html#hero` / `#provocation` CTAs, and any "Get Free Snapshot" button across the other root pages (`services.html`, `pricing.html`, `ai-visibility-snapshot.html`) — point at the real Epic 17 flow.
- `index.html#chorus` and `index.html#index` — add honest labeling (no schema/engine change).
- One new small public route in `platform/apps/api` (below).
- A one-line CORS fix in `platform/apps/api/src/app.ts`.
- Root `CLAUDE.md` — update to match the live site (brand, page list, pricing copy) so it stops being stale documentation.

**Explicitly out of scope (do not touch):**
- `platform/apps/web` (the authenticated customer portal) and its already-built `(marketing)/snapshot` and `(marketing)/snapshot/[token]` routes — link to them, do not modify them.
- `api/` and `web-app/` at the repo root — the old pre-rebuild implementation, untouched reference material per `platform/EPICS.md`'s header note.
- TD-002 (error tracking), TD-003 (analytics), TD-004 (duplicated HTML across pages), TD-006 (CSP/security headers on the marketing site itself), TD-007/TD-008 (canvas motion/a11y), TD-009 (hardcoded demo data in visualizations), TD-011 (monolithic CSS), TD-012 (image optimization) — every one of these is either already explicitly deferred to a later phase per `TECHNICAL_DEBT.md`, or is a design/perf pass unrelated to "making the site's claims true," which is this epic's actual charter. Do not fold them in.
- Any new database table or schema change — this epic reuses the `leads` table and its existing `lead_source` enum (`free_snapshot | apply_form | direct | referral`) exactly as Epic 1 already built it. No migration.

## Decision: what `#apply` actually is, and what links to the real Snapshot flow instead

This is the load-bearing decision of this epic. Three things currently disagree with each other:

- Root `CLAUDE.md` (stale): `#apply` is an **application form for the paid $24k–$65k engagements**.
- The live `index.html#apply` copy (as actually deployed today): *"Get a free AI Visibility Snapshot... complete the form below"* — i.e. it has been repurposed to *be* the free snapshot request, but its fields don't match one (no Website URL field at all, which `POST /snapshot` requires).
- `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 2 / `PRODUCT_VISION.md`: the free snapshot is a specific, already-built, five-field flow (name, work email, company, website URL, category optional, biggest competitor optional) that creates a lead, runs a real scoped-down pipeline (crawl + sample AI queries + SEO pass), and emails a tokenized report link — this is Epic 17, **VERIFIED and live** at `app.bebestwithai.com/snapshot`.

Resolution — **split the two intents rather than collapsing them into one form**, because they are genuinely different funnel stages with different backends:

1. **"Get a free snapshot" is never reimplemented on the marketing site.** Every such CTA (`#hero`, `#provocation`, `pricing.html`, `ai-visibility-snapshot.html`, the `#apply` section's secondary link) becomes a plain link to `https://app.bebestwithai.com/snapshot`, the real, already-built, already-verified intake form. Reasons: (a) Epic 17's flow is asynchronous (submit → background pipeline → email → tokenized report page) — that state machine already exists correctly in `apps/web` and reimplementing even a piece of it in vanilla JS on the root site risks silently drifting from the real one; (b) it is the *only* implementation of this flow anywhere in the system, so duplicating its form fields on the root site without duplicating its orchestration would just create a second, broken on-ramp to the same feature.
2. **`#apply` (bottom of `index.html`) and `contact.html`'s form become "talk to us about an engagement"** — the original `CLAUDE.md` intent, restored and made real. Fields: name, work email, company name, industry/category (optional), and a free-text field for competitors/what they want to talk about (already present as `#app-notes`/`contact.html`'s equivalent field). No website-URL field, no crawl, no AI pipeline — this lead is explicitly sales-intent, not snapshot-intent. Rewrite the section's copy to stop claiming it delivers a snapshot (it currently, incorrectly, does) — e.g. *"Tell us about your brand and we'll get back to you within 24 hours to scope an Audit or Monitoring engagement."* — with the free-snapshot link placed as an explicit, separate secondary CTA immediately above it for visitors who actually want the free option first.
3. This is exactly the distinction `DECISIONS.md`'s D-O10 and `docs/08-security/SECURITY.md`'s risk register both point at without spelling out: an apply-for-a-paid-engagement lead does not need to trigger a crawl/AI pipeline, and forcing it through `POST /snapshot` would be both semantically wrong (these visitors are not asking for a snapshot) and operationally wrong (it would fire real AI-provider calls and a real crawl for a lead that never asked for one).

## New backend surface: `POST /api/apply`

A new, minimal, public route in `platform/apps/api` — reuses the `leads` table and its existing `apply_form` enum value (already present in `packages/database/prisma/schema.prisma` and already exercised in `routes/accounts.test.ts`; no migration). Model this directly on `routes/snapshot.ts`'s shape, minus every step that only makes sense for a snapshot (no `snapshot_requests` row, no token, no orchestrated pipeline, no report page) — this is closer to `routes/leads.ts`'s `createLeadSchema` than to `routes/snapshot.ts`.

- **`POST /api/apply`** — public, unauthenticated, rate-limited. Body: `name` (required), `email` (required, work email), `company` (required), `category` (optional), `notes` (optional, free text — competitors / what they want to talk about). No `website` field (this is deliberate — see decision above; do not add crawl-triggering fields here).
  - Validation: same Zod-with-explicit-schema discipline as `leads.ts`/`snapshot.ts` — reject with `422` and issue list on failure, never a silent 200.
  - Creates one `leads` row: `source: 'apply_form'`, `organization_id: getInternalOrgId()` (same internal-org pattern `leads.ts`/`snapshot.ts` already use), `status` default (`new`).
  - No crawl, no query generation, no AI provider calls, no email pipeline — this route does exactly one write and returns. (A future epic may add an internal "new apply-form lead" notification to BeBest's own ops — out of scope here; the lead is visible in the existing CRM leads list immediately via `GET /api/leads?source=apply_form`, which Epic 1 already built.)
  - Response: `201` with a confirmation message, matching the copy already shown in the current fake-success handlers: *"Request received. The BeBest team will be in touch within 24 hours."*
- **Rate limiting**: a new named bucket, not the existing `freeSnapshotRateLimit` (that one is calibrated for a route that fires a real crawl + AI-provider calls; this route does neither and doesn't need `1/hour`) and not left on the blanket `publicRateLimit` alone (`30/min` is too loose for a lead-capture form that a bot could use to spam the CRM). Compose one the same way `rate-limit.ts`'s own comment invites ("compose a custom one with `rateLimit({...})` for anything else"): `applyFormRateLimit = rateLimit({ bucket: 'apply_form', max: 5, windowSeconds: 60 * 60 })` — 5 submissions/hour/IP, applied before the handler body runs, same ordering discipline as `freeSnapshotRateLimit` in `snapshot.ts`.
- **No SSRF concern** — this route never accepts or fetches a URL server-side (that's exactly why the website field was dropped), so `isSafePublicHttpUrl`/`safeFetch` don't apply here, unlike `leads.ts`/`snapshot.ts`.
- **CSRF/spam**: no CAPTCHA infra exists in this repo; add a honeypot field (a hidden input real users never fill, bots often do — reject silently with the same `201` confirmation copy if it's non-empty, so a bot can't distinguish "spam-filtered" from "accepted") as the only anti-spam measure, consistent with this epic's "small, clean addition" charter — do not introduce a new CAPTCHA dependency for this pass.

## Non-negotiable: fix the CORS domain mismatch before wiring anything

`platform/apps/api/src/app.ts`'s production CORS allowlist is currently:
```
['https://app.bebestwith.ai', 'https://bebestwith.ai', 'https://www.bebestwith.ai']
```
This is a **different domain** (`bebestwith.ai`) from the one the marketing site is actually deployed and canonicalized under everywhere (`bebestwithai.com` — see every `<link rel="canonical">`, `og:url`, and JSON-LD `@id` in `index.html`/`contact.html`/etc., and `docs/05-architecture/ARCHITECTURE.md`'s own `bebestwithai.com` / `app.bebestwithai.com` split). As written, any client-side `fetch()` from the real, deployed marketing site to the API is silently CORS-rejected in production — this would make the new `/api/apply` route (and any client-side call the marketing site makes) appear to work in local dev (`NODE_ENV !== 'production'` allows `*`) and then fail invisibly the moment it's deployed. **Fix the allowlist to the real domain (`https://bebestwithai.com`, `https://www.bebestwithai.com`, `https://app.bebestwithai.com`) as part of this epic** — a one-line change, but a hard blocker for everything else here.

## `#chorus` and `#index`: honest labeling, not new engines

- **`#chorus` (TD-010)** — the 4-model response grid is static, pre-written, typewriter-animated text; it is not fetching real AI responses. Building a live-demo-query feature here is explicitly out of scope (TD-010 itself defers this to "Phase 3... use real responses from BeBest's own product dogfooding," which is a content-curation task — picking and pasting real `ai_responses` rows Epic 7 already produces — not a new engineering build). **Decision: add an explicit small label** (e.g. "Illustrative example") to the section so it stops silently implying it's a live query, without changing its mechanics. This is the cheapest honest fix available and matches this epic's charter of making existing structure accurate, not rebuilding it.
- **`#index` ("Public research index")** — three static placeholder article cards (also duplicated verbatim in `blog.html`), non-interactive (no `href`), with fabricated specific dates. No epic anywhere produces this content: Epic 15 (Reporting & Notifications, `SPEC READY`, not built) is customer-facing digest/notification infrastructure, not a BeBest-authored blog CMS; Epic 11 (Content Intelligence & Generation, `VERIFIED`) drafts content *for customers' own brands* from their opportunity data, not BeBest's own thought-leadership articles; Epic 13's `published_content` table records what a *customer* published through the platform, not BeBest's own marketing content. **Decision: explicitly out of scope, stays placeholder** — this needs a content/CMS epic that does not exist yet, not an engineering fix. The one concrete, cheap fix that *is* in scope: make the three cards real `<a>` links to `blog.html` (an existing real page) instead of dead non-interactive `<div>`s, and add the same "Illustrative example" labeling `#chorus` gets, since presenting fabricated dated articles as real published research without labeling is a credibility risk this epic can close for the cost of a CSS class and a caption.

## API surface

- `POST /api/apply` (new, this epic) — public, rate-limited (`apply_form` bucket, 5/hour/IP), creates a `leads` row with `source: 'apply_form'`. No other new routes.
- Consumes (does not modify): `POST /snapshot` / `GET /snapshot/:token` (Epic 17) — the marketing site only *links* to `app.bebestwithai.com/snapshot`, it never calls these routes directly.

## UI surface

Root site only (`index.html` + the other existing root HTML pages). No new pages are required by this epic — every page that needs a form or a snapshot CTA already exists.

- `index.html#hero`, `#provocation` — "Get Free Snapshot" CTAs become real `<a href="https://app.bebestwithai.com/snapshot">` links (currently: unclear/placeholder per the section, verify at build time and fix if they're dead or `#`-anchored).
- `index.html#chorus` — add "Illustrative example" label, no mechanical change.
- `index.html#apply` — rewritten copy (stop claiming it *is* the snapshot), fields trimmed to name/email/company/category/notes, wired to `POST /api/apply` via `fetch()` with real client-side error handling (a failed submit must show a real error, not the current always-succeeds `alert()`), plus a separate, explicit secondary link to `app.bebestwithai.com/snapshot` for snapshot-intent visitors.
- `index.html#index` — three cards become real links to `blog.html`, get the same illustrative-example labeling.
- `contact.html`'s form — same treatment as `#apply`: wired to `POST /api/apply` (same sales-intent lead, `source: apply_form`), real error handling replacing the current always-succeeds fake message.
- `services.html`, `pricing.html`, `ai-visibility-snapshot.html` — any "Free Snapshot" CTA on these pages gets the same `app.bebestwithai.com/snapshot` link treatment as `#hero`/`#provocation`.
- Root `CLAUDE.md` — rewritten to describe the actually-deployed site (BeBest brand, `bebestwithai.com`, current page list, current non-hardcoded pricing copy, the new `POST /api/apply` wiring) instead of the stale Cencrest/$-figure version.

## End-to-end flow (qa-flow-tester must trace every step below, not just each piece in isolation)

1. Visit `index.html`, click a "Get Free Snapshot" CTA (`#hero` or `#provocation`) → confirm it navigates to `https://app.bebestwithai.com/snapshot` (Epic 17's real, already-verified intake form) and not to a dead anchor, a `#`, or a reimplemented local form.
2. Submit the `#apply` form with valid data → confirm a real network request hits `POST /api/apply` (not a local `alert()`/innerHTML swap), confirm a `leads` row is created with `source: 'apply_form'`, the correct `organization_id` (internal BeBest org, same pattern as `leads.ts`), and `status: 'new'`.
3. Confirm the new lead is visible via the existing, unmodified `GET /api/leads?source=apply_form` (Epic 1) — no separate list surface was built for this, by design.
4. Submit `#apply` (or `contact.html`'s form) a 6th time within an hour from the same IP → confirm `429` with `Retry-After`, and confirm the 5 prior submissions all succeeded before the limit engaged (boundary check, not just "it eventually blocks").
5. Submit with the honeypot field filled → confirm a `leads` row is NOT created, and confirm the response is still the same `201`-shaped confirmation copy (a bot must not be able to distinguish "silently dropped" from "accepted").
6. Submit with an invalid email → confirm `422` with a real validation error, and confirm the client-side form surfaces it (not a silent failure or the old always-succeeds message).
7. From a real deployed-origin request (`Origin: https://bebestwithai.com`, not `localhost`) → confirm the request is NOT rejected by CORS (this is the concrete regression test for the domain-mismatch fix above — write it against the actual production CORS config, not against dev's permissive `*`).
8. Confirm `#chorus` and `#index` render their "Illustrative example" labeling, and that `#index`'s three cards are real, working links to `blog.html`.
9. Confirm root `CLAUDE.md` no longer describes the Cencrest brand, the stale file list, or the `$24k/$65k/$12k` figures, and instead matches the deployed site exactly (spot-check every claim in it against the live HTML).

## Definition of done

Standard DoD. `POST /api/apply` has a passing test suite covering: success (lead created with correct `source`), validation failure (`422`), rate-limit boundary (5 succeed, 6th `429`), honeypot silent-drop, and a CORS regression test asserting the real production origin is allowed. The CORS domain fix is a one-line diff in `app.ts`, verified against the actual deployed domain, not the currently-wrong one. Root `CLAUDE.md` is rewritten to match the live site. No new database migration. No files under `platform/apps/web`, `api/`, or `web-app/` are touched.
