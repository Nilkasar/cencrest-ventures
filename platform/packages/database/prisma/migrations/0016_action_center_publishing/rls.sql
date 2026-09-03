-- BeBest platform — Row-Level Security policy for Epic 13 (Action Center &
-- Controlled Publishing)'s one genuinely new table.
--
-- Same template as every prior migration folder's rls.sql: RLS ENABLEd +
-- FORCEd, single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK.
--
-- `actions` already has RLS from 0000_init (this epic only added columns to
-- it, not the table itself) — not repeated here.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after every earlier
-- epic folder's, in numeric order, alongside the real `prisma migrate
-- deploy`) against your own database once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE published_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE published_content FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON published_content
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
