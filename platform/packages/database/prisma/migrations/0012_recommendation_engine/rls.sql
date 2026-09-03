-- BeBest platform — Row-Level Security policy for Epic 10 (Recommendation
-- Engine)
--
-- Same template as every prior migration folder's rls.sql (0000_init
-- through 0010_opportunity_engine): RLS ENABLEd + FORCEd, single
-- `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK.
-- `opportunity_recommendations` is a genuinely new table (see
-- schema.prisma's "Epic 10 — RECOMMENDATION ENGINE" comment block and
-- DECISIONS.md's Epic 10 section for why this is not a reuse of the
-- legacy, still-untouched `recommendations` table).
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after every earlier
-- epic folder's, in numeric order, alongside the real `prisma migrate
-- deploy`) against your own database once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE opportunity_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_recommendations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opportunity_recommendations
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
