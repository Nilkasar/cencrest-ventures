-- BeBest platform — Epic 16 (Billing) CHECK constraints
--
-- Not applied automatically — same caveat as every other migration folder
-- in this package: `prisma validate`/`generate` only, no live database.

BEGIN;

-- `plans.slug` — closed, stable vocabulary (the seven documented tiers),
-- same "evolving-but-closed VARCHAR + CHECK" treatment DECISIONS.md §6
-- already gives `subscriptions.plan`/`actions.status`. Kept in sync with
-- `chk_subscriptions_plan` (0003_epic2_contract_fixes/checks.sql) — both
-- constraints must always list the same seven values.
ALTER TABLE plans ADD CONSTRAINT chk_plans_slug
  CHECK (slug IN ('free', 'starter', 'growth', 'pro', 'agency', 'managed', 'enterprise'));

-- `organizations.status` — new column (see schema.prisma's doc comment on
-- it). Only two values exist yet (BILLING_ARCHITECTURE.md's "DATA RETENTION
-- ON CANCELLATION" section never documents a third org-level status), so
-- this is intentionally a tight CHECK, not a speculative open list.
ALTER TABLE organizations ADD CONSTRAINT chk_organizations_status
  CHECK (status IN ('active', 'cancelled'));

COMMIT;
