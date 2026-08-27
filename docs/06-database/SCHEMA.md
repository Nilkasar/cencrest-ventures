# DATABASE SCHEMA — BeBest

**Version**: 1.0  
**Date**: 2026-08-11  
**Database**: PostgreSQL

---

## DESIGN PRINCIPLES

1. Every customer-data table has `organization_id` (multi-tenancy)
2. Row-level security enabled on all tenant tables
3. Soft delete pattern: `deleted_at TIMESTAMPTZ` (no hard deletes on customer data)
4. All timestamps in UTC, stored as `TIMESTAMPTZ`
5. UUIDs for all primary keys (no sequential integers exposed)
6. Enum types stored as PostgreSQL enums or constrained VARCHARs
7. JSONB for flexible metadata fields (with a note that important query fields should be normalized)

---

## SCHEMA GROUPS

```
1. Identity        — organizations, users, memberships, invitations
2. Brand           — brands, competitors, entities, use_cases, brand_claims
3. Website         — crawl_jobs, pages, page_issues, sitemaps
4. SEO             — keyword_groups, keywords, seo_analyses, seo_opportunities
5. GEO / AI        — query_sets, queries, ai_runs, ai_responses, brand_observations
6. Competitive     — competitor_runs, competitor_observations
7. Opportunity     — opportunities, opportunity_evidence, recommendations, actions
8. Content         — content_briefs, content_drafts, content_approvals, published_content
9. CRM             — leads, contacts, accounts, deals, activities
10. Billing        — plans, subscriptions, invoices, usage_records, entitlements
11. System         — audit_logs, jobs, notifications, prompt_versions
```

---

## 1. IDENTITY TABLES

```sql
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(100) UNIQUE NOT NULL,
  plan_id         UUID REFERENCES plans(id),
  status          VARCHAR(50) NOT NULL DEFAULT 'active',  -- active, suspended, cancelled
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255),
  avatar_url      TEXT,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  role            VARCHAR(50) NOT NULL,  -- owner, admin, analyst, editor, viewer
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE TABLE invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email           VARCHAR(255) NOT NULL,
  role            VARCHAR(50) NOT NULL,
  invited_by      UUID NOT NULL REFERENCES users(id),
  token           VARCHAR(255) UNIQUE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  token_hash      VARCHAR(255) UNIQUE NOT NULL,  -- hashed, never store raw
  expires_at      TIMESTAMPTZ NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);

CREATE TABLE magic_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) NOT NULL,
  token_hash      VARCHAR(255) UNIQUE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 2. BRAND INTELLIGENCE TABLES

```sql
CREATE TABLE brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name            VARCHAR(255) NOT NULL,
  website         TEXT NOT NULL,
  description     TEXT,
  industries      TEXT[],          -- ['logistics', 'supply-chain']
  categories      TEXT[],          -- ['freight-visibility', 'tms']
  markets         TEXT[],          -- ['north-america', 'enterprise']
  aliases         TEXT[],          -- alternative names AI might use
  positioning     TEXT,
  differentiators TEXT[],
  primary_url     TEXT,            -- canonical homepage URL
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE competitors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  brand_id        UUID NOT NULL REFERENCES brands(id),
  name            VARCHAR(255) NOT NULL,
  website         TEXT,
  aliases         TEXT[],
  priority        SMALLINT NOT NULL DEFAULT 1,  -- 1=primary, 2=secondary, 3=watch
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  brand_id        UUID NOT NULL REFERENCES brands(id),
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(50) NOT NULL,  -- product, service, category, concept, person, location
  description     TEXT,
  aliases         TEXT[],
  schema_type     VARCHAR(100),          -- schema.org type
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE use_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  brand_id        UUID NOT NULL REFERENCES brands(id),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  industries      TEXT[],
  company_sizes   TEXT[],           -- smb, mid-market, enterprise
  pain_points     TEXT[],
  solutions       TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE brand_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  brand_id        UUID NOT NULL REFERENCES brands(id),
  claim           TEXT NOT NULL,
  evidence        TEXT,
  evidence_url    TEXT,
  confidence      VARCHAR(20) NOT NULL DEFAULT 'medium',  -- high, medium, low
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. GEO / AI TABLES

```sql
CREATE TABLE query_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  brand_id        UUID NOT NULL REFERENCES brands(id),
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  query_count     INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1,
  status          VARCHAR(50) NOT NULL DEFAULT 'draft',  -- draft, active, archived
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE queries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_set_id    UUID NOT NULL REFERENCES query_sets(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  text            TEXT NOT NULL,
  intent_type     VARCHAR(50),  -- informational, commercial, comparison, transactional
  category        VARCHAR(100),
  tags            TEXT[],
  priority        SMALLINT NOT NULL DEFAULT 2,  -- 1=high, 2=medium, 3=low
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  brand_id        UUID NOT NULL REFERENCES brands(id),
  query_set_id    UUID NOT NULL REFERENCES query_sets(id),
  name            VARCHAR(255),
  providers       TEXT[] NOT NULL,   -- ['openai', 'anthropic', 'google', 'perplexity']
  status          VARCHAR(50) NOT NULL DEFAULT 'queued',
  total_jobs      INTEGER NOT NULL DEFAULT 0,
  completed_jobs  INTEGER NOT NULL DEFAULT 0,
  failed_jobs     INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  ai_visibility_score       NUMERIC(5,2),
  scoring_formula_version   VARCHAR(20),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_responses (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                    UUID NOT NULL REFERENCES ai_runs(id),
  query_id                  UUID NOT NULL REFERENCES queries(id),
  organization_id           UUID NOT NULL REFERENCES organizations(id),
  provider                  VARCHAR(50) NOT NULL,
  model                     VARCHAR(100) NOT NULL,
  prompt_version            VARCHAR(20) NOT NULL,
  temperature               NUMERIC(3,2),
  raw_response              TEXT NOT NULL,
  response_word_count       INTEGER,
  tokens_used_input         INTEGER,
  tokens_used_output        INTEGER,
  latency_ms                INTEGER,
  error                     TEXT,            -- null if successful
  timestamp                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id                UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE brand_observations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id                 UUID NOT NULL REFERENCES ai_responses(id),
  organization_id             UUID NOT NULL REFERENCES organizations(id),
  brand_id                    UUID NOT NULL REFERENCES brands(id),
  brand_mentioned             BOOLEAN NOT NULL DEFAULT FALSE,
  brand_first_position        NUMERIC(5,4),   -- 0.0 to 1.0
  brand_mention_count         SMALLINT NOT NULL DEFAULT 0,
  brand_sentiment             VARCHAR(20),    -- positive, neutral, negative, mixed
  brand_context               TEXT,           -- excerpt around brand mention
  brand_recommended           BOOLEAN NOT NULL DEFAULT FALSE,
  brand_recommendation_strength VARCHAR(20),  -- strong, weak, implied
  competitors_mentioned       TEXT[],
  cited_urls                  TEXT[],
  cited_domains               TEXT[],
  extraction_model            VARCHAR(100),
  extraction_prompt_version   VARCHAR(20),
  extraction_confidence       VARCHAR(20),    -- high, medium, low
  mention_score               NUMERIC(5,2),
  recommendation_score        NUMERIC(5,2),
  position_score              NUMERIC(5,2),
  scoring_formula_version     VARCHAR(20),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. OPPORTUNITY TABLES

```sql
CREATE TABLE opportunities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id),
  brand_id              UUID NOT NULL REFERENCES brands(id),
  title                 VARCHAR(500) NOT NULL,
  description           TEXT,
  type                  VARCHAR(50) NOT NULL,  -- seo, geo, unified, content, technical
  intent                TEXT,                  -- the buyer intent this opportunity serves
  seo_demand_score      NUMERIC(5,2),          -- 0-100
  geo_gap_score         NUMERIC(5,2),          -- 0-100 (how large is the gap?)
  effort_score          NUMERIC(5,2),          -- 0-100 (higher = more effort)
  impact_score          NUMERIC(5,2),          -- 0-100 (combined demand + gap)
  opportunity_score     NUMERIC(5,2),          -- final priority score
  scoring_formula_version VARCHAR(20),
  status                VARCHAR(50) NOT NULL DEFAULT 'open',
  priority              SMALLINT NOT NULL DEFAULT 2,
  assigned_to           UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);

CREATE TABLE opportunity_evidence (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id    UUID NOT NULL REFERENCES opportunities(id),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  evidence_type     VARCHAR(50) NOT NULL,   -- ai_response, seo_data, competitor_data
  source_id         UUID,                   -- ID in source table
  source_table      VARCHAR(100),           -- 'ai_responses', 'keywords', etc.
  summary           TEXT NOT NULL,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id    UUID NOT NULL REFERENCES opportunities(id),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  title             VARCHAR(500) NOT NULL,
  description       TEXT NOT NULL,
  action_type       VARCHAR(100) NOT NULL,  -- create_page, update_page, fix_technical, build_citations
  effort            VARCHAR(20) NOT NULL,   -- low, medium, high
  impact            VARCHAR(20) NOT NULL,   -- low, medium, high
  priority_rank     INTEGER,
  evidence_summary  TEXT,
  implementation_notes TEXT,
  status            VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  title             VARCHAR(500) NOT NULL,
  action_type       VARCHAR(100) NOT NULL,
  autonomy_level    SMALLINT NOT NULL DEFAULT 1,  -- 1=recommend, 2=draft, 3=approve+exec, 4=autonomous
  status            VARCHAR(50) NOT NULL DEFAULT 'pending',
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  executed_at       TIMESTAMPTZ,
  rolled_back_at    TIMESTAMPTZ,
  result            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5. CRM TABLES

```sql
CREATE TABLE leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) NOT NULL,
  name              VARCHAR(255),
  company           VARCHAR(255),
  website           TEXT,
  category          VARCHAR(255),
  notes             TEXT,
  source            VARCHAR(100),    -- free_snapshot, apply_form, direct, referral
  source_url        TEXT,
  status            VARCHAR(50) NOT NULL DEFAULT 'new',  -- new, contacted, qualified, converted, lost
  score             SMALLINT,
  assigned_to       UUID REFERENCES users(id),
  converted_at      TIMESTAMPTZ,
  organization_id   UUID REFERENCES organizations(id),   -- set when converted
  snapshot_id       UUID,            -- reference to free snapshot run
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE activities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID REFERENCES leads(id),
  organization_id   UUID REFERENCES organizations(id),
  actor_id          UUID REFERENCES users(id),
  type              VARCHAR(50) NOT NULL,   -- note, email, call, snapshot_requested, signup
  subject           VARCHAR(500),
  body              TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. BILLING TABLES

```sql
CREATE TABLE plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(100) NOT NULL,   -- free, starter, growth, pro, agency, enterprise
  slug              VARCHAR(50) UNIQUE NOT NULL,
  description       TEXT,
  price_monthly     INTEGER,                 -- cents, null if custom/contact
  price_yearly      INTEGER,                 -- cents with yearly discount
  currency          VARCHAR(3) NOT NULL DEFAULT 'USD',
  limits            JSONB NOT NULL DEFAULT '{}',   -- query_limit, page_limit, competitor_limit, etc.
  features          JSONB NOT NULL DEFAULT '{}',   -- feature flags
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id),
  plan_id               UUID NOT NULL REFERENCES plans(id),
  external_id           VARCHAR(255),        -- Stripe subscription ID
  status                VARCHAR(50) NOT NULL,  -- active, trialing, past_due, cancelled
  current_period_start  TIMESTAMPTZ NOT NULL,
  current_period_end    TIMESTAMPTZ NOT NULL,
  trial_ends_at         TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usage_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  subscription_id   UUID NOT NULL REFERENCES subscriptions(id),
  metric            VARCHAR(100) NOT NULL,   -- ai_queries, pages_analyzed, snapshots
  quantity          INTEGER NOT NULL,
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 7. SYSTEM TABLES

```sql
CREATE TABLE audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID,                    -- null for system events
  actor_id          UUID,                    -- null for automated events
  actor_type        VARCHAR(50),             -- user, system, agent
  action            VARCHAR(200) NOT NULL,
  resource_type     VARCHAR(100),
  resource_id       UUID,
  ip_address        INET,
  user_agent        TEXT,
  result            VARCHAR(20) NOT NULL,    -- success, failure
  details           JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID REFERENCES organizations(id),
  type              VARCHAR(100) NOT NULL,   -- ai_run, website_crawl, seo_analysis, report_generation
  status            VARCHAR(50) NOT NULL DEFAULT 'queued',
  priority          SMALLINT NOT NULL DEFAULT 2,
  payload           JSONB NOT NULL DEFAULT '{}',
  result            JSONB,
  error             TEXT,
  attempts          SMALLINT NOT NULL DEFAULT 0,
  max_attempts      SMALLINT NOT NULL DEFAULT 3,
  run_after         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prompt_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(200) NOT NULL,
  version           VARCHAR(20) NOT NULL,
  content           TEXT NOT NULL,
  variables         TEXT[],                  -- expected template variables
  notes             TEXT,
  deprecated_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, version)
);
```

---

## INDEXES

```sql
-- Tenant lookup (on every multi-tenant table)
CREATE INDEX idx_brands_org ON brands(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ai_responses_run ON ai_responses(run_id);
CREATE INDEX idx_ai_responses_org ON ai_responses(organization_id);
CREATE INDEX idx_brand_observations_response ON brand_observations(response_id);
CREATE INDEX idx_opportunities_org_score ON opportunities(organization_id, opportunity_score DESC) WHERE dismissed_at IS NULL;
CREATE INDEX idx_leads_status ON leads(status, created_at DESC);
CREATE INDEX idx_jobs_status_priority ON jobs(status, priority, run_after) WHERE status = 'queued';
CREATE INDEX idx_audit_logs_org_action ON audit_logs(organization_id, created_at DESC);
```

---

## ROW-LEVEL SECURITY (applied to all tenant tables)

```sql
-- Enable RLS
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
-- (repeat for all tenant tables)

-- Tenant isolation policy
CREATE POLICY tenant_isolation ON brands
  USING (organization_id = current_setting('app.current_org', TRUE)::UUID);

-- Application middleware sets this before every query:
-- SET LOCAL app.current_org = '<org_uuid>';
```
