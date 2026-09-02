-- BeBest platform — Epic 1 (CRM) Row-Level Security policies
--
-- Kept in its own epic-scoped folder rather than appended to
-- prisma/migrations/0000_init/rls.sql, matching the convention the schema
-- itself already forward-references for Epic 2 (schema.prisma's "Epic 2
-- (Brand Intelligence) additions" comment block). This folder was
-- originally created as `0001_crm` (Epic 1 in the roadmap); Epic 2 was
-- being built concurrently in the same repo and independently landed its
-- own migration at `0001_brand_intelligence`, so this one was renumbered to
-- `0002_crm` to resolve the collision rather than leave two folders
-- claiming `0001`. Neither is a real Prisma-generated migration (no
-- `migration.sql`, just hand-written SQL like `0000_init`), so nothing was
-- functionally broken either way — whoever runs the first real `prisma
-- migrate` against a live database picks the actual apply order then.
--
-- `leads`, `deals`, `activities` all get the exact same standard
-- `tenant_isolation` policy as every other tenant table in 0000_init/rls.sql
-- — `organization_id = current_setting('app.current_org', TRUE)::uuid`,
-- both USING and WITH CHECK. This is possible with ZERO special-casing
-- specifically because `organization_id` on all three tables is NOT NULL
-- and always resolves to the internal BeBest operations org (see
-- schema.prisma's "Epic 1 (CRM) additions" comment and
-- packages/database/DECISIONS.md's "Epic 1 — CRM" section for the full
-- reasoning) — CRM is an internal ops tool in v1, so there is exactly one
-- tenant context these three tables ever need to satisfy: the internal org
-- BeBest staff operate the CRM from (apps/api resolves its id from
-- `CRM_INTERNAL_ORG_ID`).
--
-- The business-level "which real customer does this belong to" links
-- (`leads.converted_organization_id`, `deals.account_organization_id`,
-- `activities.account_organization_id`) are NOT RLS-scoping columns and
-- carry no policy of their own — they are read/written from inside the same
-- internal-org-scoped transaction as everything else on these tables.
--
-- Not applied automatically — see 0000_init/rls.sql's header for the same
-- caveat: run this against your own database once you have a real
-- DATABASE_URL, after 0000_init/{rls,checks,indexes}.sql.

BEGIN;

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leads
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deals
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activities
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
