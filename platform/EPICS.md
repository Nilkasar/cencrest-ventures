# BeBest Platform — Epic Roadmap (Rebuild)

Branch: `rebuild/platform`. Monorepo: `platform/` (pnpm workspaces + Turborepo). Old `api/`, `web-app/`, and the root marketing site are untouched reference material until their own epics land.

Each epic is built **backend + frontend together** (not backend-first-then-frontend), tracked here and mirrored into `session.md` on completion. No database migration is ever executed against a real database as part of this build — migrations are generated and committed as SQL/Prisma migration files only; applying them is the user's own step.

Status values: `PLANNED` → `SPEC READY` → `IN PROGRESS` → `BUILT (migration pending)` → `VERIFIED (qa-flow-tester)`.

| # | Epic | Domain | Spec | Status |
|---|---|---|---|---|
| 0 | Monorepo & Platform Foundation | Scaffold, schema audit, auth, orgs, RBAC, multi-tenancy, audit logging | [00-backend](docs/epics/00-platform-foundation-backend.md) / [00-frontend](docs/epics/00-platform-foundation-frontend.md) | VERIFIED (migration pending) — flaky @bebest/api test found+fixed during Epic 6/1/2 verification (auth.test.ts NODE_ENV leak) |
| 1 | CRM | Leads, Contacts, Accounts, Deals, Activities, pipeline UI | [spec](docs/epics/01-crm.md) / [backend](docs/epics/01-crm-backend.md) / [frontend](docs/epics/01-crm-frontend.md) | VERIFIED (migration pending) — kanban "move to Lost" reason-capture bug found and fixed, spot-checked in code |
| 2 | Brand Intelligence | Brands, competitors, entities, use cases, brand claims | [spec](docs/epics/02-brand-intelligence.md) / [backend](docs/epics/02-brand-intelligence-backend.md) / [frontend](docs/epics/02-brand-intelligence-frontend.md) | VERIFIED (migration pending) — frontend now wired to the real API, data-contract mismatches resolved against spec text, build-breaking TS error not reproducible/already clean, spot-checked in code |
| 3 | Website Intelligence (Crawler) | Crawl jobs, pages, page issues, sitemaps, SSRF-safe fetch | [03-website-intelligence.md](docs/epics/03-website-intelligence.md) | SPEC READY |
| 4 | SEO Intelligence | Keywords, keyword groups, SEO analyses, opportunities | [04-seo-intelligence.md](docs/epics/04-seo-intelligence.md) | SPEC READY |
| 5 | Intent & Query Universe | Query sets, queries, intent graph | [05-intent-query-universe.md](docs/epics/05-intent-query-universe.md) | SPEC READY |
| 6 | AI Provider Abstraction | `AIProvider` interface, Ollama/OpenAI/Anthropic/Google/Perplexity adapters, prompt versioning | [06-ai-provider-abstraction.md](docs/epics/06-ai-provider-abstraction.md) | VERIFIED (qa-flow-tester: production-ready) |
| 7 | AI Visibility Engine (GEO core) | AI runs, ai_responses, brand_observations, AVS formula v1.0 | [07-ai-visibility-engine.md](docs/epics/07-ai-visibility-engine.md) | SPEC READY |
| 8 | Competitive Intelligence | Competitor runs/observations, share-of-voice, gap analysis | [08-competitive-intelligence.md](docs/epics/08-competitive-intelligence.md) | SPEC READY |
| 9 | Opportunity Engine | Unified SEO+GEO scoring, opportunity_evidence | [09-opportunity-engine.md](docs/epics/09-opportunity-engine.md) | SPEC READY |
| 10 | Recommendation Engine | Recommendations, action_type, effort/impact | [10-recommendation-engine.md](docs/epics/10-recommendation-engine.md) | SPEC READY |
| 11 | Content Intelligence & Generation | Content briefs, drafts, approvals, published_content | [11-content-intelligence-generation.md](docs/epics/11-content-intelligence-generation.md) | SPEC READY |
| 12 | GEO Agent + SEO Agent + Growth Agent | Agent runner, event stream, autonomy levels 1-4 gate | — | PLANNED |
| 13 | Action Center & Controlled Publishing | actions table, approval workflow, rollback | — | PLANNED |
| 14 | Measurement & Learning Loop | Re-measurement, before/after attribution | — | PLANNED |
| 15 | Reporting & Notifications | Weekly/monthly digests, in-app + email notifications | — | PLANNED |
| 16 | Billing | Plans, subscriptions, entitlements, Stripe adapter | — | PLANNED |
| 17 | Free AI + SEO Snapshot | Public snapshot flow (feeds CRM leads) | — | PLANNED |
| 18 | Agency / White Label / Integrations | Multi-client, white-label, Search Console etc. | — | PLANNED |
| 19 | Production Hardening | Observability, rate-limit durability, load testing | — | PLANNED |
| 20 | Marketing Site Rebuild | Root site rebuilt clean on top of the finished platform | — | PLANNED |
| 21 | Final Audit | Full done/pending report across every epic above | — | PLANNED |

## Sequencing note

Epics 2–19 above are the honest full roadmap (mirrors the original 37-epic list, consolidated). They will be worked in this order unless a dependency forces reordering (e.g. Epic 6 AI Provider Abstraction must exist before Epic 7 AI Visibility Engine). Each epic gets a short spec written here (or in its own `platform/docs/epics/NN-name.md` once non-trivial) before backend-architect and frontend-engineer start it, from `growth-strategist`.

## Standing rule: every epic spec must include an explicit end-to-end flow checklist

Verifying an epic route-by-route or component-by-component is not enough — it's how integration gaps get missed. **Every `platform/docs/epics/NN-*.md` spec must include a numbered "End-to-end flow" section** tracing the real sequence of steps a user or the system goes through, naming every handoff (API call → DB write → UI update → notification → audit log, etc.). `qa-flow-tester` must walk that exact numbered list — not just each piece in isolation — before an epic can move to `VERIFIED`. Specs written before this rule (01, 02, 06) have had the section retrofitted; every spec from 07 onward includes it from the start.
