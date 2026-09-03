-- BeBest platform — Row-Level Security policy for Epic 11 (Content
-- Intelligence & Generation)'s three new tables.
--
-- Same template as every prior migration folder's rls.sql (0000_init
-- through 0013_agency_white_label_integrations): RLS ENABLEd + FORCEd,
-- single `tenant_isolation` policy comparing organization_id to the
-- `app.current_org` session variable, both USING and WITH CHECK.
--
-- `content_briefs` already has RLS from 0000_init (this epic only added
-- columns to it, not the table itself) — not repeated here.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after every earlier
-- epic folder's, in numeric order, alongside the real `prisma migrate
-- deploy`) against your own database once you have a real DATABASE_URL.

BEGIN;

ALTER TABLE content_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_drafts
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE content_quality_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_quality_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_quality_checks
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE content_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_approvals
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
