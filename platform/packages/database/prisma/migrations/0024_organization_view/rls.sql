-- Epic 22 (Workspace Views), Phase 2 — Row-Level Security.
--
-- notification_preferences was listed in 0000_init/rls.sql as "user-scoped
-- preferences, not tenant data" and left without RLS. With 0024 it carries
-- organization_id and is read/written per organization
-- (`GET/PUT /api/orgs/me/notification-preferences`, and `notify()` inside
-- `withOrgContext`), so it gets the standard tenant_isolation policy like
-- every other tenant table — in the null-safe form 0020 introduced.
-- Per-USER visibility inside an org is enforced by the application's WHERE
-- clause (user_id = caller), the same split `notifications` uses.

BEGIN;

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON notification_preferences;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (organization_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid);

COMMIT;
