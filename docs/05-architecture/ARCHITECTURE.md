# SYSTEM ARCHITECTURE — BeBest

**Version**: 1.0  
**Date**: 2026-08-11  
**Status**: TARGET STATE (not yet implemented)

---

## CURRENT ARCHITECTURE

```
Browser
  └── Vercel CDN (static files)
        ├── index.html
        ├── style.css
        ├── *.js (hero-film, interactions, clouds, source-field)
        └── assets/ (images, logo variants)
```

**No backend. No database. No API. No auth.**

---

## TARGET ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│                                                              │
│  Marketing Site (HTML/CSS/JS) │ Customer Portal (React/Next) │
│  bebestwithai.com             │ app.bebestwithai.com          │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼───────────────────────────────────────┐
│                      API GATEWAY                             │
│                  (Vercel Functions / Hono)                   │
│                                                              │
│  Auth Middleware  │  Rate Limiting  │  Tenant Resolution     │
└──────────────────────┬───────────────────────────────────────┘
                       │
       ┌───────────────┼──────────────────┐
       │               │                  │
┌──────▼──────┐ ┌──────▼──────┐  ┌───────▼──────┐
│  Core API   │ │  Job Worker │  │  AI Proxy    │
│  (REST/RPC) │ │  (Queue)    │  │  (Provider   │
│             │ │             │  │   Abstraction)│
└──────┬──────┘ └──────┬──────┘  └───────┬──────┘
       │               │                 │
┌──────▼───────────────▼─────────────────▼──────┐
│                  DATABASE LAYER                │
│                                                │
│  PostgreSQL (primary)                          │
│   ├── Core tables (orgs, users, brands...)    │
│   ├── Intelligence tables (queries, responses)│
│   ├── Opportunity tables                       │
│   ├── Content tables                           │
│   ├── CRM tables                               │
│   └── Billing tables                           │
└───────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────┐
│               AI PROVIDER LAYER                  │
│                                                  │
│  AIProvider (interface)                          │
│   ├── OllamaProvider (local, development)        │
│   ├── OpenAIProvider (GPT-4o, o1)                │
│   ├── AnthropicProvider (Claude)                 │
│   ├── GoogleProvider (Gemini)                    │
│   └── PerplexityProvider (Sonar)                 │
└──────────────────────────────────────────────────┘
```

---

## COMPONENT BREAKDOWN

### Marketing Site
- **Tech**: Pure HTML/CSS/JS (existing — do not rewrite)
- **Hosting**: Vercel static
- **Purpose**: Lead generation, brand, free snapshot acquisition
- **Changes needed**: Wire apply form to API, add analytics

### Customer Portal
- **Tech**: React or Next.js (UNDECIDED)
- **Hosting**: Vercel (app.bebestwithai.com)
- **Purpose**: Customer dashboard, intelligence reports, action center
- **Authentication**: Managed by Auth layer

### API Layer
- **Tech**: UNDECIDED (Node.js/Hono vs Python/FastAPI)
- **Hosting**: Vercel Functions or dedicated server
- **Routing**: REST endpoints, versioned (/api/v1/...)
- **Auth**: JWT + session tokens
- **Rate limiting**: Per-user, per-tenant, per-endpoint
- **Logging**: Structured JSON logs

### Job Worker
- **Purpose**: Long-running background tasks
  - AI query runner (1,400 prompts × 4 models)
  - Website crawler
  - Report generation
  - Score computation
- **Queue strategy**: UNDECIDED (Vercel Queues vs PostgreSQL job table)
- **Retry**: Exponential backoff, max 3 retries
- **Observability**: Job status visible in admin + customer portal

### AI Proxy / Provider Abstraction
- **Interface**: Single `AIProvider` interface
- **Implementations**: Ollama, OpenAI, Anthropic, Google, Perplexity
- **Features**:
  - Prompt versioning
  - Response storage (full raw response)
  - Rate limiting per provider
  - Fallback provider chain
  - Cost tracking (token usage)

---

## DATABASE ARCHITECTURE

See `/docs/06-database/SCHEMA.md` for full schema.

### Core Schema Groups

**Identity**
- `organizations` — Tenants (companies using BeBest)
- `users` — People within organizations
- `memberships` — User ↔ Organization relationships with roles

**Brand Intelligence**
- `brands` — Company being analyzed
- `competitors` — Competitor definitions
- `entities` — Named entities, products, services, categories
- `use_cases` — Customer use cases for this brand
- `brand_claims` — Factual claims about the brand + evidence

**AI Intelligence**
- `query_sets` — Named collections of prompts
- `queries` — Individual prompts
- `ai_runs` — A full run (query_set × models × timestamp)
- `ai_responses` — Individual model responses (raw + structured)
- `brand_observations` — Extracted: was brand mentioned? position? sentiment? citations?
- `competitor_observations` — Same for each competitor

**SEO Intelligence**
- `keyword_groups` — Topic clusters / query groups
- `keywords` — Individual keyword with volume/intent metadata
- `seo_analyses` — Technical SEO analysis snapshots
- `content_pages` — Customer website pages analyzed
- `seo_opportunities` — Identified SEO opportunities

**Opportunity Engine**
- `opportunities` — Unified SEO+GEO opportunities
- `opportunity_evidence` — Evidence items supporting an opportunity
- `recommendations` — Generated recommendations
- `actions` — Approved actions from recommendations

**Content**
- `content_briefs` — Research-backed content specifications
- `content_drafts` — Generated content versions
- `content_approvals` — Approval workflow records
- `published_content` — Links to published pages

**CRM**
- `leads` — Pre-signup contacts
- `deals` — Sales pipeline entries
- `accounts` — Customer accounts (linked to organizations)
- `activities` — Interactions, notes, emails

**Billing**
- `subscriptions` — Active plan subscriptions
- `invoices` — Billing records
- `usage_records` — Metered usage (AI queries, pages analyzed)
- `entitlements` — Feature access per plan

---

## MULTI-TENANCY MODEL

Every table that stores customer data includes `organization_id`.

Row-level security (RLS) enforced at the PostgreSQL level:
```sql
ALTER TABLE ai_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_responses
  USING (organization_id = current_setting('app.current_org')::uuid);
```

The API middleware sets `app.current_org` on every authenticated request.

No cross-tenant data access is possible even through application bugs.

---

## AI PROVIDER ABSTRACTION

```typescript
interface AIProvider {
  name: string;
  model: string;
  
  complete(prompt: string, options: CompletionOptions): Promise<CompletionResult>;
  
  // Structured extraction (brand mentions, citations, etc.)
  extract<T>(prompt: string, schema: JSONSchema): Promise<T>;
}

interface CompletionOptions {
  temperature?: number;  // default 0.7
  maxTokens?: number;
  systemPrompt?: string;
  promptVersion: string; // required — for evidence traceability
}

interface CompletionResult {
  provider: string;
  model: string;
  promptVersion: string;
  rawResponse: string;
  tokensUsed: number;
  latencyMs: number;
  timestamp: string;
  requestId: string;
}
```

Local development uses Ollama. Production uses the configured provider chain.

**No application code may import a provider directly.** All AI calls go through the abstraction layer.

---

## SCORING ARCHITECTURE

All scores are **deterministic** — computed by formulas, not by LLM judgment.

LLMs may:
- Extract whether a brand was mentioned (binary)
- Extract where in the response it appeared (position index)
- Extract the sentiment (enum: positive/neutral/negative)
- Extract cited URLs
- Extract competitor mentions

LLMs may NOT:
- Decide the final score
- Rank opportunities
- Determine priority

**Formulas compute scores from extracted observations.**

Every formula is:
- Versioned (score_formula_version stored with every score)
- Documented (in `/docs/12-ai/SCORING.md`)
- Reproducible (same inputs → same score, always)
- Testable (unit tests with known inputs and expected outputs)

---

## SECURITY ARCHITECTURE

See `/docs/08-security/SECURITY.md` for full threat model.

Key principles:
1. All external input (customer websites, AI responses, form submissions) is UNTRUSTED
2. SSRF protection on all URL inputs (blocklist private IP ranges)
3. Row-level security for tenant isolation
4. Prompt injection detection on AI responses before storage
5. Rate limiting on all API endpoints and AI queries
6. Secrets in environment variables, never in code
7. Audit log for all privileged actions

---

## OBSERVABILITY

| Layer | Tool | Status |
|---|---|---|
| Error tracking | Sentry (UNDECIDED) | Not implemented |
| Structured logging | JSON to stdout | Not implemented |
| Metrics | UNDECIDED | Not implemented |
| Uptime monitoring | UNDECIDED | Not implemented |
| Performance | Vercel Analytics (available) | Not configured |
| User analytics | Plausible or PostHog (UNDECIDED) | Not implemented |

---

## OPEN ARCHITECTURE DECISIONS

| Decision | Options | Impact |
|---|---|---|
| Backend language | Node.js vs Python | All of Phase 1 |
| Backend framework | Hono vs Express vs FastAPI | All of Phase 1 |
| Frontend framework | Static HTML vs React/Next.js | Phase 5+ (customer portal) |
| Queue system | Vercel Queues vs pg job table | Phase 3 (AI runner) |
| Cache | None vs Redis vs pg | Phase 3+ |
| File storage | Vercel Blob vs S3 | Phase 5+ (reports) |
| Auth provider | Custom vs Auth.js vs Clerk vs Supabase Auth | Phase 3 |
