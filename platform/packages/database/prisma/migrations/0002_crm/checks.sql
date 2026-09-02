-- BeBest platform — Epic 1 (CRM) CHECK constraints
--
-- `lead_source`/`lead_status`/`deal_stage`/`activity_type` are native Prisma
-- enums (Postgres ENUM types), not VARCHAR+CHECK — so unlike most of
-- 0000_init/checks.sql, no CHECK is needed for those columns; the database
-- type itself rejects an invalid value. The constraints below are the
-- genuine data-quality / cross-column checks Prisma's schema DSL still has
-- no syntax for.
--
-- Not applied automatically — see 0000_init/checks.sql's header for the
-- same caveat.

BEGIN;

-- leads.score is a 0-100 fit score, same shape as keywords.difficulty in
-- 0000_init/checks.sql.
ALTER TABLE leads ADD CONSTRAINT chk_leads_score_range
  CHECK (score IS NULL OR (score >= 0 AND score <= 100));

-- deals: value/probability are simple range checks.
ALTER TABLE deals ADD CONSTRAINT chk_deals_value_cents_non_negative
  CHECK (value_cents >= 0);
ALTER TABLE deals ADD CONSTRAINT chk_deals_probability_range
  CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));

-- activities: must be logged against at least one target (a lead, a deal,
-- or an account org) — enforced here as defense in depth even though
-- apps/api's Zod schema already requires it, matching this codebase's
-- general "don't trust the app layer alone" posture for anything the
-- database can cheaply verify itself.
ALTER TABLE activities ADD CONSTRAINT chk_activities_target_present
  CHECK (lead_id IS NOT NULL OR deal_id IS NOT NULL OR account_organization_id IS NOT NULL);

COMMIT;
