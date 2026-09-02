# BeBest Platform — Epic Roadmap (Rebuild)

Branch: `rebuild/platform`. Monorepo: `platform/` (pnpm workspaces + Turborepo). Old `api/`, `web-app/`, and the root marketing site are untouched reference material until their own epics land.

Each epic is built **backend + frontend together** (not backend-first-then-frontend), tracked here and mirrored into `session.md` on completion. No database migration is ever executed against a real database as part of this build — migrations are generated and committed as SQL/Prisma migration files only; applying them is the user's own step.

Status values: `PLANNED` → `SPEC READY` → `IN PROGRESS` → `BUILT (migration pending)` → `VERIFIED (qa-flow-tester)`.

| # | Epic | Domain | Spec | Status |
|---|---|---|---|---|
| 0 | Monorepo & Platform Foundation | Scaffold, schema audit, auth, orgs, RBAC, multi-tenancy, audit logging | [00-backend](docs/epics/00-platform-foundation-backend.md) / [00-frontend](docs/epics/00-platform-foundation-frontend.md) | BUILT (migration pending) |
| 1 | CRM | Leads, Contacts, Accounts, Deals, Activities, pipeline UI | [01-crm.md](docs/epics/01-crm.md) | SPEC READY |
| 2 | Brand Intelligence | Brands, competitors, entities, use cases, brand claims | [02-brand-intelligence.md](docs/epics/02-brand-intelligence.md) | SPEC READY |
| 3 | Website Intelligence (Crawler) | Crawl jobs, pages, page issues, sitemaps, SSRF-safe fetch | [03-website-intelligence.md](docs/epics/03-website-intelligence.md) | SPEC READY |
| 4 | SEO Intelligence | Keywords, keyword groups, SEO analyses, opportunities | [04-seo-intelligence.md](docs/epics/04-seo-intelligence.md) | SPEC READY |
| 5 | Intent & Query Universe | Query sets, queries, intent graph | [05-intent-query-universe.md](docs/epics/05-intent-query-universe.md) | SPEC READY |
| 6 | AI Provider Abstraction | `AIProvider` interface, Ollama/OpenAI/Anthropic/Google/Perplexity adapters, prompt versioning | [06-ai-provider-abstraction.md](docs/epics/06-ai-provider-abstraction.md) | SPEC READY |
| 7 | AI Visibility Engine (GEO core) | AI runs, ai_responses, brand_observations, AVS formula v1.0 | — | PLANNED |
| 8 | Competitive Intelligence | Competitor runs/observations, share-of-voice, gap analysis | PLANNED |
| 9 | Opportunity Engine | Unified SEO+GEO scoring, opportunity_evidence | PLANNED |
| 10 | Recommendation Engine | Recommendations, action_type, effort/impact | PLANNED |
| 11 | Content Intelligence & Generation | Content briefs, drafts, approvals, published_content | PLANNED |
| 12 | GEO Agent + SEO Agent + Growth Agent | Agent runner, event stream, autonomy levels 1-4 gate | PLANNED |
| 13 | Action Center & Controlled Publishing | actions table, approval workflow, rollback | PLANNED |
| 14 | Measurement & Learning Loop | Re-measurement, before/after attribution | PLANNED |
| 15 | Reporting & Notifications | Weekly/monthly digests, in-app + email notifications | PLANNED |
| 16 | Billing | Plans, subscriptions, entitlements, Stripe adapter | PLANNED |
| 17 | Free AI + SEO Snapshot | Public snapshot flow (feeds CRM leads) | PLANNED |
| 18 | Agency / White Label / Integrations | Multi-client, white-label, Search Console etc. | PLANNED |
| 19 | Production Hardening | Observability, rate-limit durability, load testing | PLANNED |
| 20 | Marketing Site Rebuild | Root site rebuilt clean on top of the finished platform | PLANNED |
| 21 | Final Audit | Full done/pending report across every epic above | PLANNED |

## Sequencing note

Epics 2–19 above are the honest full roadmap (mirrors the original 37-epic list, consolidated). They will be worked in this order unless a dependency forces reordering (e.g. Epic 6 AI Provider Abstraction must exist before Epic 7 AI Visibility Engine). Each epic gets a short spec written here (or in its own `platform/docs/epics/NN-name.md` once non-trivial) before backend-architect and frontend-engineer start it, from `growth-strategist`.
