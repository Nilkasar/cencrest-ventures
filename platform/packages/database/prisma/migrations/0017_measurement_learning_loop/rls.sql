-- BeBest platform — Row-Level Security policy for Epic 14 (Measurement &
-- Learning Loop)'s two new tables.
--
-- Same template as every prior migration folder's rls.sql: RLS ENABLEd +
-- FORCEd, single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK.
--
-- `actions` already has RLS from 0000_init (this epic only added two
-- columns to it, not the table itself) — not repeated here.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after every earlier
-- epic folder's, in numeric order, alongside the real `prisma migrate
-- deploy`) against your own database once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON measurements
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE outcome_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outcome_records
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
