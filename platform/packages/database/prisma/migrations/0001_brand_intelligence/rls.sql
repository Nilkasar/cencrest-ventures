-- BeBest platform — Row-Level Security policies for Epic 2 (Brand Intelligence)
--
-- Same template as prisma/migrations/0000_init/rls.sql: every tenant table
-- gets RLS ENABLEd + FORCEd (so the table owner is also subject to it) and a
-- single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, with both USING and WITH CHECK.
--
-- Covers the three tables added to schema.prisma in this epic:
-- brand_entities, use_cases, brand_claims. (`competitors` already has its
-- policy from 0000_init — the `priority`/`aliases` columns added to it here
-- don't change its RLS story.)
--
-- Not applied automatically — same caveat as 0000_init: this package never
-- connects to a database. Run this (after 0000_init's rls.sql/checks.sql,
-- and after the corresponding `prisma migrate` for the new tables/columns)
-- against your own database once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE brand_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_entities
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE use_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE use_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON use_cases
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE brand_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_claims
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
