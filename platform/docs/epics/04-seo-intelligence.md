# Epic 4 — SEO Intelligence (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 2 (brand) and Epic 3 (crawled pages).

## Why this epic

This is ENGINE 1 of the two growth engines (`docs/10-seo/SEO_ENGINE.md`). It's buildable entirely on top of Epic 3's crawl data plus a keyword-data abstraction — no AI provider dependency required yet (that's Epic 6+), so it can land before the GEO side and start producing real opportunity data sooner.

## Domain model — gap in the docs, defined now

`docs/06-database/SCHEMA.md` lists the SEO schema group in `docs/05-architecture/ARCHITECTURE.md`'s overview (`keyword_groups`, `keywords`, `seo_analyses`, `content_pages`, `seo_opportunities`) but never gives their `CREATE TABLE` statements the way it does for Identity/Brand/GEO/Opportunity/CRM/Billing. Define them now, consistent with the rest of the schema's conventions (UUID PK, `organization_id`, soft delete, `TIMESTAMPTZ`):

- `keyword_groups` — `id, organization_id, brand_id, name (topic cluster), created_at, updated_at`.
- `keywords` — `id, keyword_group_id, organization_id, text, intent (informational|navigational|commercial|transactional), monthly_volume (nullable), difficulty (nullable, 0-100), confidence (high|medium|low|estimate), source (which SEODataProvider returned it)` — mirrors the `KeywordData` shape in `docs/10-seo/SEO_ENGINE.md` exactly; don't invent a different shape.
- `seo_analyses` — `id, organization_id, brand_id, page_id (nullable, references Epic 3's pages), analysis_type (technical|content), score, findings (JSONB), analyzed_at`.
- `seo_opportunities` — `id, organization_id, brand_id, keyword_id (nullable), title, opportunity_type (service_page|comparison_page|use_case_page|faq_page|...), value_score, effort_score, opportunity_score, scoring_formula_version, status, created_at`. This feeds Epic 9's unified Opportunity Engine — keep the shape close to the `opportunities` table Epic 9 will define so the merge is mechanical, not a redesign.

## SEO Opportunity Scoring — formula v1.0 (`docs/10-seo/SEO_ENGINE.md`, verbatim, do not alter without a version bump)

```
Value = demand_score × (1 - current_coverage)
Effort = content_complexity × technical_difficulty   (0-100)
Opportunity Score = (Value × 0.7) + (Value / Effort × 0.3), normalized to 0-100
```
Store `scoring_formula_version = "1.0"` on every computed row. This is deterministic-formula territory (ADR-004) — no LLM involved at this stage.

## `SEODataProvider` abstraction (`docs/10-seo/SEO_ENGINE.md`)

Build the interface now even though no paid provider (Semrush/Ahrefs/DataForSEO/Serper) is wired: `getKeywordData(keywords)`, `getCompetitorKeywords(domain, limit?)`, `getRankings(domain, keywords)`. Ship a `NullSEODataProvider` (or `SearchConsoleProvider` stub) that returns `confidence: "estimate"` results so the rest of the system (opportunity scoring, UI) has something real to render without a paid API key. This mirrors the `AIProvider` abstraction pattern from Epic 6 — same discipline: application code never imports a specific provider directly.

## API surface

- `POST /brands/:id/seo/analyze` — runs the technical SEO checklist (`docs/10-seo/SEO_ENGINE.md`'s Page Analysis Checklist: title/meta/H1/heading hierarchy/schema/technical) against Epic 3's crawled pages, writes `seo_analyses` + derives `page_issues` (Epic 3 table) where applicable.
- `keyword_groups`, `keywords`: CRUD, plus a "generate from brand profile" action that seeds an initial keyword list from Epic 2's `use_cases`/`categories` via the `SEODataProvider`.
- `seo_opportunities`: list (sorted by `opportunity_score` desc), get, dismiss.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "SEO Intelligence" screen ("Where do I stand in search?"): technical health score with a drill-down to specific page issues, keyword coverage list, and an opportunity list sorted by score — each opportunity shows its evidence (the demand/coverage numbers behind the formula), not just a bare number, per the GEO engine's evidence-traceability principle applied equally here.

## End-to-end flow (qa-flow-tester must trace every step below, not just the formula in isolation)

1. `POST /brands/:id/seo/analyze` against Epic 3's crawled pages — confirm `seo_analyses` rows are written AND that violations of the Page Analysis Checklist actually produce `page_issues` rows on the correct page (cross-epic wiring, not a self-contained SEO-only table).
2. `keyword_groups`/`keywords` "generate from brand profile" — confirm it actually reads Epic 2's `use_cases`/`categories` (not a hardcoded fixture) and that every returned `KeywordData` row carries a `confidence` value, defaulting to `"estimate"` when no paid provider is configured — never silently presenting an estimate as a firm number.
3. `GET /brands/:id/seo/opportunities` — confirm the returned `opportunity_score` matches hand-computation of the stated formula for a fixture input, and that each opportunity is traceable to the specific keyword/page evidence behind it in the UI.
4. The SEO Intelligence screen renders the opportunity list sorted by score — confirm sorting is server-side and stable (matches the API's own ordering), not re-sorted ad hoc in the client in a way that could drift from the stored `opportunity_score`.
5. Tenant isolation check across `keyword_groups`, `keywords`, `seo_analyses`, `seo_opportunities`.

## Definition of done

Standard DoD. Formula unit tests with known inputs/expected outputs (hard requirement per `docs/12-ai/AI_ARCHITECTURE.md`'s scoring-architecture principle, which applies to SEO scoring too even though that doc is nominally about GEO). Tenant isolation tests for all new tables.
