-- BeBest platform — CHECK constraints on enum-like VARCHAR columns
--
-- Prisma's schema.prisma does not have first-class syntax for arbitrary
-- CHECK constraints (ADR-009 consequence — Prisma manages columns/types/FKs,
-- not CHECKs), so these are hand-written and applied alongside rls.sql.
--
-- Scope: only columns with a genuinely closed, stable value set got a CHECK
-- here. Free-text taxonomies that are extensible by design (action_type
-- registries, integration config "source" fields, dynamic metric names,
-- etc.) were deliberately left unconstrained — inventing a fixed list for
-- those would encode a business decision nobody has made yet. See
-- DECISIONS.md for the reasoning per table.
--
-- Not applied automatically — see rls.sql header for the same caveat.

BEGIN;

-- actions
ALTER TABLE actions ADD CONSTRAINT chk_actions_priority
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));
ALTER TABLE actions ADD CONSTRAINT chk_actions_status
  CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed'));

-- agency_clients
ALTER TABLE agency_clients ADD CONSTRAINT chk_agency_clients_relationship_type
  CHECK (relationship_type IN ('managed', 'consulting', 'referral'));
ALTER TABLE agency_clients ADD CONSTRAINT chk_agency_clients_access_level
  CHECK (access_level IN ('full', 'limited', 'read_only'));
ALTER TABLE agency_clients ADD CONSTRAINT chk_agency_clients_status
  CHECK (status IN ('active', 'paused', 'terminated'));

-- audit_events
ALTER TABLE audit_events ADD CONSTRAINT chk_audit_events_result
  CHECK (result IN ('success', 'failure'));
ALTER TABLE audit_events ADD CONSTRAINT chk_audit_events_actor_type
  CHECK (actor_type IN ('user', 'system', 'agent'));

-- autonomous_run_logs
ALTER TABLE autonomous_run_logs ADD CONSTRAINT chk_autonomous_run_logs_status
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled'));

-- content_briefs
ALTER TABLE content_briefs ADD CONSTRAINT chk_content_briefs_status
  CHECK (status IN ('draft', 'in_review', 'approved', 'archived'));

-- customer_health_checks
ALTER TABLE customer_health_checks ADD CONSTRAINT chk_customer_health_checks_churn_risk
  CHECK (churn_risk IN ('low', 'medium', 'high'));

-- entrepreneur_stories
ALTER TABLE entrepreneur_stories ADD CONSTRAINT chk_entrepreneur_stories_status
  CHECK (status IN ('draft', 'published', 'archived'));

-- experiments
ALTER TABLE experiments ADD CONSTRAINT chk_experiments_status
  CHECK (status IN ('draft', 'running', 'completed', 'archived'));
ALTER TABLE experiments ADD CONSTRAINT chk_experiments_winner
  CHECK (winner IS NULL OR winner IN ('control', 'variant', 'inconclusive'));

-- experiment_measurements
ALTER TABLE experiment_measurements ADD CONSTRAINT chk_experiment_measurements_variant
  CHECK (variant IN ('control', 'variant'));

-- generated_content
ALTER TABLE generated_content ADD CONSTRAINT chk_generated_content_status
  CHECK (status IN ('draft', 'approved', 'published', 'rejected'));

-- geo_agent_runs
ALTER TABLE geo_agent_runs ADD CONSTRAINT chk_geo_agent_runs_status
  CHECK (status IN ('pending', 'running', 'completed', 'failed'));
ALTER TABLE geo_agent_runs ADD CONSTRAINT chk_geo_agent_runs_trigger
  CHECK (trigger IN ('manual', 'scheduled'));

-- geo_agent_actions
ALTER TABLE geo_agent_actions ADD CONSTRAINT chk_geo_agent_actions_status
  CHECK (status IN ('pending', 'completed', 'failed'));

-- seo_agent_runs
ALTER TABLE seo_agent_runs ADD CONSTRAINT chk_seo_agent_runs_status
  CHECK (status IN ('pending', 'running', 'completed', 'failed'));
ALTER TABLE seo_agent_runs ADD CONSTRAINT chk_seo_agent_runs_trigger
  CHECK (trigger IN ('manual', 'scheduled'));

-- seo_agent_actions
ALTER TABLE seo_agent_actions ADD CONSTRAINT chk_seo_agent_actions_status
  CHECK (status IN ('pending', 'completed', 'failed'));

-- growth_agent_runs
ALTER TABLE growth_agent_runs ADD CONSTRAINT chk_growth_agent_runs_status
  CHECK (status IN ('pending', 'running', 'completed', 'failed'));
ALTER TABLE growth_agent_runs ADD CONSTRAINT chk_growth_agent_runs_trigger
  CHECK (trigger IN ('manual', 'scheduled'));

-- growth_levers
ALTER TABLE growth_levers ADD CONSTRAINT chk_growth_levers_effort_level
  CHECK (effort_level IN ('low', 'medium', 'high'));
ALTER TABLE growth_levers ADD CONSTRAINT chk_growth_levers_status
  CHECK (status IN ('identified', 'planned', 'active', 'completed', 'abandoned'));

-- keywords (data-quality checks, not just enum-likes)
ALTER TABLE keywords ADD CONSTRAINT chk_keywords_volume_non_negative
  CHECK (volume IS NULL OR volume >= 0);
ALTER TABLE keywords ADD CONSTRAINT chk_keywords_difficulty_range
  CHECK (difficulty IS NULL OR (difficulty >= 0 AND difficulty <= 100));

-- marketing_campaigns
ALTER TABLE marketing_campaigns ADD CONSTRAINT chk_marketing_campaigns_status
  CHECK (status IN ('draft', 'active', 'paused', 'completed'));

-- publish_jobs
ALTER TABLE publish_jobs ADD CONSTRAINT chk_publish_jobs_status
  CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'rejected'));

-- recommendations
ALTER TABLE recommendations ADD CONSTRAINT chk_recommendations_strength
  CHECK (recommendation_strength IS NULL OR recommendation_strength IN ('strong', 'moderate', 'weak'));

-- subscriptions — must match apps/api plan-limits config (see @bebest/database DECISIONS.md)
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscriptions_plan
  CHECK (plan IN ('free', 'starter', 'growth', 'agency'));

COMMIT;
