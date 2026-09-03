-- BeBest platform — Row-Level Security policy for Epic 12 (GEO Agent / SEO
-- Agent / Growth Agent)
--
-- Same template as every prior migration folder's rls.sql: RLS ENABLEd +
-- FORCEd, a single `tenant_isolation` policy comparing organization_id to
-- the `app.current_org` session variable, both USING and WITH CHECK.
-- `agent_runs`/`agent_events`/`agent_pending_actions` are all genuinely new
-- tables (see schema.prisma's "EPIC 12 — Agent Runner" comment block and
-- DECISIONS.md's Epic 12 section for why these are not a reuse of the
-- legacy `geo_agent_runs`/`seo_agent_runs`/`growth_agent_runs`/
-- `geo_agent_actions`/`seo_agent_actions` tables, which already had their
-- own `tenant_isolation` policy from 0000_init and are untouched here).
--
-- Not applied automatically — this package never connects to a database.
-- Run this (after every earlier epic folder's, in numeric order, alongside
-- the real `prisma migrate deploy`) against your own database once you have
-- a real DATABASE_URL.

BEGIN;

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_runs
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_events
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

ALTER TABLE agent_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_pending_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_pending_actions
  USING (organization_id = current_setting('app.current_org', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', TRUE)::uuid);

COMMIT;
