-- BeBest platform — Row-Level Security policies for Epic 3 (Website
-- Intelligence / Crawler)
--
-- Same template as prisma/migrations/0000_init/rls.sql: RLS ENABLEd +
-- FORCEd, single `tenant_isolation` policy comparing organization_id to
-- the `app.current_org` session variable, both USING and WITH CHECK.
--
-- `crawl_jobs`, `pages`, `page_issues` already got their tenant_isolation
-- policy in 0000_init (they were ported tables with organization_id added
-- during Epic 0's hardening pass — see DECISIONS.md §1's affected-tables
-- list). The field changes this epic makes to those three tables
-- (root_url, pages_failed, created_by, canonical_url, raw_html_hash, the
-- crawl_status/issue_severity enum value renames) do not touch
-- organization_id and do not require any RLS change.
--
-- `sitemaps` is the one genuinely new table this epic adds to
-- schema.prisma (see DECISIONS.md's Epic 3 section) and needs its policy
-- created here.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after 0000_init's
-- rls.sql/checks.sql and every earlier epic folder's, in numeric order,
-- alongside the real `prisma migrate deploy`) against your own database
-- once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE sitemaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sitemaps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sitemaps
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
