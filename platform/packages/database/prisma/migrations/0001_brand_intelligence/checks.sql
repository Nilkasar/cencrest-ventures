-- BeBest platform — CHECK constraint fix picked up while building Epic 2
--
-- The original chk_subscriptions_plan constraint (0000_init/checks.sql) was
-- missing 'pro' — docs/16-billing/BILLING_ARCHITECTURE.md and
-- docs/epics/02-brand-intelligence.md's entitlement table both define a
-- `pro` tier (competitors_tracked: 20), and apps/api/src/lib/entitlements.ts
-- ships a `pro` limit, but the DB-level constraint would have rejected the
-- value outright. Fixed forward (drop + recreate) rather than editing
-- 0000_init's already-committed file.
--
-- Not applied automatically — same caveat as 0000_init.

BEGIN;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_plan;
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscriptions_plan
  CHECK (plan IN ('free', 'starter', 'growth', 'pro', 'agency'));

COMMIT;
