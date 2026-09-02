-- BeBest platform — Row-Level Security policies
--
-- ADR-005 / docs/08-security/SECURITY.md: tenant isolation is enforced at
-- the database level, not just in application code. Every tenant table gets
-- RLS enabled + FORCEd (so even the table owner is subject to the policy —
-- without FORCE, RLS is bypassed for the role that owns the table, which is
-- typically the migration/admin role the app also connects as) and a single
-- `tenant_isolation` policy that compares `organization_id` to the
-- `app.current_org` session variable set by the API's tenant-context
-- middleware (see apps/api/src/middleware/tenant-context.ts) via
-- `SET LOCAL app.current_org = '<org_uuid>'` at the start of every request's
-- transaction.
--
-- Both USING and WITH CHECK clauses are set so a row can neither be read
-- NOR written across a tenant boundary (WITH CHECK alone would still allow
-- reads; USING alone would still allow inserting rows into another org).
--
-- `current_setting('app.current_org', TRUE)` uses the "missing_ok" form so
-- a session that never called SET LOCAL (e.g. a raw psql session, or a bug
-- in the app) gets NULL, and `organization_id = NULL` is never true in SQL
-- — so the safe failure mode is "see nothing" (fail closed), not
-- "authorization error" or, worse, "see everything."
--
-- This file is NOT applied automatically. Run it as a normal migration
-- against your own database once you have a real DATABASE_URL — the
-- Epic 0 build explicitly never connects to a database, per its brief.
-- Prisma does not manage RLS policies (ADR-009 consequence), so this SQL
-- is hand-written and must be re-reviewed any time a new tenant table is
-- added to schema.prisma.
--
-- Tables intentionally WITHOUT RLS (see DECISIONS.md for the full reasoning):
--   organizations                — identity/lookup table queried BEFORE
--                                  app.current_org can be set (e.g. "which
--                                  orgs does this user belong to" during
--                                  login / org switching). Protected by
--                                  application-layer membership checks
--                                  instead (SECURITY.md: "Organization ID
--                                  validated against user's memberships").
--                                  (`memberships` DOES have RLS — see the
--                                  "Special case — memberships" note below;
--                                  it just isn't the standard
--                                  organization_id policy.)
--   users, sessions, refresh_tokens, magic_link_tokens,
--   password_reset_tokens, auth_events                — user-scoped, not
--                                  tenant-scoped. Protected by user_id
--                                  ownership checks at the application layer.
--   invitations                  — tenant-scoped in every other respect,
--                                  but redeemed by an unguessable token
--                                  before the caller has any org context
--                                  to prove — see "Special case —
--                                  invitations" below.
--   ai_providers, ai_models, prompt_templates, prompt_versions,
--   evaluation_datasets, evaluation_items, evaluation_runs,
--   notification_preferences    — platform reference data / user-scoped
--                                  preferences, not tenant data.
--   form_submissions, snapshot_requests — pre-signup public flows with no
--                                  organization_id yet.
--   organization_rate_limits    — infra bookkeeping, not customer data. It
--                                  must be writable by the SAME `bebest_app`
--                                  role both for anonymous, pre-auth,
--                                  IP-keyed buckets (organization_id IS
--                                  NULL — auth-endpoint brute-force limits,
--                                  the free-snapshot-per-IP limit) and for
--                                  per-org buckets, often before any tenant
--                                  context is established for the request
--                                  (rate limiting is the FIRST middleware to
--                                  run, ahead of JWT verification). An
--                                  organization_id = NULL row can never
--                                  satisfy `organization_id = current_org`,
--                                  so RLS here would make anonymous rate
--                                  limiting silently non-functional (every
--                                  check would see zero prior requests).
--                                  Safety instead comes from the table's own
--                                  `bucket_key` design: a caller can only
--                                  ever construct and query its OWN bucket
--                                  key (derived from its own IP or org id),
--                                  never another tenant's.
--
-- Special case — memberships: this table's policy is an OR of BOTH
-- `user_id = app.current_user` AND `organization_id = app.current_org`,
-- because two genuinely different access patterns both need to work:
--   1. "which orgs am I in" (org-switcher, post-login) — a user reading
--      their OWN rows across MANY orgs, before any single org has been
--      chosen. Needs user_id-scoped visibility.
--   2. "list every member of org X" (an admin managing their team) — one
--      user reading OTHER users' rows, all within ONE org. Needs
--      organization_id-scoped visibility.
-- A single-column policy can only satisfy one of these. The OR is safe
-- because each clause is independently, correctly scoped on its own: the
-- user_id clause never exposes another user's row (it only ever matches
-- rows where user_id equals the caller), and the organization_id clause
-- never exposes another org's rows (it only matches the one org actually
-- selected) — so there is no scenario where satisfying one clause leaks
-- data the other clause wasn't already supposed to allow.
-- `withUserContext` (sets only app.current_user) is used for pattern 1;
-- `withOrgContext` (sets only app.current_org) or `withUserAndOrgContext`
-- (sets both) is used for pattern 2 — see client.ts.
--
-- Special case — invitations: NOT RLS'd, even though it has a normal
-- single `organization_id` column and is otherwise a textbook tenant
-- table. Accepting an invitation looks it up by its unguessable
-- `token_hash` — at that moment the caller does not yet know (and must
-- not have to prove membership of) the organization the invitation
-- belongs to; that's the whole point of an invitation. An org-scoped
-- policy would make `SELECT ... WHERE token_hash = $1` return zero rows
-- for anyone not already a member of the target org, i.e. it would make
-- invitation acceptance impossible for the exact people invitations exist
-- for. This is the same reasoning as `magic_link_tokens`/
-- `password_reset_tokens`/`refresh_tokens` below: a sufficiently random,
-- hashed, single-use token IS the access control for this table, not row
-- ownership. `apps/api`'s invitation-management endpoints (create/list/
-- cancel) still filter by `organization_id` in their own WHERE clauses —
-- they just don't get a second, redundant DB-level check for it.
--
-- Special case — agency_clients: this table has TWO organization
-- references (agency_org_id, client_org_id) instead of a single
-- `organization_id`, because it represents the relationship itself. The
-- policy below scopes visibility to the AGENCY side only (the side that
-- owns/manages the relationship). A client org viewing "which agency
-- manages us" is a deliberately narrower, separate read path (a small
-- dedicated view/RPC) rather than a blanket RLS grant — see DECISIONS.md.

BEGIN;

ALTER TABLE agency_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_clients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agency_clients
  USING (agency_org_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (agency_org_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY user_or_org_isolation ON memberships
  USING (
    user_id = current_setting('app.current_user', TRUE)::uuid
    OR organization_id = current_setting('app.current_org', TRUE)::uuid
  )
  WITH CHECK (
    user_id = current_setting('app.current_user', TRUE)::uuid
    OR organization_id = current_setting('app.current_org', TRUE)::uuid
  );

-- invitations is deliberately NOT RLS'd — see the "Special case —
-- invitations" note above.

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON background_jobs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

-- organization_rate_limits is deliberately NOT RLS'd — see the note above
-- the "Tables intentionally WITHOUT RLS" list at the top of this file.

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_records
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_usage
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE account_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_health FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account_health
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE customer_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_health_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_health_checks
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_contacts
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_notes
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing_campaigns
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE entrepreneur_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE entrepreneur_stories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entrepreneur_stories
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integrations
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE org_ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_ai_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_ai_providers
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE white_label_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE white_label_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON white_label_configs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brands
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE brand_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_aliases
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE brand_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_categories
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON competitors
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE audiences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audiences
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE brand_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_services
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE intents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intents
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE buyer_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_journeys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON buyer_journeys
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE crawl_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crawl_jobs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pages
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE page_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON page_issues
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE content_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_analyses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_analyses
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keywords
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE keyword_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_clusters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keyword_clusters
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE brand_keyword_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_keyword_rankings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_keyword_rankings
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE gsc_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gsc_connections
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE query_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_sets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON query_sets
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON questions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE query_set_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_set_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON query_set_questions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON runs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON responses
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analyses
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE analysis_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analysis_findings
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entities
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE category_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_associations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON category_associations
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE competitor_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_mentions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON competitor_mentions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recommendations
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON score_history
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scores
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reports
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE prompt_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON prompt_runs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE prompt_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON prompt_jobs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE ai_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_responses
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON citations
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE mention_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mention_extractions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mention_extractions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE visibility_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON visibility_scores
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE share_of_voice ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_of_voice FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON share_of_voice
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE competitor_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_visibility FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON competitor_visibility
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE gap_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE gap_analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gap_analysis
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE geo_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_gaps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON geo_gaps
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opportunities
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE content_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_briefs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_briefs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE generated_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_content FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON generated_content
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE publish_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON publish_jobs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON actions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE geo_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_agent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON geo_agent_runs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE geo_agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_agent_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON geo_agent_actions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE seo_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_agent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON seo_agent_runs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE seo_agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_agent_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON seo_agent_actions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE growth_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_agent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_agent_runs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE autonomous_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomous_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON autonomous_schedules
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE autonomous_run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomous_run_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON autonomous_run_logs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE learning_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON learning_signals
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE learning_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_insights FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON learning_insights
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE growth_levers ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_levers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_levers
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON experiments
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE experiment_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON experiment_measurements
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE measurement_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_points FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON measurement_points
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE measurement_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_annotations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON measurement_annotations
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

-- audit_events has a nullable organization_id (system/platform-level events
-- have no org). The policy above naturally hides those rows from every
-- tenant session (organization_id = NULL is never TRUE) without needing a
-- special-case clause — they remain visible only to a service-role
-- connection that bypasses RLS (e.g. BYPASSRLS role or superuser), which is
-- exactly the BeBest-staff-only access model SECURITY.md calls for.

COMMIT;
