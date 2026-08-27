# EPICS.md — BeBest AI + SEO Growth Autopilot

**Project:** BeBest  
**Current State:** Pure HTML/CSS/JS marketing website on Vercel. No backend, no database, no AI integrations.  
**Goal:** Full AI + SEO intelligence platform — automated brand monitoring, competitive analysis, content generation, and growth automation.  
**Total Epics:** 37 (Epic 0–36)

---

## EPIC 0: Repository Audit & Product Specification
**Status:** COMPLETE  
**Depends on:** None

### Purpose
Audit the existing BeBest repository, document all current assets, define the full product vision, and produce the master specification that all subsequent epics reference. This epic establishes the source of truth for what BeBest is, what it must do, and how it will be built.

### Business Problem
Without a clear audit and specification, development would proceed on assumptions. This epic prevents scope drift, duplicated effort, and architectural mistakes by establishing a single agreed-upon plan before a line of production code is written.

### Key User Stories
- As the product owner, I want a complete inventory of existing files so that I know what to keep, migrate, or discard.
- As the lead engineer, I want a technical architecture document so that I can make stack decisions with full context.
- As a stakeholder, I want a prioritized epic list so that I can understand delivery sequence and dependencies.

### Functional Requirements
- Full file-by-file audit of the existing repo
- Product vision document covering positioning, target users, and core value propositions
- Epic list with dependency graph
- Tech stack decision log with rationale
- Data model sketch (entities and relationships)

### Acceptance Criteria
- PRODUCT_VISION.md exists and is approved
- PROJECT_MASTER_PLAN.md exists with all 37 epics listed
- DECISIONS.md captures all stack choices with rationale
- No epic in 1–36 has an undefined dependency

### Definition of Done
All specification documents merged to main. Product owner sign-off recorded in DECISIONS.md.

---

## EPIC 1: Platform Foundation
**Status:** PLANNED  
**Depends on:** Epic 0

### Purpose
Establish the backend runtime, database, CI/CD pipeline, error tracking, analytics, and form-handling infrastructure that every subsequent epic builds on. This epic converts BeBest from a static site into a deployable, observable, production-capable platform.

### Business Problem
The current site has no backend. Every feature in epics 2–36 requires a persistent runtime, a database, structured deployments, and operational visibility. Without this foundation, no other epic can proceed.

### Key User Stories
- As an engineer, I want a Node.js/TypeScript API runtime deployed on Vercel so that I can add backend routes without managing servers.
- As an engineer, I want a managed PostgreSQL database provisioned and migrated via code so that schema changes are tracked and reversible.
- As an engineer, I want a CI/CD pipeline that runs tests and deploys on merge so that broken code never reaches production.
- As an ops lead, I want error tracking (Sentry) integrated so that production exceptions are surfaced with full stack traces.
- As a product manager, I want analytics events flowing so that I can measure user behavior from day one.
- As a growth engineer, I want a form backend so that the existing HTML contact/apply forms persist submissions to the database.

### Functional Requirements
- Next.js 14+ App Router project initialized in the repo, replacing or wrapping static HTML pages
- Vercel project linked; preview deployments on every PR, production on main
- PostgreSQL via Vercel Postgres (Neon) provisioned; connection pooling via PgBouncer
- Drizzle ORM with migration runner; all schema changes in versioned migration files
- Sentry SDK integrated for both client and server; source maps uploaded on deploy
- PostHog (or equivalent) analytics with pageview and custom event tracking
- Redis via Upstash for queue, cache, and rate-limit state
- Environment variable management: `.env.local` for dev, Vercel env vars for staging/production
- Form backend: POST /api/forms/:formId stores submission to `form_submissions` table, sends confirmation email via Resend
- Health check endpoint: GET /api/health returns 200 with version and DB connectivity status
- Structured JSON logging with request ID propagation

### Non-Functional Requirements
- Cold start < 500ms for all API routes
- DB connection pool max 20 connections
- 99.9% uptime SLA target
- All secrets stored in Vercel env vars, never committed to git

### API Endpoints
- `GET /api/health` — liveness + readiness check
- `POST /api/forms/:formId` — accept and persist form submission
- `GET /api/version` — return git SHA and deploy timestamp

### Database Entities
- `form_submissions` (id, form_id, payload jsonb, email, created_at)
- `migrations` (managed by Drizzle)

### Security Requirements
- No secrets in source code or git history
- All API routes reject requests without valid origin header in production
- Rate limit form submissions: 5 per IP per hour

### Acceptance Criteria
- `npm run dev` starts the app locally with hot reload
- Pushing to a feature branch creates a Vercel preview deployment automatically
- Merging to main triggers production deployment with zero-downtime swap
- Sentry captures a test exception and appears in the Sentry dashboard
- Form submission from the existing apply form persists to the database
- GET /api/health returns `{"status":"ok"}` in production

### Definition of Done
All infra live in production. CI pipeline green. Sentry, analytics, and form backend verified with real data. No open P0 issues.

---

## EPIC 2: Organizations / Users / RBAC
**Status:** PLANNED  
**Depends on:** Epic 1

### Purpose
Model the multi-tenant organizational structure of BeBest. Every piece of data — brands, keywords, reports, actions — belongs to an organization. Users belong to organizations with specific roles. This epic defines those relationships and enforces them at the data layer.

### Business Problem
BeBest serves multiple clients. Without a proper multi-tenant model, data bleeds between clients, permissions cannot be enforced, and team collaboration is impossible.

### Key User Stories
- As an admin, I want to create an organization and invite team members so that my team can collaborate on the same brand data.
- As an organization member, I want to see only my organization's data so that I never see another client's information.
- As an admin, I want to assign roles (Admin, Editor, Viewer) so that I can control who can take actions.
- As a platform owner, I want to enforce organization isolation at the query layer so that a bug never leaks cross-tenant data.
- As an agency user, I want to manage multiple client organizations so that I can work across accounts from one login.

### Functional Requirements
- `organizations` table: id, name, slug, plan, settings jsonb, created_at
- `users` table: id, email, full_name, avatar_url, created_at
- `org_members` table: org_id, user_id, role (admin|editor|viewer), invited_at, accepted_at
- `invitations` table: id, org_id, email, role, token, expires_at, accepted_at
- All subsequent data tables include `org_id` foreign key with row-level security policy
- Invitation flow: admin sends invite → email with magic link → recipient clicks → account created or linked → member record inserted
- Role enforcement middleware: every API route resolves current org and asserts required role
- Organization switcher in UI for users who belong to multiple orgs
- Org slug used in all URLs: `/org/:slug/...`

### Non-Functional Requirements
- Row-level security (RLS) enforced at the PostgreSQL level — not just application layer
- All queries scoped by `org_id` index
- Invitation tokens expire after 7 days

### API Endpoints
- `POST /api/orgs` — create organization
- `GET /api/orgs/:slug` — get org details
- `PATCH /api/orgs/:slug` — update org settings
- `GET /api/orgs/:slug/members` — list members
- `POST /api/orgs/:slug/invitations` — send invitation
- `DELETE /api/orgs/:slug/members/:userId` — remove member
- `PATCH /api/orgs/:slug/members/:userId` — change role

### Database Entities
- `organizations`, `users`, `org_members`, `invitations`

### Security Requirements
- RLS policies on every tenant-scoped table
- Invitation tokens: 32-byte cryptographically random, hashed in DB
- Admins cannot demote themselves below Admin if they are the last admin

### Acceptance Criteria
- User in Org A cannot retrieve any data from Org B via any API route
- Invitation email delivered within 60 seconds of POST
- Accepting invitation with expired token returns 410 Gone
- Role change takes effect immediately on next request
- Database queries for org data always include `org_id` in the WHERE clause (verified by query log audit)

### Definition of Done
Multi-tenant isolation verified by automated integration test. Invitation flow tested end-to-end. RBAC middleware applied to all existing routes.

---

## EPIC 3: Authentication / Security
**Status:** PLANNED  
**Depends on:** Epic 1, Epic 2

### Purpose
Implement secure authentication for all BeBest users. Cover email/password login, magic link login, OAuth (Google), session management, MFA, and all security headers and protections that a SaaS platform requires.

### Business Problem
BeBest will store sensitive competitive intelligence data. Without robust authentication and security controls, client data is at risk, and the platform cannot be sold to enterprise buyers.

### Key User Stories
- As a new user, I want to sign up with my email and password so that I can create an account.
- As a returning user, I want to log in with Google OAuth so that I don't need to remember a password.
- As a security-conscious user, I want to enable TOTP-based MFA so that my account is protected even if my password is compromised.
- As a user, I want password reset via email so that I can recover access if I forget my password.
- As a platform operator, I want all sessions to expire after inactivity so that abandoned browser sessions don't remain valid.

### Functional Requirements
- Auth provider: Clerk (preferred) or custom JWT with Argon2 password hashing
- Email + password registration with email verification
- Magic link login (passwordless)
- Google OAuth 2.0
- TOTP-based MFA (RFC 6238 compliant)
- Session tokens: 30-day rolling expiry; revocable
- Password reset: time-limited token (1 hour), single-use
- Brute-force protection: lock account after 10 failed login attempts for 15 minutes
- Security headers on all responses: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- CSRF protection on all state-changing endpoints
- Audit log: every auth event (login, logout, password change, MFA enable/disable) recorded

### Non-Functional Requirements
- Auth endpoints respond in < 300ms p99
- Passwords never stored in plaintext or reversibly encrypted
- Session tokens never appear in URLs or logs

### API Endpoints
- `POST /api/auth/register` — email + password signup
- `POST /api/auth/login` — email + password login
- `POST /api/auth/magic-link` — send magic link
- `GET /api/auth/magic-link/verify` — verify magic link token
- `POST /api/auth/logout` — revoke session
- `POST /api/auth/password-reset/request` — send reset email
- `POST /api/auth/password-reset/confirm` — apply new password
- `POST /api/auth/mfa/setup` — generate TOTP secret + QR code
- `POST /api/auth/mfa/verify` — verify TOTP code
- `GET /api/auth/me` — return current user + org memberships

### Database Entities
- `sessions` (id, user_id, token_hash, expires_at, created_at, last_seen_at, ip, user_agent)
- `auth_events` (id, user_id, event_type, ip, user_agent, created_at)
- `mfa_configs` (user_id, totp_secret_encrypted, backup_codes_hashed, enabled_at)
- `password_reset_tokens` (id, user_id, token_hash, expires_at, used_at)

### Security Requirements
- Passwords hashed with Argon2id (memory: 64MB, iterations: 3, parallelism: 4)
- TOTP secrets encrypted at rest with AES-256-GCM
- All auth tokens transmitted over HTTPS only
- Refresh tokens rotated on every use
- Failed login attempts logged with IP

### Acceptance Criteria
- User can register, verify email, and log in within a single session
- Google OAuth login creates or links account correctly
- MFA-enabled account cannot log in with password alone
- Password reset token is single-use — second use returns 400
- Brute-force protection activates after 10 failed attempts
- Security headers present on every response (verified with securityheaders.com scan)

### Definition of Done
Auth flow tested with automated e2e tests. Security headers verified. Penetration test checklist completed. MFA working end-to-end.

---

## EPIC 4: Brand Intelligence
**Status:** PLANNED  
**Depends on:** Epic 2, Epic 3

### Purpose
Build the core brand data model for BeBest. Every analysis, recommendation, and report is anchored to a brand entity with its products, services, categories, competitors, and use cases. This epic creates the structured knowledge base that feeds every intelligence engine downstream.

### Business Problem
Without a structured brand model, AI prompts are generic, SEO analysis has no context, and competitive intelligence has no frame of reference. The brand model is the semantic foundation of the entire platform.

### Key User Stories
- As a user, I want to onboard my company by entering its name, domain, and description so that BeBest can begin analyzing it.
- As a user, I want to add my products and services so that AI and SEO analysis targets the right entities.
- As a user, I want to specify my target categories and market segments so that keyword and competitor research is scoped correctly.
- As a user, I want to add known competitors so that BeBest can track them alongside my brand.
- As a user, I want BeBest to suggest competitors I haven't listed based on my category and products.
- As a user, I want to define use cases my product solves so that AI prompt generation covers the right buyer scenarios.

### Functional Requirements
- Brand onboarding wizard: domain → auto-fetch company name, description, logo
- `brands` table: id, org_id, domain, name, description, logo_url, industry, founding_year, hq_country
- `products` table: id, brand_id, name, description, category, price_range, target_persona
- `services` table: id, brand_id, name, description, delivery_model, target_persona
- `categories` table: id, brand_id, name, parent_category, source (user|inferred)
- `competitors` table: id, brand_id, competitor_domain, competitor_name, added_by (user|system), confidence_score
- `use_cases` table: id, brand_id, title, persona, problem, solution, outcome
- `entities` table: id, brand_id, entity_type, name, description — named entities for NLP matching
- Auto-suggest competitors: given domain, query AI/web for top 10 competing domains
- Brand completeness score: percentage of fields filled, shown as onboarding progress
- Brand profile UI: tabbed view (Overview, Products, Services, Competitors, Use Cases)

### Non-Functional Requirements
- Domain auto-fetch (favicon, meta description, og:image) completes in < 5 seconds
- Brand profile page loads in < 1 second
- Competitor suggestions refreshed no more than once per 7 days to limit API cost

### API Endpoints
- `POST /api/brands` — create brand
- `GET /api/brands/:brandId` — get brand profile
- `PATCH /api/brands/:brandId` — update brand
- `GET /api/brands/:brandId/completeness` — return completeness score
- `POST /api/brands/:brandId/products` — add product
- `PUT /api/brands/:brandId/products/:productId` — update product
- `DELETE /api/brands/:brandId/products/:productId` — delete product
- `POST /api/brands/:brandId/competitors` — add competitor
- `GET /api/brands/:brandId/competitors/suggestions` — AI-suggested competitors
- `POST /api/brands/:brandId/use-cases` — add use case
- `POST /api/brands/:brandId/entities` — add entity

### Database Entities
- `brands`, `products`, `services`, `categories`, `competitors`, `use_cases`, `entities`

### Security Requirements
- All brand data scoped to `org_id` with RLS
- Domain auto-fetch runs server-side (never exposes API keys to client)

### Acceptance Criteria
- Entering a domain auto-populates name, description, and logo within 5 seconds
- Brand completeness score updates in real time as fields are filled
- Adding a competitor via suggestion flow persists with source=system and confidence score
- Deleting a product cascades to remove associated use cases and entities
- Brand data is inaccessible to users outside the org

### Definition of Done
Brand onboarding wizard live. All CRUD endpoints tested. Completeness score accurate. Competitor suggestions working with at least one AI source.

---

## EPIC 5: Website Intelligence
**Status:** PLANNED  
**Depends on:** Epic 4

### Purpose
Build a website crawler and technical SEO analyzer that ingests a brand's domain, extracts all pages, analyzes technical health, and stores structured content for downstream analysis. This is the raw data pipeline that feeds SEO intelligence, content intelligence, and competitive tracking.

### Business Problem
BeBest cannot analyze what it cannot see. Every SEO gap, content opportunity, and technical issue requires a current, structured snapshot of the brand's website. Manual audits are too slow and expensive to run continuously.

### Key User Stories
- As a user, I want BeBest to crawl my website so that it discovers all indexed pages automatically.
- As a user, I want a technical SEO health report so that I can see crawl errors, missing tags, and page speed issues.
- As a user, I want the crawler to run on a schedule so that my data stays current without manual intervention.
- As a user, I want to see which pages are missing title tags or meta descriptions so that I can fix them.
- As an engineer, I want crawl jobs to run asynchronously so that large sites don't time out the API.

### Functional Requirements
- Crawler built on Crawlee or Playwright with configurable depth and page limit (default: 500 pages)
- Crawl job queue via Redis/BullMQ; one job per brand per crawl run
- Pages extracted: URL, title, meta description, h1, canonical, status code, word count, internal links, external links, schema markup, load time
- Technical SEO checks per page: missing title, missing meta, duplicate title, missing canonical, broken links (4xx/5xx), redirect chains, missing alt text on images
- Site-level aggregates: crawl coverage, page count, indexed vs blocked pages, average load time
- `crawl_jobs` table: id, brand_id, status, started_at, completed_at, pages_crawled, errors
- `pages` table: id, crawl_job_id, brand_id, url, title, meta_description, h1, canonical, status_code, word_count, load_ms, schema_types, crawled_at
- `page_issues` table: id, page_id, issue_type, severity (critical|warning|info), detail
- Scheduled crawls: configurable (daily/weekly/monthly) per brand; default weekly
- Re-crawl on-demand via UI button
- Sitemap.xml parsing as crawl seed

### Non-Functional Requirements
- Crawl rate: max 2 requests/second per domain (respectful crawling)
- Crawl job for 500-page site completes in < 15 minutes
- Crawl worker runs in a Vercel background function or separate worker process
- Robots.txt respected always

### API Endpoints
- `POST /api/brands/:brandId/crawl` — trigger crawl job
- `GET /api/brands/:brandId/crawl/status` — current job status + progress
- `GET /api/brands/:brandId/pages` — paginated list of crawled pages
- `GET /api/brands/:brandId/pages/:pageId` — single page detail
- `GET /api/brands/:brandId/site-health` — aggregated technical SEO score
- `GET /api/brands/:brandId/issues` — all page issues, filterable by severity

### Database Entities
- `crawl_jobs`, `pages`, `page_issues`

### Security Requirements
- Crawl only domains the org has verified ownership of (DNS TXT record or meta tag verification)
- User-agent string identifies BeBest crawler
- Crawl budget enforced per plan tier

### Acceptance Criteria
- Triggering a crawl on a 50-page site completes within 5 minutes
- All pages with missing title tags appear in the issues list with severity=critical
- Broken links (404) are detected and listed
- Crawl respects robots.txt — disallowed paths not visited
- Scheduled crawl runs automatically without manual trigger
- Domain ownership verified before first crawl

### Definition of Done
Crawler live with queue. Technical SEO issues surfaced in UI. Scheduled crawl running for at least one brand. Domain verification implemented.

---

## EPIC 6: SEO Intelligence
**Status:** PLANNED  
**Depends on:** Epic 4, Epic 5

### Purpose
Build the SEO keyword intelligence layer: keyword research abstraction across data sources (Google Search Console, SEMrush, Ahrefs, DataForSEO), technical SEO scoring, and content gap identification. This provides the keyword universe that drives all content and optimization recommendations.

### Business Problem
Keyword data is fragmented across tools, expensive to query redundantly, and disconnected from brand context. BeBest must unify keyword intelligence into a single abstraction layer that any downstream engine can query without knowing the underlying data source.

### Key User Stories
- As a user, I want to connect Google Search Console so that BeBest ingests my real impression and click data.
- As a user, I want keyword difficulty and volume data so that I can prioritize which terms to target.
- As a user, I want to see which keywords I rank for and where I have gaps so that I can focus effort.
- As a user, I want keyword clustering by topic so that I can plan content by theme rather than individual terms.
- As an engineer, I want a unified keyword API so that I can query keyword data without coupling to a specific vendor.

### Functional Requirements
- Keyword provider abstraction interface: `KeywordProvider { getVolume, getDifficulty, getRankings, getSuggestions }`
- Implementations: DataForSEO (primary), SEMrush (if API key provided), Google Search Console (OAuth)
- GSC OAuth integration: import clicks, impressions, CTR, average position per URL per query
- `keywords` table: id, brand_id, keyword, volume, difficulty, cpc, intent (informational|navigational|commercial|transactional), source, updated_at
- `brand_keyword_rankings` table: id, brand_id, keyword_id, position, url, date
- `keyword_clusters` table: id, brand_id, cluster_name, pillar_topic, keywords[] (array of keyword_ids)
- Content gap analysis: keywords where brand has no ranking page in top 50
- Technical SEO scoring: site-level score (0–100) based on issue counts weighted by severity
- Keyword import: bulk CSV upload + auto-deduplicate against existing keywords
- Competitor keyword overlap: keywords ranked by competitor but not by brand

### Non-Functional Requirements
- Keyword data refreshed weekly per brand (to control API costs)
- GSC data import processes up to 25,000 rows per import job
- Keyword provider calls cached in Redis for 24 hours

### API Endpoints
- `POST /api/brands/:brandId/keywords` — add keyword(s)
- `GET /api/brands/:brandId/keywords` — list all keywords with rankings
- `GET /api/brands/:brandId/keywords/gaps` — content gap keywords
- `GET /api/brands/:brandId/keywords/clusters` — keyword clusters
- `POST /api/brands/:brandId/keywords/import` — bulk CSV import
- `POST /api/brands/:brandId/integrations/gsc/connect` — initiate GSC OAuth
- `GET /api/brands/:brandId/seo-score` — technical SEO score
- `GET /api/brands/:brandId/keywords/competitor-overlap` — competitor keyword gap

### Database Entities
- `keywords`, `brand_keyword_rankings`, `keyword_clusters`, `gsc_connections`

### Security Requirements
- GSC OAuth tokens stored encrypted at rest
- DataForSEO/SEMrush API keys stored in Vercel env vars, never in DB
- Keyword data scoped to org with RLS

### Acceptance Criteria
- Connecting GSC imports last 16 months of data within 10 minutes
- Content gap list shows at least all keywords where brand has no top-50 ranking
- Keyword clusters can be manually edited and re-generated
- Bulk CSV import of 1,000 keywords deduplicates and persists within 2 minutes
- Technical SEO score changes when page issues are resolved (re-crawl triggered)

### Definition of Done
GSC connected for at least one test brand. Keyword gap analysis producing results. Clustering algorithm live. DataForSEO integration tested.

---

## EPIC 7: Intent & Query Intelligence
**Status:** PLANNED  
**Depends on:** Epic 4, Epic 6

### Purpose
Map the full buying journey for a brand's products and generate the complete universe of queries a buyer might use at each stage — awareness, consideration, evaluation, and purchase. These query universes power AI prompt generation, content planning, and gap analysis.

### Business Problem
SEO keyword lists reflect historical search behavior but miss conversational AI queries, long-tail buyer questions, and intent-specific phrasing. BeBest must model buyer intent to generate prompts that mirror how real buyers ask AI models for recommendations.

### Key User Stories
- As a user, I want to see the buying journey mapped for my product category so that I understand what my buyers are thinking at each stage.
- As a user, I want a list of all questions buyers ask about my product type so that I can create content that answers them.
- As a user, I want queries grouped by intent stage so that I can target awareness vs. decision-stage content separately.
- As a platform, I want to auto-generate a query universe from brand data so that prompt runners always have fresh input without manual curation.

### Functional Requirements
- Buying journey model: 4 stages (Awareness, Consideration, Evaluation, Purchase) with configurable sub-stages
- `buyer_journeys` table: id, brand_id, product_id, stage, persona, query, intent_type, generated_by (user|ai), created_at
- Query universe generation: given brand + product + use_case, call AI to generate 50–200 representative queries per product per stage
- Intent classification: classify each query as informational, navigational, commercial, or transactional
- Query deduplication and semantic clustering (embedding-based similarity)
- Manual query editing: users can add, edit, delete, or override any query
- Query universe used as seed input for Epic 9 (AI Visibility Engine prompt runner)
- Volume enrichment: match generated queries against keyword database for volume/difficulty data where available
- Export query universe as CSV or JSON

### Non-Functional Requirements
- Query generation for one product: < 60 seconds end-to-end
- Embeddings stored as pgvector vectors for semantic search
- Query universe refresh: monthly, or on brand data change

### API Endpoints
- `POST /api/brands/:brandId/journeys/generate` — generate buying journey + query universe
- `GET /api/brands/:brandId/journeys` — list all journey stages and queries
- `POST /api/brands/:brandId/journeys/queries` — add manual query
- `PATCH /api/brands/:brandId/journeys/queries/:queryId` — edit query
- `DELETE /api/brands/:brandId/journeys/queries/:queryId` — delete query
- `GET /api/brands/:brandId/journeys/export` — download CSV/JSON

### Database Entities
- `buyer_journeys`, `query_embeddings` (pgvector)

### Security Requirements
- AI-generated queries scoped to org; never shared across tenants
- Query export requires Editor role minimum

### Acceptance Criteria
- Generating a query universe for one product produces ≥ 50 queries across all 4 stages
- Each query has an assigned intent type
- Duplicate queries (cosine similarity > 0.92) are automatically merged
- Manual queries added by user appear in the universe immediately
- Query universe CSV export is valid and importable

### Definition of Done
Query generation live for at least one test brand. Semantic deduplication working. Query universe feeding Epic 9 prompt runner.

---

## EPIC 8: AI Provider Abstraction
**Status:** PLANNED  
**Depends on:** Epic 1

### Purpose
Build a unified AI provider abstraction layer that routes prompts to Ollama (local), OpenAI, Anthropic, Google Gemini, and Perplexity. Provide a single interface for all AI calls across the platform with model selection, fallback, cost tracking, and rate limiting.

### Business Problem
BeBest must query multiple AI models to measure how each one describes markets and recommends products. Without an abstraction layer, every feature is coupled to a specific provider SDK, making model changes expensive and cross-model comparison impossible.

### Key User Stories
- As an engineer, I want a single `ai.complete(prompt, options)` interface so that I can add new providers without changing calling code.
- As a platform operator, I want to track token usage and cost per provider so that I can manage AI spend.
- As a product manager, I want to add a new AI provider (e.g., Mistral) without rebuilding the prompt runner.
- As an engineer, I want automatic fallback to a secondary provider when the primary is rate-limited so that prompt runs don't fail silently.

### Functional Requirements
- Provider interface: `AIProvider { complete(prompt, options): Promise<AIResponse> }`
- Implementations: OpenAI (GPT-4o, GPT-4o-mini), Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku), Google (Gemini 1.5 Pro, Gemini Flash), Perplexity (sonar-large, sonar-small), Ollama (local, model configurable)
- `ai_providers` table: id, org_id, provider_name, api_key_encrypted, model, is_active, priority, created_at
- Provider registry: load active providers from DB at runtime
- Fallback chain: ordered by priority; if provider returns 429 or 5xx, try next
- Rate limiting: per-provider per-org request limits enforced in Redis
- Cost tracking: `ai_usage` table records tokens_in, tokens_out, model, provider, cost_usd, timestamp
- Streaming support: providers that support streaming return AsyncIterable
- Retry logic: exponential backoff with jitter (3 retries, max 30s)
- Response normalization: all providers return `{ text, model, provider, tokens_in, tokens_out, latency_ms, finish_reason }`

### Non-Functional Requirements
- Provider call timeout: 120 seconds (Perplexity can be slow)
- Cost tracking adds < 5ms overhead per call
- Provider keys never logged or exposed in error messages

### API Endpoints
- `GET /api/ai/providers` — list configured providers for org
- `POST /api/ai/providers` — add provider config (API key)
- `PATCH /api/ai/providers/:providerId` — update priority/model
- `DELETE /api/ai/providers/:providerId` — remove provider
- `GET /api/ai/usage` — token + cost usage report (filterable by date, provider)
- `POST /api/ai/test` — send test prompt to verify provider config

### Database Entities
- `ai_providers`, `ai_usage`

### Security Requirements
- API keys encrypted with AES-256-GCM before storing
- Keys never returned in API responses (write-only)
- Provider test endpoint rate-limited: 5 calls per minute per org

### Acceptance Criteria
- Calling `ai.complete` with provider=openai returns a normalized response
- If OpenAI returns 429, fallback to Anthropic executes automatically within 2 seconds
- Cost is recorded correctly for every AI call (verified against provider billing)
- Adding a new provider persists and is usable for next prompt run
- AI keys are not visible in any API response or log line

### Definition of Done
All 5 providers implemented and tested. Fallback chain verified. Cost tracking live. Provider abstraction used by at least one downstream epic.

---

## EPIC 9: AI Visibility Engine
**Status:** PLANNED  
**Depends on:** Epic 7, Epic 8

### Purpose
Build the core prompt runner that takes the query universe (Epic 7), runs each query against configured AI providers (Epic 8), stores the raw responses, manages the job queue, and handles rate limiting and scheduling. This is the data collection heartbeat of BeBest.

### Business Problem
Measuring AI visibility requires running hundreds or thousands of prompts across multiple AI models on a regular cadence. This cannot be done manually or synchronously. It requires a reliable, observable, cost-controlled async pipeline.

### Key User Stories
- As a platform, I want to run all queries in the universe against all configured AI providers on a weekly schedule so that visibility data stays current.
- As a user, I want to trigger an on-demand visibility run so that I can get fresh data before a presentation.
- As an engineer, I want the prompt queue to handle 10,000 prompts per run without overwhelming AI provider rate limits.
- As a user, I want to see run progress in real time so that I know the pipeline is working.
- As an operator, I want failed prompts retried automatically so that transient API errors don't create gaps in data.

### Functional Requirements
- `prompt_runs` table: id, brand_id, trigger (scheduled|manual), status (queued|running|complete|failed), total_prompts, completed_prompts, started_at, completed_at
- `prompt_jobs` table: id, run_id, query_id, provider_id, status, attempts, last_error, queued_at, completed_at
- `ai_responses` table: id, prompt_job_id, query_id, provider_id, prompt_text, response_text, model, tokens_in, tokens_out, latency_ms, created_at
- Queue: BullMQ with Redis backend; concurrency configurable per provider (default: 5)
- Rate limiting: respect provider-specific rate limits (tokens/min and requests/min)
- Scheduling: cron-based weekly runs per brand; configurable day/time
- On-demand trigger: POST endpoint starts a run immediately, returns run_id for polling
- Progress streaming: SSE endpoint streams completed/total count
- Retry: failed jobs retried up to 3 times with exponential backoff
- Run summary: after completion, aggregate stats (success rate, avg latency, total cost, coverage %)
- Prompt templating: queries wrapped in configurable prompt templates per provider

### Non-Functional Requirements
- Queue processes 1,000 prompts/hour minimum per provider
- No prompt response stored exceeds 50,000 characters (truncate + flag if longer)
- Duplicate run prevention: if a run is already active for a brand, reject new trigger

### API Endpoints
- `POST /api/brands/:brandId/runs` — trigger prompt run
- `GET /api/brands/:brandId/runs` — list all runs
- `GET /api/brands/:brandId/runs/:runId` — run detail + stats
- `GET /api/brands/:brandId/runs/:runId/progress` — SSE stream of progress
- `DELETE /api/brands/:brandId/runs/:runId` — cancel active run
- `GET /api/brands/:brandId/runs/:runId/responses` — paginated raw responses

### Database Entities
- `prompt_runs`, `prompt_jobs`, `ai_responses`

### Security Requirements
- Raw AI responses scoped to org with RLS
- Run cancellation requires Editor role
- Cost cap per run: configurable per org; run paused if exceeded

### Acceptance Criteria
- On-demand run triggers within 5 seconds of API call
- 1,000-prompt run completes within 30 minutes (with default concurrency)
- Failed jobs retry up to 3 times before marking as permanently failed
- SSE progress stream updates at least every 10 seconds
- Run correctly prevents duplicate starts for the same brand
- All responses stored with correct provider, model, and token counts

### Definition of Done
Prompt runner live. Scheduled runs operational for at least one brand. Queue metrics visible in ops dashboard. Cost cap enforced.

---

## EPIC 10: AI Response Intelligence
**Status:** PLANNED  
**Depends on:** Epic 9

### Purpose
Process raw AI responses from the prompt runner to extract structured intelligence: brand mentions, competitor mentions, sentiment, citation sources, recommendation positioning, and visibility scores. Convert unstructured text into queryable signal.

### Business Problem
Raw AI response text has no value until it is analyzed. A response that mentions a competitor three times in a positive context is materially different from one that mentions the brand once neutrally. This epic produces the structured signals that all downstream analytics depend on.

### Key User Stories
- As a user, I want to know how often my brand is mentioned in AI responses so that I can measure my AI visibility.
- As a user, I want sentiment scores for brand mentions so that I can distinguish between positive and neutral mentions.
- As a user, I want to see which sources AI models cite when recommending products in my category so that I know what content to create.
- As a user, I want a visibility score (0–100) per AI provider so that I can track improvement over time.

### Functional Requirements
- Analysis pipeline: triggered after each prompt run completes
- `mention_extractions` table: id, response_id, entity_name, entity_type (brand|competitor|product), mention_count, first_mention_position, sentiment (positive|neutral|negative), sentiment_score (float)
- `citations` table: id, response_id, url, domain, citation_type (link|named_source|implicit), context_snippet
- `visibility_scores` table: id, brand_id, provider_id, run_id, score (0–100), mention_rate, avg_sentiment, avg_position, calculated_at
- Mention extraction: regex + NLP named entity matching against brand entities (from Epic 4)
- Sentiment analysis: per-mention sentiment via AI (batch call to cheap model) or VADER lexicon
- Position scoring: mentions earlier in response score higher than late mentions
- Recommendation detection: detect if brand/competitor is explicitly recommended vs. mentioned
- Citation URL extraction: regex + link parsing from response text
- Score formula: mention_rate × 40 + sentiment_weight × 30 + position_weight × 20 + recommendation_bonus × 10

### Non-Functional Requirements
- Analysis pipeline runs within 30 minutes of run completion
- Batch sentiment analysis costs < $0.01 per 1,000 responses
- pgvector embeddings stored per response for semantic search

### API Endpoints
- `GET /api/brands/:brandId/visibility` — current visibility scores per provider
- `GET /api/brands/:brandId/visibility/history` — score trend over time
- `GET /api/brands/:brandId/mentions` — all brand and competitor mentions
- `GET /api/brands/:brandId/citations` — all cited sources
- `GET /api/brands/:brandId/runs/:runId/analysis` — full analysis for one run

### Database Entities
- `mention_extractions`, `citations`, `visibility_scores`

### Security Requirements
- Analysis results scoped to org with RLS
- Sentiment model calls use platform-level API key (not per-org)

### Acceptance Criteria
- Every AI response has at least one mention extraction record (even if count = 0)
- Visibility score changes correctly between runs when mention count changes
- Citations extracted from responses include domain and context snippet
- Sentiment scores correlate directionally with manual review (spot-check 20 samples)
- Analysis pipeline completes within 30 minutes for a 1,000-response run

### Definition of Done
Analysis pipeline running automatically after each prompt run. Visibility scores populated for at least one brand across 3+ providers. Citation data populated.

---

## EPIC 11: Competitive Intelligence
**Status:** PLANNED  
**Depends on:** Epic 10

### Purpose
Track competitor AI visibility and SEO performance, compute share-of-voice across AI providers and search engines, and surface gaps where competitors appear but the brand does not. This provides the competitive context that makes BeBest's recommendations actionable.

### Business Problem
Knowing your own visibility score is insufficient without knowing how competitors perform. Clients need to understand relative position — who owns the AI recommendation space in their category and why.

### Key User Stories
- As a user, I want to see my AI visibility score compared to competitors so that I understand my relative position.
- As a user, I want to see which queries my competitors appear in that I do not so that I can prioritize closing those gaps.
- As a user, I want share-of-voice data per AI provider so that I can see where I lead and where I trail.
- As a user, I want competitor visibility trends so that I can detect when a competitor is gaining ground.

### Functional Requirements
- Competitor prompt runs: query universe also runs for each tracked competitor domain
- `competitor_visibility` table: id, brand_id, competitor_id, provider_id, run_id, score, mention_rate, avg_sentiment, calculated_at
- Share of voice (SOV): for each query, assign 1 point to each entity mentioned; SOV = entity_points / total_points across all entities
- `share_of_voice` table: id, brand_id, query_id, run_id, entity (brand or competitor), sov_pct, mentions
- Gap analysis: queries where competitor SOV > 0 and brand SOV = 0
- Competitor SEO overlap: using keyword data (Epic 6), show keywords competitor ranks for where brand does not
- Competitive landscape view: matrix of brands × providers with SOV scores
- Trend alerts: flag if competitor score increases by > 10 points week-over-week

### Non-Functional Requirements
- Competitor runs add proportionally to prompt run cost (billed to org's AI usage)
- Competitive matrix renders in < 2 seconds for up to 10 competitors × 5 providers

### API Endpoints
- `GET /api/brands/:brandId/competitive/sov` — share of voice matrix
- `GET /api/brands/:brandId/competitive/gaps` — queries where competitor appears, brand does not
- `GET /api/brands/:brandId/competitive/scores` — competitor visibility scores vs. brand
- `GET /api/brands/:brandId/competitive/trends` — historical SOV trend per competitor
- `GET /api/brands/:brandId/competitive/seo-overlap` — SEO keyword gap vs. competitors

### Database Entities
- `competitor_visibility`, `share_of_voice`

### Security Requirements
- Competitive data scoped to org; competitor scores derived from BeBest's own prompt runs, not shared across orgs

### Acceptance Criteria
- SOV percentages across all entities in a query sum to 100%
- Gap analysis correctly shows zero-SOV queries for the brand
- Competitive landscape matrix renders within 2 seconds for 10 competitors
- Trend alert triggers when competitor score rises > 10 points week-over-week
- Competitor visibility scores update after each prompt run

### Definition of Done
Competitive matrix live for at least one brand with 3+ competitors. SOV calculation verified manually. Gap analysis producing results.

---

## EPIC 12: Unified SEO + GEO Opportunity Engine
**Status:** PLANNED  
**Depends on:** Epic 6, Epic 10, Epic 11

### Purpose
Combine SEO keyword intelligence (search engine visibility) and GEO (Generative Engine Optimization — AI model visibility) into a single unified opportunity score. Surface the highest-ROI opportunities that improve performance on both traditional search and AI recommendation engines simultaneously.

### Business Problem
SEO and GEO are typically treated as separate disciplines with separate tools. BeBest's differentiation is the unified view — opportunities that win on Google AND on ChatGPT. Without this synthesis, clients must choose between channels. BeBest shows where they can win both.

### Key User Stories
- As a user, I want a ranked list of opportunities that improve both my Google rankings and my AI visibility so that I can prioritize efforts with the highest cross-channel impact.
- As a user, I want to see which terms have high search volume but low AI visibility so that I can target them for content that serves both channels.
- As a user, I want a unified opportunity score so that I don't need to manually reconcile two separate dashboards.

### Functional Requirements
- `opportunities` table: id, brand_id, keyword_or_query, seo_gap_score, geo_gap_score, unified_score, volume, difficulty, priority_tier (P1|P2|P3), created_at
- Opportunity scoring formula: `unified_score = (seo_gap_score × 0.5) + (geo_gap_score × 0.5)`, adjusted by volume × (1 - difficulty)
- SEO gap score: 0–100 based on current ranking position (or absence)
- GEO gap score: 0–100 based on inverse of brand SOV in AI responses for that query
- Opportunity tiers: P1 (score ≥ 70), P2 (40–69), P3 (< 40)
- Opportunity refresh: recalculated after each SEO data refresh or AI prompt run
- Filtering: by tier, by topic cluster, by intent stage, by estimated traffic impact
- Opportunity detail page: shows SEO data + GEO data + recommended action type

### Non-Functional Requirements
- Opportunity list renders in < 1 second (paginated, 50 per page)
- Recalculation for 10,000 opportunities completes in < 5 minutes

### API Endpoints
- `GET /api/brands/:brandId/opportunities` — list all opportunities (filterable, sortable)
- `GET /api/brands/:brandId/opportunities/:opportunityId` — opportunity detail
- `POST /api/brands/:brandId/opportunities/recalculate` — trigger recalculation
- `GET /api/brands/:brandId/opportunities/summary` — count by tier, avg scores

### Database Entities
- `opportunities`

### Security Requirements
- Opportunities scoped to org with RLS

### Acceptance Criteria
- Unified score ranks P1 opportunities higher than P2 correctly
- An opportunity where brand ranks #1 on Google but has 0% AI SOV shows high GEO gap score
- Opportunity list filters by tier return correct subsets
- Recalculation runs within 5 minutes for 10,000 rows

### Definition of Done
Opportunities populated for at least one brand. Scoring formula verified manually. Filtering UI live.

---

## EPIC 13: GEO Gap Engine
**Status:** PLANNED  
**Depends on:** Epic 10, Epic 12

### Purpose
Identify specific gaps in AI model visibility: queries where competitors are recommended but the brand is not, topics where AI models have no knowledge of the brand, and content/citation deficiencies that explain low AI visibility. Produce a prioritized gap list with root-cause explanations.

### Business Problem
A low GEO score is a symptom, not a diagnosis. Clients need to know *why* AI models don't recommend them — is it missing content? Missing citations? Wrong positioning? The GEO Gap Engine provides that root-cause analysis.

### Key User Stories
- As a user, I want to know which specific queries AI models never mention my brand so that I know where I'm invisible.
- As a user, I want to understand why AI models don't mention me — is it because there's no content, or because the content isn't cited? So that I know which action to take.
- As a user, I want gaps ranked by business impact so that I address the highest-value gaps first.

### Functional Requirements
- `geo_gaps` table: id, brand_id, query_id, provider_id, gap_type (no_mention|low_sentiment|no_citation|competitor_only), severity, root_cause_hypothesis, recommended_action, business_impact_score
- Gap types:
  - `no_mention`: brand never appears in responses for this query
  - `low_sentiment`: brand mentioned but negatively
  - `no_citation`: brand mentioned but no citation to brand content
  - `competitor_only`: competitor mentioned positively, brand not mentioned
- Root cause analysis: compare query topic against brand content (from Epic 5) — if no page covers the topic, root_cause = "missing content"
- Business impact score: volume × (1 - current_SOV) × intent_weight
- Gap recommendations: each gap type maps to a standard recommended action
- Gap list view: filterable by gap type, provider, topic cluster, business impact

### Non-Functional Requirements
- Gap analysis runs within 15 minutes of prompt run completion
- Gap list of 5,000 items renders in < 1 second

### API Endpoints
- `GET /api/brands/:brandId/geo-gaps` — list GEO gaps (filterable)
- `GET /api/brands/:brandId/geo-gaps/:gapId` — gap detail with root cause
- `GET /api/brands/:brandId/geo-gaps/summary` — counts by type and severity
- `POST /api/brands/:brandId/geo-gaps/dismiss/:gapId` — mark gap as accepted/dismissed

### Database Entities
- `geo_gaps`

### Security Requirements
- Gaps scoped to org with RLS

### Acceptance Criteria
- Every query with zero brand mentions has a corresponding `no_mention` gap record
- Root cause correctly identifies "missing content" when no brand page covers the topic
- Business impact scores rank competitor-only gaps for high-volume commercial queries at P1
- Gap dismissal persists and dismissed gaps are excluded from active gap count

### Definition of Done
Gap engine running after each prompt run. Root cause populated for ≥ 80% of gaps. Gap recommendations linked to Epic 14 (Recommendation Engine).

---

## EPIC 14: Recommendation Engine
**Status:** PLANNED  
**Depends on:** Epic 12, Epic 13

### Purpose
Generate prioritized, specific, actionable recommendations from the opportunity and gap data. Each recommendation tells the user exactly what to do, why, and what outcome to expect. Recommendations are ranked by ROI and assigned to the appropriate action type (create, optimize, build, earn).

### Business Problem
Opportunity data is valuable only if it drives action. Without a recommendation layer, users face a dashboard of scores with no clear next step. The Recommendation Engine closes the loop between analysis and action.

### Key User Stories
- As a user, I want a ranked to-do list of recommendations so that I always know what to work on next.
- As a user, I want each recommendation to tell me the expected outcome so that I can justify the work.
- As a user, I want recommendations categorized by action type so that I can assign them to the right team member.
- As a user, I want to dismiss or snooze recommendations so that I can manage my action list.

### Functional Requirements
- `recommendations` table: id, brand_id, opportunity_id, gap_id, rec_type (create_content|optimize_page|build_citation|earn_link|improve_entity|update_schema), title, rationale, expected_impact, effort_estimate (low|medium|high), roi_score, status (active|dismissed|snoozed|completed), created_at
- Recommendation generation rules:
  - `no_mention` gap + no brand page on topic → `create_content`
  - `no_citation` gap + existing page → `build_citation`
  - Low-ranking SEO keyword + existing page → `optimize_page`
  - High-volume keyword with no page → `create_content`
  - Competitor with strong citations → `earn_link`
- ROI score: expected_impact × (1 / effort_weight)
- Recommendation detail: shows triggering gap/opportunity, suggested headline, and links to content tools
- Bulk actions: dismiss all P3, snooze all by type
- Completion: link recommendation to published content or resolved issue (Epic 21)

### Non-Functional Requirements
- Recommendation list of 500 items renders in < 1 second
- New recommendations generated within 15 minutes of gap engine run

### API Endpoints
- `GET /api/brands/:brandId/recommendations` — list recommendations (filterable by type, status, priority)
- `GET /api/brands/:brandId/recommendations/:recId` — recommendation detail
- `PATCH /api/brands/:brandId/recommendations/:recId` — update status (dismiss/snooze/complete)
- `POST /api/brands/:brandId/recommendations/generate` — re-generate recommendations
- `GET /api/brands/:brandId/recommendations/summary` — counts by type and priority

### Database Entities
- `recommendations`

### Security Requirements
- Recommendations scoped to org with RLS
- Generating recommendations requires Editor role

### Acceptance Criteria
- Every P1 gap has at least one corresponding recommendation
- ROI scores correctly rank low-effort/high-impact recs above high-effort/low-impact ones
- Dismissing a recommendation removes it from the active list immediately
- Snoozing a recommendation for 7 days reactivates it after 7 days
- Completing a recommendation links to the published content record

### Definition of Done
Recommendations generating automatically after each gap engine run. ROI ranking verified. UI live with filtering and bulk actions.

---

## EPIC 15: Content Intelligence
**Status:** PLANNED  
**Depends on:** Epic 5, Epic 7, Epic 14

### Purpose
Analyze existing brand content for quality, completeness, topical authority, and AI-readiness. Score each page on its ability to influence AI model responses. Identify content that needs improvement before new content is created.

### Business Problem
Creating new content when existing content is weak is wasteful. Many brands have pages that cover the right topics but are written in ways that AI models cannot extract or cite. Content Intelligence audits existing assets and tells users which to fix before what to create.

### Key User Stories
- As a user, I want each crawled page scored for AI-readiness so that I can prioritize which pages to improve.
- As a user, I want to see which pages have thin content so that I know what to expand.
- As a user, I want to know if my existing pages are structured for AI citation so that I can add structured data where needed.
- As a user, I want a content gap map showing topics I have no page for so that I can brief new content.

### Functional Requirements
- `content_analyses` table: id, page_id, brand_id, ai_readiness_score, thin_content_flag, topic_coverage_score, structured_data_present, word_count, reading_level, entity_density, citations_found_in_ai_responses, analyzed_at
- AI-readiness score (0–100): combines word_count weight + structured_data weight + entity_density weight + citations_found weight
- Thin content flag: word_count < 500 or topic_coverage < 30
- Topic coverage score: cosine similarity between page content embedding and target query cluster embedding
- Structured data check: detect JSON-LD, OpenGraph, FAQ schema, HowTo schema
- Entity density: count of brand entities (products, people, use cases) per 500 words
- Content gap map: query clusters with no brand page having topic_coverage_score > 50
- Page improvement suggestions: per page, list top 3 improvements ranked by score impact

### Non-Functional Requirements
- Content analysis runs within 2 hours of a crawl job completing
- Page embeddings stored in pgvector for semantic search

### API Endpoints
- `GET /api/brands/:brandId/content` — list all pages with analysis scores
- `GET /api/brands/:brandId/content/:pageId` — single page analysis detail
- `GET /api/brands/:brandId/content/gaps` — topic coverage gaps
- `GET /api/brands/:brandId/content/improvements` — top improvement opportunities ranked by score impact

### Database Entities
- `content_analyses`

### Security Requirements
- Content analysis data scoped to org with RLS

### Acceptance Criteria
- Every crawled page has a corresponding content analysis record after analysis run
- AI-readiness score increases when structured data is added to a page (verified on re-crawl)
- Thin content flag is set for all pages with word_count < 500
- Content gap map correctly identifies query clusters with no matching brand page

### Definition of Done
Content analysis pipeline running after each crawl. AI-readiness scores live in UI. Content gap map populated for at least one brand.

---

## EPIC 16: Content Generation
**Status:** PLANNED  
**Depends on:** Epic 8, Epic 14, Epic 15

### Purpose
Generate AI-assisted content — blog posts, landing pages, FAQ sections, structured data, entity descriptions — based on recommendations and gaps. Content generation is guided by brand voice, SEO requirements, and GEO optimization principles.

### Business Problem
Identifying what content to create is only half the work. BeBest accelerates execution by generating first drafts that are already optimized for both search engines and AI models, reducing time-to-publish from weeks to hours.

### Key User Stories
- As a user, I want to generate a blog post draft from a recommendation so that I have a starting point in minutes.
- As a user, I want generated content to match my brand voice so that I don't need to rewrite it entirely.
- As a user, I want structured data (JSON-LD) generated for my pages so that AI models can parse and cite them correctly.
- As a user, I want FAQ sections generated from my query universe so that my pages answer buyer questions directly.
- As an editor, I want a rich-text editor to refine AI-generated drafts before publishing.

### Functional Requirements
- Content types: blog post, landing page, FAQ section, product description, entity bio, JSON-LD schema, meta title + description
- `content_drafts` table: id, brand_id, recommendation_id, content_type, title, body_md, seo_title, seo_description, structured_data_json, status (draft|review|approved|published), word_count, ai_model_used, created_at, updated_at
- Generation input: recommendation + brand profile + brand voice guide + target keyword + target query cluster
- Brand voice guide: onboarding step; user describes tone, style, avoid list; stored per brand
- Generation prompt templates: per content type, optimized for GEO (answer-first format, entity-dense, FAQ blocks, citations requested)
- Rich-text editor: Tiptap or Lexical with Markdown output
- SEO metadata auto-generated with each draft (title tag < 60 chars, meta < 160 chars)
- JSON-LD generation: Article, FAQPage, Product, Organization schema per content type
- Content scoring: after generation, run content through Epic 15 analysis and show predicted AI-readiness score
- Revision history: every save creates a new version in `content_draft_versions`

### Non-Functional Requirements
- Blog post generation (1,500 words) completes in < 45 seconds
- Editor autosaves every 30 seconds
- Content drafts stored indefinitely; versions pruned to last 10 per draft

### API Endpoints
- `POST /api/brands/:brandId/content/generate` — generate content draft from recommendation
- `GET /api/brands/:brandId/content/drafts` — list all drafts
- `GET /api/brands/:brandId/content/drafts/:draftId` — get draft with latest version
- `PATCH /api/brands/:brandId/content/drafts/:draftId` — update draft (triggers new version)
- `POST /api/brands/:brandId/content/drafts/:draftId/approve` — mark as approved
- `GET /api/brands/:brandId/content/drafts/:draftId/versions` — list versions
- `GET /api/brands/:brandId/content/drafts/:draftId/score` — predicted AI-readiness score

### Database Entities
- `content_drafts`, `content_draft_versions`, `brand_voice_guides`

### Security Requirements
- Drafts scoped to org with RLS
- Approved drafts cannot be deleted, only archived
- Generation requires Editor role

### Acceptance Criteria
- Blog post generated from recommendation contains target keyword in title and at least 3 times in body
- Generated content passes the brand voice check (configurable keyword avoid list has no hits)
- JSON-LD schema validates against schema.org spec (tool: schema.org validator)
- Predicted AI-readiness score ≥ 70 for generated blog posts on first draft
- Revision history shows all edits with timestamps

### Definition of Done
Generation live for at least 3 content types. Rich-text editor working. AI-readiness score shown on drafts. Version history functional.

---

## EPIC 17: GEO Agent
**Status:** PLANNED  
**Depends on:** Epic 13, Epic 16

### Purpose
An autonomous agent that continuously monitors GEO gaps, selects the highest-priority gaps to close, generates content recommendations and drafts, and queues them for human review. The GEO Agent acts as an always-on GEO strategist that never misses a gap.

### Business Problem
Manually reviewing hundreds of GEO gaps and deciding which to address is time-consuming and requires expertise most clients don't have. The GEO Agent automates the triage and first-draft production loop, reducing the cognitive load on the user to review and approve.

### Key User Stories
- As a user, I want the GEO Agent to automatically surface new content recommendations each week so that I always have a prioritized action list without doing the analysis myself.
- As a user, I want the agent to generate draft content for its top recommendations so that I can approve and publish with minimal effort.
- As a user, I want to set agent guardrails (max drafts per week, content types to generate) so that I control the output volume.

### Functional Requirements
- `geo_agent_runs` table: id, brand_id, run_id (prompt run that triggered), gaps_processed, recommendations_created, drafts_generated, status, started_at, completed_at
- Agent loop: after each prompt run → analyze new gaps → score by business impact → top N gaps → create recommendations → generate drafts for P1 recommendations
- Agent config per brand: max_drafts_per_run (default 3), content_types_enabled, auto_generate_drafts (bool), notify_on_complete (bool)
- Agent run log: human-readable log of decisions made ("Selected gap X because SOV=0 and volume=1,200")
- Human-in-the-loop: all generated drafts go to status=draft; agent cannot approve or publish
- Agent guardrails: budget cap per run (max $N in AI spend)

### Non-Functional Requirements
- GEO Agent run completes within 30 minutes of prompt run completion
- Agent decisions are logged with enough detail to audit

### API Endpoints
- `GET /api/brands/:brandId/geo-agent/config` — get agent config
- `PATCH /api/brands/:brandId/geo-agent/config` — update config
- `GET /api/brands/:brandId/geo-agent/runs` — list agent runs
- `GET /api/brands/:brandId/geo-agent/runs/:runId` — run detail with decision log
- `POST /api/brands/:brandId/geo-agent/trigger` — manual trigger

### Database Entities
- `geo_agent_runs`, `geo_agent_configs`

### Security Requirements
- Agent cannot publish without human approval
- Budget cap enforced before any AI generation call

### Acceptance Criteria
- Agent run triggers automatically within 5 minutes of prompt run completion
- Agent generates no more than `max_drafts_per_run` drafts per run
- Decision log is readable and explains each gap selected
- Agent respects content_types_enabled config
- All drafts created by agent have status=draft

### Definition of Done
GEO Agent running automatically for at least one brand for 2+ consecutive weekly cycles. Decision logs verified. Human approval gate confirmed.

---

## EPIC 18: SEO Agent
**Status:** PLANNED  
**Depends on:** Epic 6, Epic 16

### Purpose
An autonomous agent that monitors SEO opportunities, identifies pages to optimize, generates optimization recommendations, and produces revised content and metadata. Mirrors the GEO Agent but for traditional search engine optimization.

### Business Problem
SEO optimization is repetitive, data-driven work that is well-suited to automation. Most brands have hundreds of pages that could rank higher with targeted optimization but lack the bandwidth to address them all.

### Key User Stories
- As a user, I want the SEO Agent to identify which existing pages I should optimize each week so that I don't need to manually review rankings.
- As a user, I want the agent to generate revised meta titles and descriptions so that I can approve them in one click.
- As a user, I want the agent to suggest internal linking opportunities so that my site architecture improves automatically.

### Functional Requirements
- `seo_agent_runs` table: id, brand_id, pages_analyzed, recommendations_created, drafts_generated, status, started_at, completed_at
- Agent loop: after each crawl + keyword refresh → identify pages with rankings 4–20 (quick-win zone) → generate optimization recommendations → produce revised metadata and content suggestions
- Optimization types: meta title rewrite, meta description rewrite, H1 rewrite, content expansion, internal link addition, schema addition
- Agent config: max_pages_per_run, optimization_types_enabled, auto_generate_revisions
- Quick-win targeting: prioritize keywords ranking 4–20 with volume > 100
- Internal link suggestions: pages with related topic clusters that don't link to each other

### Non-Functional Requirements
- SEO Agent run completes within 20 minutes after crawl/keyword refresh
- Meta rewrites stay within character limits (title ≤ 60, description ≤ 160)

### API Endpoints
- `GET /api/brands/:brandId/seo-agent/config` — get agent config
- `PATCH /api/brands/:brandId/seo-agent/config` — update config
- `GET /api/brands/:brandId/seo-agent/runs` — list runs
- `POST /api/brands/:brandId/seo-agent/trigger` — manual trigger

### Database Entities
- `seo_agent_runs`, `seo_agent_configs`

### Security Requirements
- Agent cannot modify live pages without explicit publishing action (Epic 21)

### Acceptance Criteria
- Agent identifies all pages with target keywords ranking 4–20
- Generated meta titles are ≤ 60 characters
- Internal link suggestions connect topically related pages not currently linked
- Agent run completes within 20 minutes

### Definition of Done
SEO Agent running weekly. Meta revision drafts appearing in content queue. Internal link suggestions live.

---

## EPIC 19: Unified Growth Agent
**Status:** PLANNED  
**Depends on:** Epic 17, Epic 18

### Purpose
Orchestrate the GEO Agent and SEO Agent into a single unified growth loop. The Unified Growth Agent coordinates both agents, prevents conflicting recommendations, prioritizes across both channels, and produces a single weekly growth brief for the user.

### Business Problem
Running GEO and SEO agents independently creates conflicts — both agents might target the same page with different recommendations, or create content for the same topic independently. The Unified Growth Agent is the single brain that coordinates all growth actions.

### Key User Stories
- As a user, I want a single weekly growth brief that tells me the top 5 actions across SEO and GEO so that I have one prioritized to-do list.
- As a user, I want the platform to detect when SEO and GEO opportunities align so that I can create content that wins on both channels.
- As a platform, I want to prevent duplicate recommendations for the same page from both agents so that users aren't confused.

### Functional Requirements
- `growth_briefs` table: id, brand_id, week_start, top_actions (jsonb), seo_score_delta, geo_score_delta, published_at
- Unified agent run: after both SEO and GEO agent runs complete → merge recommendation lists → deduplicate (same page or same topic) → rank by unified ROI score → produce weekly brief
- Conflict resolution: if SEO agent says "expand page X" and GEO agent says "rewrite page X," merge into one "optimize and expand page X" recommendation
- Weekly brief format: top 5 actions, each with type, expected impact, effort, and link to draft or tool
- Brief delivery: email + in-app notification
- Historical briefs: archived and accessible

### Non-Functional Requirements
- Unified agent run completes within 10 minutes after both sub-agents complete
- Brief email delivered within 5 minutes of brief generation

### API Endpoints
- `GET /api/brands/:brandId/growth-briefs` — list all briefs
- `GET /api/brands/:brandId/growth-briefs/latest` — current week's brief
- `GET /api/brands/:brandId/growth-briefs/:briefId` — historical brief

### Database Entities
- `growth_briefs`

### Security Requirements
- Briefs scoped to org; delivery only to verified org member emails

### Acceptance Criteria
- Unified brief contains exactly 5 top actions
- Duplicate recommendations from both agents are merged into one
- Brief email arrives within 5 minutes of generation
- Historical briefs accessible for at least 12 months

### Definition of Done
Unified agent live. Weekly brief generating and delivering via email. Deduplication verified with test data.

---

## EPIC 20: Action Center
**Status:** PLANNED  
**Depends on:** Epic 14, Epic 19

### Purpose
Build the central UI for users to manage all recommendations, tasks, and actions across SEO, GEO, and growth activities. The Action Center is the user's primary daily workspace — a prioritized queue of things to do with full context, quick actions, and status tracking.

### Business Problem
Recommendations in isolation have limited value. Users need a single place to see everything, triage quickly, delegate tasks, and track what's been done. Without the Action Center, insights are scattered across five different sections.

### Key User Stories
- As a user, I want to see all pending actions in a single prioritized inbox so that I know what to work on today.
- As a user, I want to filter actions by type, effort, and priority so that I can batch similar work.
- As a user, I want to assign actions to team members so that work is delegated clearly.
- As a user, I want to see completed actions with their outcomes so that I can measure progress.

### Functional Requirements
- Unified action feed: combines recommendations (Epic 14), agent suggestions (Epics 17–19), and manual tasks
- `actions` table: id, brand_id, source (recommendation|agent|manual), source_id, title, description, action_type, priority, effort, assignee_user_id, status (pending|in_progress|completed|dismissed), due_date, completed_at
- Views: All, My Tasks, Unassigned, Completed, By Type
- Quick actions per item: Assign, Start, Complete, Dismiss, Snooze
- Bulk actions: assign selected, dismiss selected
- Kanban-style board view option (Pending → In Progress → Done)
- Action detail panel: shows full context (gap data, recommendation rationale, linked draft)
- Activity log per action: status changes with timestamp and user

### Non-Functional Requirements
- Action feed loads in < 1 second for up to 500 items
- Real-time status updates via SSE or WebSocket when team members change action status

### API Endpoints
- `GET /api/brands/:brandId/actions` — list actions (filterable)
- `POST /api/brands/:brandId/actions` — create manual action
- `PATCH /api/brands/:brandId/actions/:actionId` — update action (status, assignee, etc.)
- `DELETE /api/brands/:brandId/actions/:actionId` — delete manual action
- `POST /api/brands/:brandId/actions/bulk` — bulk status update

### Database Entities
- `actions`, `action_activity`

### Security Requirements
- Actions scoped to org with RLS
- Assigning to a user requires that user to be an org member

### Acceptance Criteria
- All recommendations from Epic 14 appear as pending actions automatically
- Assigning an action to a team member sends them a notification
- Completing an action links to the published content or resolved issue
- Bulk dismiss of 50 actions completes in < 3 seconds
- Kanban board accurately reflects current status counts

### Definition of Done
Action Center live. All recommendation types surfaced. Assignment and notification tested. Kanban view functional.

---

## EPIC 21: Controlled Publishing
**Status:** PLANNED  
**Depends on:** Epic 16, Epic 20

### Purpose
Enable users to publish approved content drafts to their website via CMS integrations (WordPress, Webflow, Contentful, Ghost) or generate export files. Publishing is always human-triggered and includes a pre-publish checklist.

### Business Problem
Generated content has no value until it's live. BeBest must close the loop from draft to published page. Without publishing integration, users must manually copy content into their CMS, breaking the workflow and losing attribution.

### Key User Stories
- As a user, I want to connect my WordPress site so that I can publish approved drafts with one click.
- As a user, I want a pre-publish checklist so that I don't accidentally publish content with missing SEO elements.
- As a user, I want to export content as Markdown or HTML when CMS integration isn't available.
- As a user, I want to see all published content and its performance metrics so that I can measure the impact.

### Functional Requirements
- CMS integrations: WordPress (REST API + application passwords), Webflow (Data API), Contentful (Management API), Ghost (Admin API)
- `cms_connections` table: id, org_id, brand_id, cms_type, api_key_encrypted, site_url, connection_status, last_tested_at
- `publications` table: id, draft_id, brand_id, cms_connection_id, cms_post_id, published_url, status (pending|published|failed), published_at
- Pre-publish checklist: seo_title present, seo_description present, structured_data_valid, word_count ≥ 500, target_keyword present in title
- Publish flow: user clicks Publish → checklist shown → if all pass, one-click publish → CMS API called → publication record created
- Export formats: Markdown, HTML, plain text
- Post-publish: crawl the published URL within 24 hours; update AI-readiness score
- Published content dashboard: table of all publications with published_at, url, and (after next prompt run) AI visibility impact

### Non-Functional Requirements
- CMS API call timeout: 30 seconds
- Published URL tracked and included in next crawl run automatically

### API Endpoints
- `POST /api/brands/:brandId/cms/connect` — add CMS connection
- `GET /api/brands/:brandId/cms/connections` — list connections
- `DELETE /api/brands/:brandId/cms/connections/:connectionId` — remove connection
- `POST /api/brands/:brandId/content/drafts/:draftId/publish` — publish to CMS
- `GET /api/brands/:brandId/content/drafts/:draftId/checklist` — pre-publish checklist
- `GET /api/brands/:brandId/publications` — list all publications
- `GET /api/brands/:brandId/content/drafts/:draftId/export` — download draft

### Database Entities
- `cms_connections`, `publications`

### Security Requirements
- CMS API keys encrypted at rest
- Publishing requires Admin or Editor role
- Pre-publish checklist cannot be bypassed by API

### Acceptance Criteria
- WordPress connection authenticated and tested successfully
- Pre-publish checklist blocks publish if seo_title is missing
- Published post appears in WordPress within 30 seconds of publish action
- Published URL appears in next crawl job's seed list
- Export as Markdown produces valid Markdown that renders correctly

### Definition of Done
WordPress and Webflow integrations live and tested. Pre-publish checklist enforced. Export functional for all formats.

---

## EPIC 22: Measurement & Experimentation
**Status:** PLANNED  
**Depends on:** Epic 9, Epic 21

### Purpose
Measure the impact of published content and optimizations on both SEO rankings and AI visibility. Run controlled experiments to validate that specific changes cause measurable improvements.

### Business Problem
Without measurement, BeBest cannot prove its value. Clients need to see before/after data that directly connects BeBest's actions to ranking and visibility improvements. Experimentation separates signal from noise.

### Key User Stories
- As a user, I want to see how my AI visibility score has changed since I published new content so that I can attribute improvement to specific actions.
- As a user, I want to run an A/B experiment on page optimization so that I know which version performs better in AI responses.
- As a user, I want a time-series chart of my visibility score so that I can show trends to stakeholders.

### Functional Requirements
- `experiments` table: id, brand_id, name, type (geo|seo|content), control_url, variant_url, start_date, end_date, status, hypothesis, result_summary
- `measurements` table: id, brand_id, metric (geo_score|seo_position|sov_pct|impression_count), entity_id, value, measured_at
- Attribution: link measurement delta to action_id from Epic 20 (action completed → start measuring)
- GEO experiment: run same query against old and new content embedding; compare mention rates
- SEO experiment: track position changes for target keyword after page optimization
- Statistical significance: report confidence level using z-test when sufficient data
- Impact dashboard: for each completed action, show delta in relevant metrics
- Trend charts: 90-day rolling window for all KPIs

### Non-Functional Requirements
- Measurement data retained for 24 months
- Charts render in < 2 seconds

### API Endpoints
- `POST /api/brands/:brandId/experiments` — create experiment
- `GET /api/brands/:brandId/experiments/:expId` — experiment results
- `GET /api/brands/:brandId/measurements` — historical measurements
- `GET /api/brands/:brandId/impact/:actionId` — impact attributed to one action

### Database Entities
- `experiments`, `measurements`

### Security Requirements
- Measurement data scoped to org with RLS

### Acceptance Criteria
- Completing an action in Epic 20 triggers measurement start within 24 hours
- Impact dashboard shows before/after visibility score for each completed action
- Experiment reports statistical significance when N ≥ 100 samples
- Trend chart displays correct 90-day window

### Definition of Done
Measurement pipeline live. Impact attribution working for at least 5 completed actions. Experiment framework tested.

---

## EPIC 23: Continuous Learning Loop
**Status:** PLANNED  
**Depends on:** Epic 22

### Purpose
Feed measurement and experiment results back into the recommendation and generation engines so that BeBest improves over time. Content types that drive visibility improvements get higher priority; prompts that produce unreliable data are flagged for revision.

### Business Problem
A static recommendation engine gives the same advice regardless of what worked or didn't work. BeBest must learn from outcomes to become more accurate and more useful over time.

### Key User Stories
- As a platform, I want to increase the ROI score of recommendation types that have a proven track record of improving visibility so that future recommendations prioritize what works.
- As a platform, I want to flag prompt templates that produce low-quality responses so that I can refine them.
- As a user, I want BeBest to learn my brand's patterns so that recommendations become more precise over time.

### Functional Requirements
- `learning_events` table: id, brand_id, event_type (action_completed|measurement_recorded|experiment_concluded), entity_id, signal (positive|negative|neutral), magnitude, created_at
- Feedback loop: after measurement delta calculated → if delta > threshold → record positive learning event for that recommendation type
- ROI score adjustment: recommendation types with consistent positive learning events get ROI multiplier boosted (max 1.5×)
- Prompt quality scoring: prompts that generate responses with low extraction confidence are flagged for review
- Brand pattern learning: track which content types, formats, and topics have historically performed well per brand
- Learning reports: quarterly summary of what the system has learned (for admin review)

### Non-Functional Requirements
- Learning events processed within 1 hour of triggering measurement
- ROI multiplier adjustments bounded to prevent runaway scores

### API Endpoints
- `GET /api/brands/:brandId/learning/summary` — learning summary report
- `GET /api/brands/:brandId/learning/events` — raw learning event log (admin only)
- `POST /api/brands/:brandId/learning/reset` — reset learned adjustments (admin only)

### Database Entities
- `learning_events`, `learning_adjustments`

### Security Requirements
- Learning reset requires Admin role
- Learning events cannot be manually injected via API

### Acceptance Criteria
- After 3 positive measurement events for a recommendation type, ROI multiplier increases
- Prompt flagged for low confidence appears in admin review queue
- Learning summary accurately reflects the last 90 days of events
- Learning reset successfully clears all multiplier adjustments

### Definition of Done
Learning events recording automatically. ROI multiplier adjustments live. Admin review queue for flagged prompts functional.

---

## EPIC 24: Reporting
**Status:** PLANNED  
**Depends on:** Epic 10, Epic 11, Epic 22

### Purpose
Generate scheduled and on-demand reports that summarize AI visibility, competitive position, SEO performance, and growth actions. Reports are formatted for sharing with stakeholders and clients who don't have platform access.

### Business Problem
BeBest's clients need to share results with leadership, boards, and clients. The platform must produce polished, shareable reports that require no manual formatting.

### Key User Stories
- As a user, I want a weekly AI visibility report emailed to me so that I can stay informed without logging in.
- As an agency, I want to generate a client report as a PDF so that I can present it in meetings.
- As a user, I want to customize which metrics appear in reports so that reports are relevant to each stakeholder.

### Functional Requirements
- Report types: Weekly Digest, Monthly Summary, Competitive Landscape, GEO Progress, SEO Progress, Custom
- `reports` table: id, brand_id, report_type, config jsonb, generated_at, file_url, status
- Report generation: server-side HTML → PDF via Puppeteer or @vercel/og
- Scheduled delivery: weekly/monthly via email
- Custom report builder: user selects metrics and date range
- Public share link: time-limited (30 days) share URL for reports without requiring login
- White-label ready: header/footer uses org branding (logo, colors) — prerequisite for Epic 31

### Non-Functional Requirements
- PDF generation completes in < 30 seconds
- Report files stored in Vercel Blob; URLs expire after 7 days unless shared

### API Endpoints
- `POST /api/brands/:brandId/reports/generate` — generate report
- `GET /api/brands/:brandId/reports` — list reports
- `GET /api/brands/:brandId/reports/:reportId/download` — get download URL
- `POST /api/brands/:brandId/reports/:reportId/share` — generate share link
- `PATCH /api/brands/:brandId/reports/schedule` — configure scheduled delivery

### Database Entities
- `reports`, `report_schedules`

### Security Requirements
- Share links are time-limited and single-origin
- PDF generation runs server-side only
- Report access requires org membership (unless shared link)

### Acceptance Criteria
- Weekly digest email delivered on Monday morning for configured brands
- PDF renders correctly with all charts and tables
- Share link expires after 30 days and returns 404
- Custom report with 3 selected metrics generates correctly

### Definition of Done
Weekly email delivery live. PDF generation working. Share link tested. White-label header applied.

---

## EPIC 25: Notifications
**Status:** PLANNED  
**Depends on:** Epic 1, Epic 9

### Purpose
Deliver timely, relevant notifications to users via email and in-app channels. Notifications cover prompt run completion, new recommendations, score changes, competitor alerts, and agent actions.

### Business Problem
Users cannot monitor the platform continuously. Proactive notifications ensure they act on insights while they're fresh and don't miss critical alerts like a competitor's sudden score increase.

### Key User Stories
- As a user, I want an email when my weekly prompt run completes so that I know new data is ready.
- As a user, I want an in-app notification when a competitor's AI visibility score increases significantly so that I can respond.
- As a user, I want to configure which notifications I receive so that I'm not overwhelmed.

### Functional Requirements
- `notifications` table: id, user_id, org_id, type, title, body, read_at, action_url, created_at
- `notification_preferences` table: user_id, notification_type, channel (email|in_app), enabled
- Notification types: run_complete, new_recommendations, competitor_alert, score_change, agent_action, report_ready, action_assigned, billing_alert
- Email delivery via Resend; in-app notifications via SSE or WebSocket
- Notification center UI: bell icon with unread count, dropdown list
- Mark as read (individual and bulk)
- Daily digest option: batch non-urgent notifications into one daily email

### Non-Functional Requirements
- Email delivered within 5 minutes of event
- In-app notification appears within 30 seconds of event

### API Endpoints
- `GET /api/notifications` — list user's notifications (unread first)
- `PATCH /api/notifications/:notificationId/read` — mark as read
- `POST /api/notifications/mark-all-read` — mark all read
- `GET /api/notifications/preferences` — get preferences
- `PATCH /api/notifications/preferences` — update preferences

### Database Entities
- `notifications`, `notification_preferences`

### Security Requirements
- Notifications scoped to user + org; cross-tenant delivery impossible
- Email delivery uses verified sender domain (SPF, DKIM configured)

### Acceptance Criteria
- Prompt run completion email arrives within 5 minutes
- In-app notification badge count updates in real time
- Disabling a notification type prevents both email and in-app delivery for that type
- Daily digest batches all enabled non-urgent notifications from the previous 24 hours

### Definition of Done
Email notifications live via Resend. In-app notification center functional. Preferences tested. Digest mode working.

---

## EPIC 26: Billing
**Status:** PLANNED  
**Depends on:** Epic 2, Epic 3

### Purpose
Implement subscription billing, usage-based overages, and plan enforcement. BeBest charges flat monthly subscription fees plus per-unit AI usage overages. Billing must be fully automated with no manual invoicing.

### Business Problem
Without billing, BeBest has no revenue. Manual invoicing is unscalable. Plan limits must be enforced to prevent free-tier abuse and protect margin.

### Key User Stories
- As a new user, I want to select a plan and enter payment details during signup so that my account is activated immediately.
- As a user, I want to see my current usage vs. plan limits so that I'm not surprised by overage charges.
- As a billing admin, I want to receive invoice emails automatically so that I don't need to log in to download receipts.
- As a platform operator, I want plan limits enforced in real time so that users on the free plan cannot run unlimited prompt jobs.

### Functional Requirements
- Billing provider: Stripe (subscriptions + usage-based billing)
- Plans: Free (limited prompts, 1 brand), Starter, Growth, Agency (see pricing)
- `subscriptions` table: id, org_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end
- `usage_records` table: id, org_id, metric (prompt_runs|ai_tokens|crawl_pages|users), quantity, recorded_at
- Plan limits enforced via middleware: check limit before executing prompt run, crawl, or content generation
- Stripe webhooks: handle subscription.created, subscription.updated, invoice.paid, invoice.payment_failed
- Billing portal: Stripe Customer Portal embedded for plan changes and payment method updates
- Usage dashboard: current period usage vs. limits per metric
- Overage billing: usage-based Stripe meter for AI tokens above plan allowance

### Non-Functional Requirements
- Plan limit check adds < 10ms to any API route
- Stripe webhook processing idempotent (replay safe)

### API Endpoints
- `POST /api/billing/checkout` — create Stripe checkout session
- `GET /api/billing/portal` — get Stripe Customer Portal URL
- `GET /api/billing/subscription` — current subscription status
- `GET /api/billing/usage` — current period usage
- `POST /api/billing/webhooks` — Stripe webhook receiver

### Database Entities
- `subscriptions`, `usage_records`

### Security Requirements
- Stripe webhook signature verified on every request
- Payment methods never stored in BeBest DB (Stripe only)
- Billing data accessible only to org Admins

### Acceptance Criteria
- Free plan user blocked from running more than plan-limit prompt jobs per month
- Stripe checkout completes and subscription activates within 60 seconds
- Invoice email arrives within 5 minutes of successful payment
- Plan upgrade immediately increases limits for the org
- Webhook replays are idempotent (no duplicate subscription records)

### Definition of Done
All plans configured in Stripe. Checkout flow tested. Limit enforcement verified. Webhook processing tested with Stripe CLI.

---

## EPIC 27: CRM
**Status:** PLANNED  
**Depends on:** Epic 2, Epic 26

### Purpose
Track the full lifecycle of BeBest customers from lead to churn — contact records, trial status, feature adoption, health scores, and renewal risk. The CRM gives the BeBest team visibility into which customers are succeeding and which need intervention.

### Business Problem
Without a CRM, BeBest operates blind to customer health. Churn is discovered after the fact. High-value expansion opportunities are missed. The CRM is the operational backbone for customer success and sales.

### Key User Stories
- As a BeBest team member, I want to see each customer's feature adoption so that I know which features drive retention.
- As a customer success manager, I want to see a health score per account so that I can proactively reach out to at-risk accounts.
- As a sales team member, I want to see trial expiry dates so that I can time conversion outreach.

### Functional Requirements
- `crm_contacts` table: id, org_id, email, name, role, source (signup|invite|import), created_at
- `account_health` table: id, org_id, health_score (0–100), prompt_runs_last_30d, logins_last_7d, actions_completed, risk_level (healthy|at_risk|churning), calculated_at
- Health score formula: login_frequency weight + feature_adoption weight + actions_taken weight + plan_upgrade weight
- Feature adoption tracking: flags for key features used (first prompt run, first draft, first publish, first report)
- Admin CRM dashboard: sortable list of accounts with health score, plan, MRR, days_since_last_login
- Segment views: trial (< 14 days), active, at-risk, churned
- Manual notes: BeBest team members can add notes per account
- Intercom/HubSpot sync (optional): push org + health data to external CRM via webhook

### Non-Functional Requirements
- Health scores recalculated daily
- CRM dashboard loads in < 2 seconds for 1,000 accounts

### API Endpoints
- `GET /api/admin/crm/accounts` — list accounts with health scores
- `GET /api/admin/crm/accounts/:orgId` — account detail
- `POST /api/admin/crm/accounts/:orgId/notes` — add note
- `GET /api/admin/crm/accounts/:orgId/events` — activity timeline

### Database Entities
- `crm_contacts`, `account_health`, `crm_notes`

### Security Requirements
- CRM accessible only to BeBest internal team role
- Customer data never exposed to other customers via CRM endpoints

### Acceptance Criteria
- Health score calculated correctly for 5 test accounts (manually verified)
- At-risk accounts (score < 40) appear in at-risk segment
- Feature adoption flags update within 1 hour of user completing action
- Admin note persists and appears in account timeline

### Definition of Done
CRM dashboard live for BeBest team. Health scores calculating daily. At-risk segment populated.

---

## EPIC 28: Free AI + SEO Snapshot
**Status:** PLANNED  
**Depends on:** Epic 5, Epic 9, Epic 10

### Purpose
Build a public-facing free tool that generates a 5-minute AI + SEO snapshot for any domain. The snapshot is a lead-generation mechanic that shows prospects their AI visibility score and top 3 gaps, then prompts them to sign up for BeBest.

### Business Problem
BeBest needs a top-of-funnel conversion tool. A free snapshot provides immediate value, demonstrates the platform's capability, and captures high-intent leads who have seen their own data.

### Key User Stories
- As a prospect, I want to enter my domain and receive a free AI visibility report so that I can see how AI models describe my business.
- As a growth marketer, I want the snapshot to prompt email capture so that I can follow up with leads.
- As a BeBest operator, I want snapshot usage tracked so that I can measure top-of-funnel conversion.

### Functional Requirements
- Public landing page: domain input → email capture → snapshot generation → results page
- Snapshot pipeline: crawl homepage (1 page only), run 10 representative queries per AI provider (free tier: 2 providers), extract mentions and citations
- `snapshot_requests` table: id, domain, email, status, result_json, created_at, converted_to_signup_at
- Rate limiting: 3 snapshots per IP per day; 1 snapshot per domain per 7 days
- Results page: AI visibility score, top 3 gaps, 3 competitor names, "Unlock full report" CTA
- Email delivery: results emailed to captured address with PDF teaser report
- Conversion tracking: link snapshot_id to signup org_id when user converts
- GDPR: explicit consent checkbox for marketing emails; suppress on unsubscribe

### Non-Functional Requirements
- Snapshot completes in < 3 minutes (user shown progress bar)
- Results page shareable (public URL, no auth required, expires after 30 days)

### API Endpoints
- `POST /api/snapshots` — submit domain + email, trigger snapshot
- `GET /api/snapshots/:snapshotId` — get snapshot results (public)
- `GET /api/snapshots/:snapshotId/pdf` — download teaser PDF

### Database Entities
- `snapshot_requests`

### Security Requirements
- Email not required to view results if user has URL (opt-in only for marketing)
- Domain input sanitized; only valid FQDNs accepted
- Snapshot results contain no competitor data from other orgs' paid analysis

### Acceptance Criteria
- Snapshot completes in < 3 minutes for a standard 10-page business site
- Results page shows correct AI visibility score and 3 gap types
- Results email arrives within 5 minutes
- Rate limit blocks 4th snapshot from same IP in same day
- Converted snapshot links to the newly created org in CRM

### Definition of Done
Free snapshot live on public URL. Rate limiting tested. Email delivery confirmed. Conversion tracking verified with test signup.

---

## EPIC 29: Customer Success Automation
**Status:** PLANNED  
**Depends on:** Epic 23, Epic 27

### Purpose
Automate customer success touchpoints — onboarding sequences, milestone emails, at-risk interventions, and check-in reminders. Reduce churn through timely, personalized outreach triggered by platform behavior rather than calendar.

### Business Problem
Manual customer success doesn't scale. At-risk accounts churn before CSMs can intervene. High-value accounts don't receive timely upsell messages. Automation closes these gaps.

### Key User Stories
- As a new user, I want to receive a step-by-step onboarding email sequence so that I know what to do first.
- As a BeBest CSM, I want to be alerted when an account's health score drops below 40 so that I can reach out before they churn.
- As a user who has been inactive for 14 days, I want to receive a re-engagement email so that I'm reminded of what BeBest can do for me.

### Functional Requirements
- Automation sequences managed as event-triggered workflows
- Triggers: signup, first_prompt_run, first_draft_created, first_publish, health_score_below_40, inactive_14d, trial_expiring_3d, plan_anniversary_12m
- `automation_events` table: id, org_id, user_id, trigger_type, sent_at, email_type, opened_at, clicked_at
- Email sequences: onboarding (day 0, 2, 5, 10 emails), at-risk (immediate CSM alert + user email), re-engagement (day 14, 21), trial-to-paid nudge (day 11, 13)
- CSM alerts: Slack message + CRM note when health score drops below threshold
- Suppression: completed trigger not re-sent; unsubscribed users excluded
- A/B testing for email subject lines: split traffic, track open rates

### Non-Functional Requirements
- Email triggered within 15 minutes of event
- Automation engine processes 10,000 events/day without backlog

### API Endpoints
- `GET /api/admin/automation/sequences` — list sequences and send counts
- `GET /api/admin/automation/events` — log of all triggered events
- `POST /api/admin/automation/sequences/:sequenceId/test` — send test email

### Database Entities
- `automation_events`, `automation_suppressions`

### Security Requirements
- Automation email unsubscribe links must work without login
- CSM Slack alerts contain no payment or sensitive billing data

### Acceptance Criteria
- Day-0 onboarding email sent within 15 minutes of signup
- At-risk Slack alert fires within 1 hour of health score dropping below 40
- Unsubscribed user receives no further automation emails
- Trial expiry email sent exactly 3 days before trial end

### Definition of Done
All onboarding sequences live. At-risk alert tested. Re-engagement sequence verified. A/B test running on at least one email.

---

## EPIC 30: Agency / Multi-client
**Status:** PLANNED  
**Depends on:** Epic 2, Epic 24

### Purpose
Enable digital agencies to manage multiple client brands from a single BeBest account. Agencies get a client portfolio view, can generate client-branded reports, and can switch between client contexts without logging out.

### Business Problem
Agency accounts managing 10–50 clients cannot operate with single-brand workflows. They need portfolio management, client-level permissions, and deliverable generation at scale.

### Key User Stories
- As an agency admin, I want to see all my client brands in a portfolio dashboard so that I can monitor all clients at once.
- As an agency team member, I want to switch between client contexts in one click so that I can move efficiently between accounts.
- As an agency, I want to invite clients to view their own reports without giving them access to other clients' data so that data is isolated.

### Functional Requirements
- Agency org type: `organizations.type` = `agency`
- `client_brands` table: id, agency_org_id, client_org_id, brand_id, status (active|paused|churned)
- Portfolio dashboard: table of all client brands with visibility score, last run date, health, open action count
- Client context switcher: dropdown in nav; switches org + brand context, maintains session
- Client-only access: client user role can view their brand's data only; cannot see other clients
- Bulk run: trigger prompt runs for all active clients from portfolio view
- Client report generation: one-click generate report for all clients
- Per-client billing: agency plan includes N client slots; overage charged per additional client

### Non-Functional Requirements
- Portfolio dashboard loads in < 2 seconds for 50 clients
- Context switch completes in < 1 second

### API Endpoints
- `GET /api/agency/clients` — list all client brands
- `POST /api/agency/clients` — add client brand
- `DELETE /api/agency/clients/:clientId` — remove client
- `POST /api/agency/clients/runs` — trigger runs for all clients
- `GET /api/agency/portfolio-summary` — aggregated stats across all clients

### Database Entities
- `client_brands`

### Security Requirements
- Client users cannot access sibling client brands even if they know the URL
- Agency admin access to client data is logged in audit trail

### Acceptance Criteria
- Agency admin sees all 10 test clients in portfolio dashboard
- Context switch to a client brand changes all data in the UI to that client's data
- Client user cannot access any other client's data (verified by attempting cross-client API calls)
- Bulk run triggers all active clients' prompt jobs within 5 minutes

### Definition of Done
Portfolio dashboard live. Context switching tested. Client isolation verified with automated tests. Bulk run operational.

---

## EPIC 31: White Label
**Status:** PLANNED  
**Depends on:** Epic 30, Epic 24

### Purpose
Allow agency and enterprise clients to rebrand the BeBest platform with their own logo, colors, custom domain, and email sender identity. White-label clients present BeBest as their own proprietary tool to their end clients.

### Business Problem
Premium agency clients will not use BeBest if their clients can see BeBest branding. White-label capability is a revenue-multiplying feature that enables agencies to charge for the platform as their own product.

### Key User Stories
- As an agency, I want to set my own logo and brand colors so that my clients see our brand, not BeBest's.
- As an agency, I want to serve the platform on my own subdomain so that the URL reinforces our brand.
- As an agency, I want reports to carry our logo and color scheme so that they look like proprietary deliverables.

### Functional Requirements
- `white_label_configs` table: id, org_id, logo_url, primary_color, secondary_color, custom_domain, email_from_name, email_from_domain, hide_bebest_branding, created_at
- Custom domain: DNS CNAME to BeBest edge; SSL via Vercel auto-cert
- Theme injection: CSS variables overridden from white_label_config at runtime
- Email white-labeling: send from custom domain (requires SPF/DKIM setup guide)
- Report white-labeling: logo and colors applied to all PDF reports
- "Powered by BeBest" attribution: optional, toggleable per config
- White-label preview: admin can preview the branded UI before publishing

### Non-Functional Requirements
- Custom domain SSL provisioning within 5 minutes of DNS propagation
- Theme injection adds < 50ms to page load

### API Endpoints
- `GET /api/orgs/:slug/white-label` — get white label config
- `PATCH /api/orgs/:slug/white-label` — update config
- `POST /api/orgs/:slug/white-label/verify-domain` — check custom domain DNS + provision SSL
- `GET /api/orgs/:slug/white-label/preview` — preview branded UI

### Database Entities
- `white_label_configs`

### Security Requirements
- Custom domain verification required before activation
- Logo upload validated: image only, max 2MB, stored in Vercel Blob

### Acceptance Criteria
- Custom domain serves the platform correctly after DNS propagation
- All BeBest logos replaced with agency logo on white-label config
- Reports generated with white-label config carry agency logo and colors
- "Powered by BeBest" hidden when `hide_bebest_branding = true`

### Definition of Done
Custom domain + SSL live for at least one test org. Report white-labeling verified. Theme override tested.

---

## EPIC 32: Integrations
**Status:** PLANNED  
**Depends on:** Epic 1, Epic 4

### Purpose
Build a managed integration hub for connecting BeBest to external tools: Google Analytics 4, Google Search Console, HubSpot, Salesforce, Slack, Zapier, and custom webhooks. Integrations enrich brand data, deliver notifications, and push BeBest signals into existing workflows.

### Business Problem
BeBest cannot be an island. Clients have existing martech stacks. Integrations make BeBest's signals actionable inside the tools teams already use daily.

### Key User Stories
- As a user, I want to connect Google Analytics so that BeBest can correlate visibility score changes with traffic changes.
- As a user, I want Slack notifications for new recommendations so that my team sees them in the channel we already monitor.
- As a developer, I want a webhook API so that I can pipe BeBest events into my own systems.

### Functional Requirements
- `integrations` table: id, org_id, integration_type, config jsonb (encrypted), status, last_synced_at
- Integration types: Google Analytics 4 (GA4), Google Search Console, Slack, HubSpot, Salesforce, Zapier, Custom Webhook
- Integration hub UI: list available integrations with status (connected|disconnected|error), connect button
- GA4: pull sessions, users, bounce rate per URL via Data API; correlate with page visibility scores
- GSC: already in Epic 6; unified connection management here
- Slack: OAuth app; send notifications to chosen channel; configurable event types
- HubSpot/Salesforce: push lead data from snapshot requests (Epic 28) to CRM contact
- Zapier: webhook trigger on BeBest events; input trigger for action creation
- Custom webhook: user-defined URL called on BeBest events with JSON payload; HMAC signature header
- Webhook log: last 100 delivery attempts with status code and response body

### Non-Functional Requirements
- Webhook delivery: 3 retries with exponential backoff on failure
- Integration sync runs in background; never blocks UI

### API Endpoints
- `GET /api/integrations` — list all integrations for org
- `POST /api/integrations/:type/connect` — initiate OAuth or save config
- `DELETE /api/integrations/:integrationId` — disconnect
- `POST /api/integrations/webhooks` — create custom webhook
- `GET /api/integrations/webhooks/:webhookId/log` — delivery log

### Database Entities
- `integrations`, `webhook_deliveries`

### Security Requirements
- OAuth tokens stored encrypted
- Webhook payloads signed with HMAC-SHA256
- Custom webhook URLs validated (must be HTTPS, not internal IPs)

### Acceptance Criteria
- Slack connection sends test message to selected channel within 30 seconds
- Custom webhook receives BeBest event within 60 seconds of trigger
- Failed webhook retries 3 times and logs each attempt
- GA4 data appears in correlation view within 24 hours of connection

### Definition of Done
GA4, GSC, and Slack integrations live. Custom webhook tested. HubSpot push tested with test contact.

---

## EPIC 33: Marketing / Growth Engine
**Status:** PLANNED  
**Depends on:** Epic 28, Epic 24

### Purpose
Build BeBest's own growth infrastructure: SEO-optimized public content pages, automated social distribution, referral program, and analytics to measure top-of-funnel performance. BeBest dogfoods its own platform to grow.

### Business Problem
BeBest cannot rely on outbound sales alone. Organic growth requires a content engine, social presence, and referral loop. This epic builds the infrastructure that makes BeBest self-growing.

### Key User Stories
- As a growth marketer, I want SEO-optimized landing pages for target keywords so that BeBest ranks for buyer-intent queries.
- As a user, I want a referral link so that I can share BeBest and earn a reward.
- As a growth team member, I want published blog posts automatically shared to Twitter/LinkedIn so that content distribution is automated.

### Functional Requirements
- Public blog: dynamic CMS-powered blog at `/blog` using Contentful or built-in content system
- Landing pages: programmatic pages for `AI visibility for [industry]`, `SEO + GEO for [use case]`
- `referrals` table: id, referrer_user_id, referral_code, referred_org_id, reward_type, reward_status, created_at
- Referral program: unique link → 30% discount for referred user + 1 month free for referrer
- Social distribution: on blog post publish → auto-post to Twitter (X) + LinkedIn via API; configurable per post
- UTM tracking: all outbound links from BeBest carry UTM params; tracked in analytics
- Growth dashboard (internal): signups/day, snapshot-to-signup conversion rate, referral count, top traffic sources

### Non-Functional Requirements
- Blog pages static-rendered (Next.js ISR) for SEO performance
- Landing pages load in < 1 second (Core Web Vitals green)

### API Endpoints
- `POST /api/referrals/generate` — generate referral code for user
- `GET /api/referrals/stats` — referral conversion stats for user
- `POST /api/admin/blog/posts/:postId/distribute` — trigger social distribution

### Database Entities
- `referrals`, `blog_posts` (if self-hosted)

### Security Requirements
- Referral codes cryptographically random and single-use
- Social API keys stored as org-level secrets

### Acceptance Criteria
- Referral link correctly credits referrer when referred org converts to paid
- Blog post published and appears at `/blog/:slug` within 60 seconds
- Social distribution posts appear on Twitter and LinkedIn within 5 minutes of trigger
- Growth dashboard shows correct signup count for last 7 days

### Definition of Done
Referral program live. Blog at `/blog` with at least 5 posts. Social distribution tested. Growth dashboard accessible to BeBest team.

---

## EPIC 34: Entrepreneur Story Ecosystem
**Status:** PLANNED  
**Depends on:** Epic 33

### Purpose
Build a community content ecosystem around entrepreneur stories — case studies, interviews, success stories, and user-generated content. This deepens BeBest's brand moat, provides social proof, and generates long-tail SEO content.

### Business Problem
B2B SaaS platforms with strong community content have significantly lower churn and higher organic growth. Entrepreneur stories humanize the brand, provide peer-to-peer trust signals, and attract buyers who identify with the subjects.

### Key User Stories
- As a BeBest customer, I want to submit my growth story so that other entrepreneurs can learn from my experience.
- As a prospect, I want to read success stories from companies like mine so that I can see how BeBest works in my context.
- As a content manager, I want to publish and feature stories so that the best content gets maximum visibility.

### Functional Requirements
- Story submission form: entrepreneur details, company context, challenge, BeBest actions taken, results achieved (metrics required)
- `stories` table: id, org_id, author_name, company_name, industry, challenge, solution, result_metrics jsonb, status (submitted|reviewing|published|rejected), published_at, slug
- Editorial workflow: submitted → internal review → edit → publish
- Published story page: SEO-optimized at `/stories/:slug`
- Featured stories: promoted on homepage and `/stories` index
- Story discovery: filter by industry, company size, use case
- Story schema: Article JSON-LD for search engine rich results
- Email notification to author when story published

### Non-Functional Requirements
- Story pages static-rendered (ISR) for SEO
- Story index loads in < 1 second

### API Endpoints
- `POST /api/stories/submit` — public story submission
- `GET /api/stories` — public story list (published only)
- `GET /api/stories/:slug` — public story detail
- `PATCH /api/admin/stories/:storyId` — editorial status update

### Database Entities
- `stories`

### Security Requirements
- Story submissions rate-limited: 1 per org per 30 days
- Story content reviewed before publish; no auto-publish

### Acceptance Criteria
- Story submission form validates required fields including at least one result metric
- Published story appears at `/stories/:slug` with correct Article JSON-LD
- Filter by industry returns correct subset
- Author receives email when their story is published
- Rejected story sends decline notification

### Definition of Done
Story submission live. At least 3 published stories. Editorial workflow tested. Index page with filters live.

---

## EPIC 35: Autonomous Operations
**Status:** PLANNED  
**Depends on:** Epic 19, Epic 23, Epic 29

### Purpose
Move BeBest toward autonomous operation — agents that run without human intervention, self-healing pipelines that recover from errors, and intelligent scheduling that optimizes run timing based on learned patterns. The goal is a platform that improves client outcomes in the background, continuously.

### Business Problem
Manual-trigger workflows require users to remember to act. The highest-value BeBest configuration is one where users set their goals once and the platform handles everything — running prompts, generating content, measuring results, and adjusting strategy.

### Key User Stories
- As a user, I want to set a monthly AI visibility growth target and have BeBest autonomously work toward it so that I can focus on my business.
- As a platform engineer, I want pipelines to self-heal when workers crash so that manual restarts are never required.
- As a user, I want the platform to optimize its own run schedule based on when AI provider APIs are fastest so that my data quality improves automatically.

### Functional Requirements
- Goal-setting: user sets target (e.g., "increase AI visibility score by 20% in 90 days"); platform tracks progress and adjusts agent priorities
- `goals` table: id, brand_id, metric, target_value, baseline_value, deadline, current_value, status, created_at
- Self-healing pipelines: failed workers restart automatically via supervisor (BullMQ `removeOnFail: false` + dead-letter queue handler)
- Adaptive scheduling: track AI provider response quality by hour-of-day; schedule runs during highest-quality windows
- Autonomous content approval (opt-in): if `auto_approve = true` and AI-readiness score ≥ 80, draft auto-approved and published without human review
- Autonomous experiment runner: platform selects variants automatically, runs them, evaluates results, and promotes winners
- Operational health dashboard: live view of all running workers, queue depths, error rates

### Non-Functional Requirements
- Dead-letter queue processed within 1 hour of worker crash
- Goal tracking updated daily

### API Endpoints
- `POST /api/brands/:brandId/goals` — create goal
- `GET /api/brands/:brandId/goals` — list goals + progress
- `PATCH /api/brands/:brandId/goals/:goalId` — update goal
- `GET /api/admin/operations/health` — platform operational health

### Database Entities
- `goals`, `goal_checkpoints`

### Security Requirements
- `auto_approve` requires explicit opt-in; default off
- Autonomous publishing logged in audit trail with agent attribution

### Acceptance Criteria
- Goal progress updates daily with current_value
- Dead-letter queue handler restarts failed job within 1 hour
- Adaptive scheduling shifts run time to highest-quality window within 1 week of tracking
- Auto-approved content is logged with reason and score
- Operational health dashboard shows correct queue depths in real time

### Definition of Done
Goal tracking live. Dead-letter handler operational. Adaptive scheduling collecting quality data. Auto-approve tested with opt-in brand.

---

## EPIC 36: Production Hardening
**Status:** PLANNED  
**Depends on:** All prior epics

### Purpose
Ensure BeBest is production-ready at scale: performance optimization, security audit, disaster recovery, compliance (GDPR, SOC 2 readiness), load testing, and runbook documentation. This epic converts a functional platform into a trustworthy enterprise-grade product.

### Business Problem
Enterprise and agency clients require documented security posture, data residency guarantees, SLA commitments, and incident response procedures before signing contracts. This epic provides the evidence.

### Key User Stories
- As an enterprise buyer, I want a security questionnaire completed so that my InfoSec team can approve BeBest.
- As a platform operator, I want load tests completed so that I know the platform handles peak load without degradation.
- As a user, I want GDPR data export and deletion so that I can comply with customer data requests.
- As an ops engineer, I want runbooks for all critical failure scenarios so that on-call response is fast.

### Functional Requirements
- Load test: simulate 500 concurrent users with Locust or k6; all endpoints must meet p99 < 2 seconds
- Security audit: OWASP Top 10 checklist completed; penetration test with remediation
- GDPR: data export (all org data as JSON), data deletion (all org data purged within 30 days of request), consent management
- `data_requests` table: id, org_id, request_type (export|deletion), requested_by, status, completed_at
- Backup: daily automated DB backup to Vercel Blob; retention 30 days; tested restore quarterly
- Disaster recovery: RTO < 4 hours, RPO < 1 hour; documented runbook
- SOC 2 Type I readiness: access controls, change management, monitoring controls documented
- Uptime monitoring: Uptime Robot or Better Uptime; status page at `status.bebest.io`
- Incident response: PagerDuty or similar; P0 escalation within 15 minutes
- Rate limiting audit: all public endpoints have rate limits enforced and tested
- Dependency audit: `npm audit` clean; no high-severity CVEs in production dependencies
- Runbooks: written for top 10 failure scenarios (DB connection exhaustion, AI provider outage, queue backlog, etc.)

### Non-Functional Requirements
- 99.9% uptime SLA (< 8.7 hours downtime/year)
- DB restore tested and verified quarterly
- All secrets rotated on a 90-day schedule

### API Endpoints
- `POST /api/gdpr/export` — request data export
- `POST /api/gdpr/delete` — request data deletion
- `GET /api/gdpr/requests/:requestId` — check request status

### Database Entities
- `data_requests`, `audit_logs` (comprehensive)

### Security Requirements
- Penetration test conducted by external vendor
- All critical and high findings remediated before GA launch
- MFA enforced for all BeBest team internal accounts
- Least-privilege IAM: service accounts have only required permissions

### Acceptance Criteria
- Load test passes: p99 < 2s for all critical endpoints at 500 concurrent users
- OWASP Top 10 checklist signed off with no critical findings open
- GDPR data export completes within 72 hours of request
- GDPR data deletion completes within 30 days of request
- DB backup restore tested successfully (last restore < 3 months ago)
- Status page shows current uptime and incident history
- All 10 runbooks reviewed by on-call engineer

### Definition of Done
Load test results documented. Security audit completed and findings remediated. GDPR endpoints live. Status page live. Runbooks written and reviewed. SOC 2 Type I controls documented.

---

*End of EPICS.md — 37 epics (0–36)*
