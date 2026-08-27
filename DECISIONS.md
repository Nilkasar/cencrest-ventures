# ARCHITECTURE DECISION RECORDS — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

Format: ADR-NNN | Decision | Status | Context | Options | Decision | Consequences

---

## ADR-001: Database — PostgreSQL

**Status**: DECIDED  
**Date**: 2026-08-11

**Context**: Need a primary database for all BeBest data. Requirements: multi-tenancy, row-level security, JSONB for flexible metadata, strong consistency, good tooling.

**Options considered**:
- PostgreSQL
- MySQL
- SQLite (development only)
- MongoDB

**Decision**: PostgreSQL

**Consequences**:
- Row-level security available natively
- JSONB for flexible metadata without schema migrations
- Strong ORM support (Drizzle, Prisma, SQLAlchemy)
- Well-understood operations and backup tooling
- Requires managed PostgreSQL service in production (Supabase, Neon, Railway, or self-hosted)

---

## ADR-002: AI Local Development — Ollama

**Status**: DECIDED  
**Date**: 2026-08-11

**Context**: Development should not require cloud API keys. Developers must be able to run the full system locally. Already configured in `opencode.json`.

**Decision**: Ollama with Qwen3 8B (general) and Qwen2.5-Coder 7B (code)

**Consequences**:
- All AI functionality testable without cloud API costs
- Slower inference than cloud (acceptable for development)
- Requires AI provider abstraction layer so switching providers requires no application changes
- Extraction quality may differ between local and cloud models — evaluation suite must cover both

---

## ADR-003: AI Provider Abstraction — Required

**Status**: DECIDED  
**Date**: 2026-08-11

**Context**: BeBest tests brands against ChatGPT, Claude, Gemini, and Perplexity — four different providers. Internal intelligence uses AI for extraction and generation. Cannot bind to one provider.

**Decision**: All AI calls must go through a `AIProvider` abstraction interface. No application code may import provider SDKs directly.

**Consequences**:
- Adding a new provider requires implementing one interface
- Provider-specific features (tool use, vision) are abstracted — not all features available on all providers
- Increases upfront implementation cost but eliminates vendor lock-in

---

## ADR-004: Scoring — Deterministic Formulas Only

**Status**: DECIDED  
**Date**: 2026-08-11

**Context**: If LLMs compute the final score, the same inputs may produce different scores on different days. Customers cannot trust a score that isn't reproducible.

**Decision**: LLMs extract structured observations (brand mentioned: yes/no, position: float, sentiment: enum). Deterministic formulas compute all scores. Every formula is versioned.

**Consequences**:
- Scores are reproducible and auditable
- Formula changes require a version bump and may require historical re-computation
- LLM extraction quality affects score accuracy — requires evaluation datasets
- Score explanation is always possible (trace from score → formula → observations → raw response)

---

## ADR-005: Multi-tenancy — Row-Level Security from Day 1

**Status**: DECIDED  
**Date**: 2026-08-11

**Context**: BeBest serves multiple organizations. Customer data must be strictly isolated. Retrofitting isolation is expensive and error-prone.

**Decision**: Every customer-data table includes `organization_id`. PostgreSQL Row-Level Security is enabled and enforced. Application middleware sets `app.current_org` on every database connection.

**Consequences**:
- Tenant isolation is enforced at database level, not just application level
- Impossible to accidentally expose cross-tenant data even through application bugs
- Slightly higher setup cost in Phase 1
- All queries must be run within an organization context

---

## ADR-006: Prompt Versioning — Required

**Status**: DECIDED  
**Date**: 2026-08-11

**Context**: Prompt changes alter AI outputs. If prompts change without versioning, historical scores become incomparable to current scores. Cannot track "did the brand improve?" if the measurement changed.

**Decision**: Every prompt has a version string (e.g., `1.0`, `1.1`, `2.0`). Version is stored with every AI response and every score. Prompt templates are stored in the database and tracked in version control.

**Consequences**:
- Changing a prompt requires a version bump
- Major version changes may invalidate cached results
- Historical comparison requires matching prompt versions

---

## ADR-007: Content Publishing — Human Approval Required (Default)

**Status**: DECIDED  
**Date**: 2026-08-11

**Context**: Publishing incorrect, brand-unsafe, or low-quality content damages customers. Autonomous publishing is a trust problem before it is solved.

**Decision**: All content publishing requires explicit human approval by default. Autonomy Level 3 (approve & execute) and Level 4 (autonomous) are opt-in features, not defaults, and require explicit configuration.

**Consequences**:
- Slower execution loop — but higher trust and safety
- Audit trail for every published piece
- Rollback capability required for all published content
- Autonomy levels must be implemented carefully with complete audit logging

---

## ADR-008: Backend Language — Node.js / TypeScript

**Status**: DECIDED  
**Date**: 2026-08-27

**Context**: BeBest requires an API server, background job runner, and AI orchestration layer. Two primary options evaluated: Node.js/TypeScript (Hono or Express) and Python (FastAPI). Decision required before Epic 1.

**Decision**: Node.js with TypeScript

**Consequences**:
- Single language across backend, tooling, and (eventual) frontend — no context switching
- Hono selected as the web framework (fast, lightweight, Cloudflare/Vercel/Node compatible)
- Drizzle ORM (D-O13) aligns naturally with TypeScript-first approach
- pg-boss background job queue (already installed in bebest DB) has a native Node.js client
- All existing local tooling (Node 24.12, npm 11.6, opencode.json) already configured for Node
- Qwen2.5-Coder 7B is well-trained on TypeScript — local AI implementation works well

---

## ADR-009: ORM — Prisma

**Status**: DECIDED  
**Date**: 2026-08-27

**Decision**: Prisma

**Consequences**:
- Schema-first: `schema.prisma` is the source of truth; migrations generated automatically
- Strong TypeScript type generation from schema — no manual type writing
- Prisma Client is well-maintained with excellent Node.js support
- Row-level security must be implemented at application layer (Prisma does not manage RLS policies) — RLS policies written in raw SQL in migration files
- Existing 41-table schema must be introspected into schema.prisma via `prisma db pull` in Epic 1

---

## ADR-010: Email Delivery — Resend

**Status**: DECIDED  
**Date**: 2026-08-27

**Decision**: Resend

**Consequences**:
- Simple REST API + official Node.js SDK (`resend` npm package)
- React Email templates supported — enables well-designed transactional email
- Generous free tier (3,000 emails/month) — sufficient for early development and launch
- Domain verification required before sending from `@bebestwith.ai`
- RESEND_API_KEY must be in .env.local (never committed)

---

## ADR-011: Managed PostgreSQL — Supabase

**Status**: DECIDED  
**Date**: 2026-08-27

**Decision**: Supabase (for staging and production)

**Consequences**:
- Local development continues to use PostgreSQL 16 on port 5434 (`/Users/nilesh/bebest-pgdata`) — no change
- Supabase provides managed PostgreSQL with built-in RLS, storage, and auth (auth not used — see D-O04)
- Free tier (500 MB, 2 projects) sufficient for staging
- Production project requires paid plan
- DATABASE_URL for staging/prod comes from Supabase dashboard — stored in environment only, never committed
- Prisma connects to Supabase via the direct connection string (not the pooler) for migrations; pooler for runtime

---

## OPEN DECISIONS (require resolution before Phase 1)

| # | Decision | Options | Deadline |
|---|---|---|---|
| D-O01 | Backend language | ~~Node.js vs Python~~ | **DECIDED: Node.js/TypeScript (ADR-008)** |
| D-O02 | Frontend framework for customer portal | Static HTML extend vs React/Next.js vs SvelteKit | Before Epic 1 |
| D-O03 | Hosting model | Vercel Functions vs dedicated VPS vs hybrid | Before Epic 1 |
| D-O04 | Auth provider | Custom JWT vs Clerk vs Auth.js vs Supabase Auth | Before Epic 3 |
| D-O05 | Queue system | pg-job-table vs Vercel Queues vs BullMQ/Redis vs Inngest | Before Epic 9 |
| D-O06 | Cache layer | None initially vs Redis vs pg-based vs Vercel KV | Before Epic 9 |
| D-O07 | Email delivery | ~~Resend vs Postmark vs SendGrid vs SES~~ | **DECIDED: Resend (ADR-010)** |
| D-O08 | File storage (for reports) | Vercel Blob vs S3 vs Cloudflare R2 | Before Epic 24 |
| D-O09 | Payment provider | Stripe vs Paddle vs Lemon Squeezy | Before Epic 26 |
| D-O10 | Form backend (urgent — leads being lost) | Resend+Airtable vs Typeform embed vs custom API | URGENT |
| D-O11 | Managed PostgreSQL | ~~Supabase vs Neon vs Railway vs self-hosted~~ | **DECIDED: Supabase (ADR-011)** |
| D-O12 | Legal review of AI provider ToS | N/A | Before Phase 3 |
| D-O13 | ORM | ~~Drizzle vs Prisma vs Knex vs SQLAlchemy~~ | **DECIDED: Prisma (ADR-009)** |
| D-O14 | Error tracking | Sentry vs Bugsnag vs Honeybadger | Before Epic 1 |
| D-O15 | Analytics | Vercel Analytics vs Plausible vs PostHog | Before Epic 1 |
