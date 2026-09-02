-- BeBest platform — CHECK constraints for Epic 5 post-verification fixes
--
-- A qa-flow-tester-persona review found the Query Universe frontend never
-- wired to the real API, a frontend/backend contract mismatch (five
-- QuerySet fields and one Query field the frontend needed but the backend
-- never persisted), and two real backend bugs (no single-active-query-set
-- enforcement, entitlement cap bypassable on manual add). This migration
-- covers the two new closed-vocabulary columns added to close the contract
-- gap — see packages/database/DECISIONS.md §18 and
-- docs/epics/05-intent-query-universe-backend.md's "Post-verification
-- fixes" section for the full account.
--
-- Not applied automatically — same caveat as every other migration folder
-- in this package: `prisma validate`/`generate` only, no live database.

BEGIN;

-- query_sets.plan_tier — the full 7-tier PlanTier enum apps/api/src/lib/
-- entitlements.ts defines (free/starter/growth/pro/agency/managed/
-- enterprise), frozen onto the row at `generate` time. Deliberately the
-- FULL 7-tier list, not the 4-value list 0000_init/checks.sql's
-- chk_subscriptions_plan allows (free/starter/growth/agency) — that
-- pre-existing gap on `subscriptions.plan` is untouched here, out of scope
-- for this epic's fix; `query_sets.plan_tier` is a snapshot copy, not a FK,
-- so it isn't bound by the source column's (incomplete) CHECK.
ALTER TABLE query_sets ADD CONSTRAINT chk_query_sets_plan_tier
  CHECK (plan_tier IN ('free', 'starter', 'growth', 'pro', 'agency', 'managed', 'enterprise'));

-- queries.source — generated | manual. The frontend's `Query.source`
-- provenance badge (a "Manual" tag distinguishing a human-curated query from
-- the template generator's output) is genuinely rendered in the review UI,
-- so it gets a real, closed column rather than being dropped from the
-- frontend type.
ALTER TABLE queries ADD CONSTRAINT chk_queries_source
  CHECK (source IN ('generated', 'manual'));

COMMIT;
