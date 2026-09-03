-- BeBest platform — Row-Level Security policies for Epic 9 (Opportunity Engine)
--
-- Same template as prisma/migrations/0000_init/rls.sql: RLS ENABLEd +
-- FORCEd, single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK. Both tables
-- this epic adds (`unified_opportunities`, `opportunity_evidence`) are
-- genuinely new — see schema.prisma's "Epic 9 — OPPORTUNITY ENGINE" comment
-- block and DECISIONS.md's Epic 9 section for why this is not a reuse of the
-- legacy, still-untouched `opportunities` table or Epic 4's `seo_opportunities`.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after 0000_init's
-- rls.sql/checks.sql and every earlier epic folder's, in numeric order,
-- alongside the real `prisma migrate deploy`) against your own database
-- once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE unified_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON unified_opportunities
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE opportunity_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opportunity_evidence
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
