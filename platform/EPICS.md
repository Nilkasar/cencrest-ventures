# BeBest Platform — Epic Roadmap (Rebuild)

Branch: `rebuild/platform`. Monorepo: `platform/` (pnpm workspaces + Turborepo). Old `api/`, `web-app/`, and the root marketing site are untouched reference material until their own epics land.

Each epic is built **backend + frontend together** (not backend-first-then-frontend), tracked here and mirrored into `session.md` on completion. No database migration is ever executed against a real database as part of this build — migrations are generated and committed as SQL/Prisma migration files only; applying them is the user's own step.

Status values: `PLANNED` → `SPEC READY` → `IN PROGRESS` → `BUILT (migration pending)` → `VERIFIED (qa-flow-tester)`.

| # | Epic | Domain | Spec | Status |
|---|---|---|---|---|
| 0 | Monorepo & Platform Foundation | Scaffold, schema audit, auth, orgs, RBAC, multi-tenancy, audit logging | [00-backend](docs/epics/00-platform-foundation-backend.md) / [00-frontend](docs/epics/00-platform-foundation-frontend.md) | VERIFIED (migration pending) — flaky @bebest/api test found+fixed during Epic 6/1/2 verification (auth.test.ts NODE_ENV leak) |
| 1 | CRM | Leads, Contacts, Accounts, Deals, Activities, pipeline UI | [spec](docs/epics/01-crm.md) / [backend](docs/epics/01-crm-backend.md) / [frontend](docs/epics/01-crm-frontend.md) | VERIFIED (migration pending) — kanban "move to Lost" reason-capture bug found and fixed, spot-checked in code |
| 2 | Brand Intelligence | Brands, competitors, entities, use cases, brand claims | [spec](docs/epics/02-brand-intelligence.md) / [backend](docs/epics/02-brand-intelligence-backend.md) / [frontend](docs/epics/02-brand-intelligence-frontend.md) | VERIFIED (migration pending) — frontend now wired to the real API, data-contract mismatches resolved against spec text, build-breaking TS error not reproducible/already clean, spot-checked in code |
| 3 | Website Intelligence (Crawler) | Crawl jobs, pages, page issues, sitemaps, SSRF-safe fetch | [spec](docs/epics/03-website-intelligence.md) / [backend](docs/epics/03-website-intelligence-backend.md) / [frontend](docs/epics/03-website-intelligence-frontend.md) | VERIFIED (migration pending) — frontend now wired to real crawl/pages API, enum/field contract fixed, fake progress timer replaced with real incremental polling; no `GET /brands/me/crawl-jobs` list endpoint yet (flagged, minor) |
| 4 | SEO Intelligence | Keywords, keyword groups, SEO analyses, opportunities | [spec](docs/epics/04-seo-intelligence.md) / [backend](docs/epics/04-seo-intelligence-backend.md) / [frontend](docs/epics/04-seo-intelligence-frontend.md) | VERIFIED (migration pending) — built with the new backend-first process, zero wiring gaps, production-ready first pass |
| 5 | Intent & Query Universe | Query sets, queries, intent graph | [spec](docs/epics/05-intent-query-universe.md) / [backend](docs/epics/05-intent-query-universe-backend.md) / [frontend](docs/epics/05-intent-query-universe-frontend.md) | VERIFIED (migration pending) — frontend now wired to the real API, contract mismatch resolved (5 QuerySet fields + Query.source added to the schema, intent_type/category nullability reconciled at the API boundary), both backend bugs fixed (single-active-query-set enforcement on activate, entitlement cap on manual add) with new passing tests, spot-checked in code |
| 6 | AI Provider Abstraction | `AIProvider` interface, Ollama/OpenAI/Anthropic/Google/Perplexity adapters, prompt versioning | [06-ai-provider-abstraction.md](docs/epics/06-ai-provider-abstraction.md) | VERIFIED (qa-flow-tester: production-ready) |
| 7 | AI Visibility Engine (GEO core) | AI runs, ai_responses, brand_observations, AVS formula v1.0 | [spec](docs/epics/07-ai-visibility-engine.md) / [backend](docs/epics/07-ai-visibility-engine-backend.md) / [frontend](docs/epics/07-ai-visibility-engine-frontend.md) | VERIFIED (migration pending) — built with the new backend-first process, zero wiring gaps, production-ready first pass; full evidence drill-down (score -> formula -> observation -> raw response) confirmed working |
| 8 | Competitive Intelligence | Competitor runs/observations, share-of-voice, gap analysis | [spec](docs/epics/08-competitive-intelligence.md) / [backend](docs/epics/08-competitive-intelligence-backend.md) / [frontend](docs/epics/08-competitive-intelligence-frontend.md) | VERIFIED (migration pending) — reuses Epic 7's pipeline for competitor runs (competitor_id on ai_runs, not a parallel pipeline), Share-of-AI-Voice boundary cases tested, evidence sentences match spec format exactly |
| 9 | Opportunity Engine | Unified SEO+GEO scoring, opportunity_evidence | [09-opportunity-engine.md](docs/epics/09-opportunity-engine.md) | SPEC READY |
| 10 | Recommendation Engine | Recommendations, action_type, effort/impact | [10-recommendation-engine.md](docs/epics/10-recommendation-engine.md) | SPEC READY |
| 11 | Content Intelligence & Generation | Content briefs, drafts, approvals, published_content | [11-content-intelligence-generation.md](docs/epics/11-content-intelligence-generation.md) | SPEC READY |
| 12 | GEO Agent + SEO Agent + Growth Agent | Agent runner, event stream, autonomy levels 1-4 gate | — | PLANNED |
| 13 | Action Center & Controlled Publishing | actions table, approval workflow, rollback | — | PLANNED |
| 14 | Measurement & Learning Loop | Re-measurement, before/after attribution | — | PLANNED |
| 15 | Reporting & Notifications | Weekly/monthly digests, in-app + email notifications | — | PLANNED |
| 16 | Billing | Plans, subscriptions, entitlements, Stripe adapter | [spec](docs/epics/16-billing.md) / [backend](docs/epics/16-billing-backend.md) / [frontend](docs/epics/16-billing-frontend.md) | VERIFIED (migration pending) — entitlements.ts refactored onto real plans/subscriptions tables (fallback path spot-checked directly in code — only fires when no seeded row exists, not a second hardcoded map), Epics 2/5/7 regression suite confirmed green independently by qa-flow-tester (482/482), PaymentProvider + NullPaymentProvider + HMAC-verified idempotent webhook state machine, cancellation never hard-deletes |
| 17 | Free AI + SEO Snapshot | Public snapshot flow (feeds CRM leads) | [17-free-snapshot.md](docs/epics/17-free-snapshot.md) | SPEC READY |
| 18 | Agency / White Label / Integrations | Multi-client, white-label, Search Console etc. | — | PLANNED |
| 19 | Production Hardening | Observability, rate-limit durability, load testing | — | PLANNED |
| 20 | Marketing Site Rebuild | Root site rebuilt clean on top of the finished platform | — | PLANNED |
| 21 | Final Audit | Full done/pending report across every epic above | — | PLANNED |

## Sequencing note

Epics 2–19 above are the honest full roadmap (mirrors the original 37-epic list, consolidated). They will be worked in this order unless a dependency forces reordering (e.g. Epic 6 AI Provider Abstraction must exist before Epic 7 AI Visibility Engine). Each epic gets a short spec written here (or in its own `platform/docs/epics/NN-name.md` once non-trivial) before backend-architect and frontend-engineer start it, from `growth-strategist`.

## Standing rule: every epic spec must include an explicit end-to-end flow checklist

Verifying an epic route-by-route or component-by-component is not enough — it's how integration gaps get missed. **Every `platform/docs/epics/NN-*.md` spec must include a numbered "End-to-end flow" section** tracing the real sequence of steps a user or the system goes through, naming every handoff (API call → DB write → UI update → notification → audit log, etc.). `qa-flow-tester` must walk that exact numbered list — not just each piece in isolation — before an epic can move to `VERIFIED`. Specs written before this rule (01, 02, 06) have had the section retrofitted; every spec from 07 onward includes it from the start.

## Standing rule: backend builds first, frontend wires to the REAL API — no parallel fixture-building

Wave 1 (Epic 2) and Wave 2 (Epics 3 and 5) all independently produced the identical failure: a solid, well-tested backend and a solid, well-designed frontend, built in parallel against each side's own invented fixtures/types, that were never actually wired together and disagreed on field names/enums when checked. Running backend and frontend fully in parallel from a bare spec is what causes this — each side has to guess the other's exact contract instead of reading it.

**Fix, effective from Wave 3 onward**: within an epic, the backend agent runs to completion FIRST. The frontend agent then starts by reading the actual deployed routes/response shapes/Prisma fields (not the spec's prose, which is necessarily looser) and wires directly against them from the first line of data-layer code — no localStorage/in-memory fixture layer as the "real" data source, even temporarily. This costs some wall-clock parallelism (epics no longer build backend+frontend simultaneously) but eliminates this entire class of bug at the source rather than catching and fixing it after the fact every time.
