-- BeBest platform — Epic 2 (Brand Intelligence) QA/contract-fix pass
--
-- Supersedes 0001_brand_intelligence/checks.sql's chk_subscriptions_plan
-- fix (which added 'pro' but not 'managed'/'enterprise'). A qa-flow-tester
-- pass found the frontend's Organization["plan"] type and apps/api's
-- PLAN_TIERS both incomplete against docs/16-billing/BILLING_ARCHITECTURE.md's
-- documented seven-tier list (free/starter/growth/pro/agency/managed/
-- enterprise) — fixing the CHECK constraint the same way keeps the DB-level
-- constraint from being the next place this same gap resurfaces.
--
-- Not applied automatically — same caveat as 0000_init and
-- 0001_brand_intelligence: this package never connects to a database.

BEGIN;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_plan;
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscriptions_plan
  CHECK (plan IN ('free', 'starter', 'growth', 'pro', 'agency', 'managed', 'enterprise'));

COMMIT;
