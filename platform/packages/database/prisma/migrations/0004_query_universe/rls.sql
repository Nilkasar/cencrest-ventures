-- BeBest platform — Row-Level Security policy for Epic 5 (Intent & Query
-- Universe)
--
-- Same template as prisma/migrations/0000_init/rls.sql: RLS ENABLEd +
-- FORCEd, single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK.
--
-- Only ONE new table needs a new policy here: `queries`. `query_sets`
-- already has its `tenant_isolation` policy from 0000_init (see that
-- file's ALTER TABLE query_sets lines) — the `query_count`/`version`/
-- `status` columns added to it in this epic's schema.prisma change don't
-- change its RLS story, same reasoning 0001_brand_intelligence's header
-- used for `competitors.priority`/`aliases`.
--
-- Not applied automatically — same caveat as every other migration folder
-- in this package: `prisma validate`/`generate` only, no live database.

BEGIN;

ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON queries
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
