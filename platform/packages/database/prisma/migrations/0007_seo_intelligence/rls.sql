-- BeBest platform — Row-Level Security policies for Epic 4 (SEO Intelligence)
--
-- Same template as prisma/migrations/0000_init/rls.sql: RLS ENABLEd +
-- FORCEd, single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK. All four
-- tables this epic adds (`keyword_groups`, `seo_keywords`, `seo_analyses`,
-- `seo_opportunities`) are genuinely new — none of them existed under any
-- name before this epic (see schema.prisma's "Epic 4 (SEO Intelligence)
-- additions" comment block and DECISIONS.md's Epic 4 section for why this
-- is not a reuse of the legacy, still-untouched `keywords` table) — so all
-- four need their policy created here, unlike Epic 3/5's migrations which
-- only added a policy for the one or two genuinely-new tables in an
-- otherwise-already-RLS'd group.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after 0000_init's
-- rls.sql/checks.sql and every earlier epic folder's, in numeric order,
-- alongside the real `prisma migrate deploy`) against your own database
-- once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE keyword_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keyword_groups
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_keywords FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON seo_keywords
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE seo_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_analyses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON seo_analyses
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE seo_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON seo_opportunities
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
