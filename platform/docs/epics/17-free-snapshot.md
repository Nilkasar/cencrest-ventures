# Epic 17 — Free AI + SEO Growth Snapshot (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 1 (CRM — a snapshot request becomes a lead), Epic 3 (crawler), Epic 4 (SEO), Epic 5 (query universe), Epic 7 (AI visibility) — all done. This is an orchestration epic: it wires already-built engines into one public-facing flow, not a new engine of its own.

## Why this epic

`PRODUCT_VISION.md`: "The product entry point is a Free AI + SEO Growth Snapshot... The Snapshot provides REAL value. It is not a teaser." This is also literally TD-001/D-O10 from the original marketing-site technical debt — the apply form that currently loses every lead. This epic is what that form should eventually submit to (the actual marketing-site wiring is Epic 20, but the backend endpoint and logic belong here, buildable and testable now).

## The flow (`docs/09-ux/CUSTOMER_JOURNEY.md` Stage 2, and `PRODUCT_VISION.md`'s "Free Snapshot" section — implement exactly)

1. Public, unauthenticated `POST /snapshot` — input: name, work email, company name, website URL, industry/category (optional), biggest competitor (optional). No login required — this is the top of the funnel.
2. Behind the scenes, in order:
   a. Create a `leads` row (Epic 1) with `source: 'free_snapshot'`.
   b. Kick off a website crawl (Epic 3) — small scope, not the full 500-page crawl (this is a snapshot, not a paid baseline; cap pages low, e.g. 10, matching `docs/16-billing/BILLING_ARCHITECTURE.md`'s free-tier `pages_analyzed: 10`).
   c. Generate a SAMPLE query set (Epic 5) — 20-50 queries per `docs/11-geo/GEO_ENGINE.md`'s Free tier, not the full paid-tier universe.
   d. Run the sample query set across all 4 AI providers (Epic 7) — small scope, matching the free tier's query budget.
   e. Run a basic SEO analysis (Epic 4) against the crawled pages.
   f. Generate the report: AI Visibility Score (sample), 3 competitors identified (from the optional "biggest competitor" input plus any auto-detected via Epic 8's logic if time allows — otherwise just the one provided), top 3 AI gaps, top 3 SEO gaps, top 3 recommended priorities (a lightweight version of Epic 9/10's scoring, not the full opportunity engine — document this as a deliberate simplification, not a shortcut hidden from the user).
3. Confirmation screen immediately: "Your snapshot is being prepared. We'll email you within 24 hours" (the spec's literal copy).
4. Once all of 2a-2f complete (this is a background job orchestrating FOUR other epics' pipelines in sequence/parallel — build this as an explicit orchestrator, not an ad hoc chain of fire-and-forget calls), send an email (via the `EmailSender` interface from Epic 0 — still `ConsoleEmailSender` in dev, real Resend wiring is a later concern) with a link to the web report.
5. Web report page (public, tokenized URL — no login) renders the score + gaps + recommendations, with a CTA: "See your full analysis — book a call or sign up."

## Rate limiting (`docs/08-security/SECURITY.md`, non-negotiable for a public endpoint)

`Free Snapshot: 1 request per hour per IP` — exactly per the documented table. This is the single most abuse-prone endpoint in the entire system (public, triggers real AI provider calls and a real crawl) — enforce this before anything else runs, reusing Epic 0's rate-limit infrastructure.

## SSRF / input validation

The website URL is customer-supplied and public-facing with NO auth gate — reuse Epic 3's `safeFetch`/SSRF guard exactly, no exceptions, since this is the highest-risk entry point for exactly the threat that guard exists to stop.

## API surface

- `POST /snapshot` — public, rate-limited, creates the lead + kicks off the orchestrated pipeline.
- `GET /snapshot/:token` — public, tokenized (not the lead's real ID — don't leak enumerable IDs on a public endpoint), returns the completed report once ready, or a "still preparing" state before then.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 2: the intake form (can live in `apps/web` as a public route, even though this app is otherwise the authenticated customer portal — or note explicitly if it should instead be a lightweight standalone page, since the actual marketing-site integration is Epic 20; building it in `apps/web` now as a public route group is the pragmatic choice so it can reuse `@bebest/ui` and the real API immediately), the confirmation screen, and the public report page. The report page is a customer-facing deliverable that needs the same design-system quality bar as the authenticated app — this is often a prospect's first real impression of the product.

## End-to-end flow (qa-flow-tester must trace every step below, not just each epic's individual call in isolation)

1. Submit the public form → confirm a `leads` row exists with `source: 'free_snapshot'` BEFORE the orchestrated pipeline finishes (per `docs/09-ux/CUSTOMER_JOURNEY.md`'s own ordering: lead created first, "behind the scenes" work after) — a failure partway through the pipeline must not un-create the lead.
2. Confirm the crawl, query generation, AI run, and SEO analysis are all genuinely scoped to free-tier limits (10 pages, 20-50 queries) — not accidentally running the full paid-tier pipeline for an anonymous, unauthenticated request (a real cost/abuse risk if missed).
3. Confirm rate limiting rejects a second request from the same IP within the hour BEFORE any of steps 2a-2f run, not after.
4. Confirm the SSRF guard is exercised on the submitted website URL exactly as it is for authenticated crawls — trace this by reading the code path, don't assume reuse without checking.
5. Once the pipeline completes, confirm the confirmation-screen promise is kept: an email actually attempts to send (via `EmailSender`, even if `ConsoleEmailSender` in this environment) and the tokenized report URL becomes retrievable via `GET /snapshot/:token`.
6. Confirm the report token is NOT the lead's or organization's real database ID and cannot be enumerated to access another snapshot.
7. Confirm the report page renders real computed data (an actual sample AVS, actual crawled-page issues) — not placeholder/lorem-ipsum content — by tracing the report-generation code back to the same Epic 4/7 computation functions already verified in those epics, not a reimplementation.

## Definition of done

Standard DoD. A test proving the full orchestration completes end-to-end against mocked/fake sub-pipelines (lead created → crawl → queries → AI run → SEO analysis → report → email) with each stage's mock asserting it was called with free-tier-scoped parameters, not paid-tier ones.
