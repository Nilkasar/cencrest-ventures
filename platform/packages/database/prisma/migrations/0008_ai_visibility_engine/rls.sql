-- BeBest platform — Row-Level Security policy for Epic 7 (AI Visibility
-- Engine / GEO core)
--
-- Same template as prisma/migrations/0000_init/rls.sql: RLS ENABLEd +
-- FORCEd, single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK. Three new
-- tables this epic added — `ai_runs`, `ai_run_responses`,
-- `brand_observations` — all get the identical policy; nothing here reuses
-- or alters the legacy `ai_responses`/`prompt_jobs`/`runs`/`responses`
-- tables' own (pre-existing, untouched) RLS.
--
-- Not applied automatically — same caveat as every other migration folder
-- in this package: `prisma validate`/`generate` only, no live database.

BEGIN;

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_runs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE ai_run_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_run_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_run_responses
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE brand_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_observations
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
