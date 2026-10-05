-- Epic 22 (Workspace Views), Phase 0 — CHECK constraints.
--
-- Same "VARCHAR + CHECK on a genuinely closed vocabulary" discipline every
-- earlier checks.sql follows (DECISIONS.md §6), rather than native enums.

BEGIN;

-- users.platform_role: none | support | admin. `none` is every customer;
-- the ordering support < admin is applied in
-- apps/api/src/middleware/platform-role.ts.
ALTER TABLE users ADD CONSTRAINT chk_users_platform_role
  CHECK (platform_role IN ('none', 'support', 'admin'));

-- organizations.kind: customer | agency | internal.
ALTER TABLE organizations ADD CONSTRAINT chk_organizations_kind
  CHECK (kind IN ('customer', 'agency', 'internal'));

-- A row is only ever written for a request the guard ALLOWED, so the role
-- recorded is always a real staff role — never `none`.
ALTER TABLE platform_access_events ADD CONSTRAINT chk_platform_access_events_platform_role
  CHECK (platform_role IN ('support', 'admin'));

ALTER TABLE platform_access_events ADD CONSTRAINT chk_platform_access_events_method
  CHECK (method IN ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'));

-- A support session must say why it exists, and its timeline must be in
-- order: it cannot expire or end before it started.
ALTER TABLE support_sessions ADD CONSTRAINT chk_support_sessions_reason
  CHECK (length(btrim(reason)) > 0);

ALTER TABLE support_sessions ADD CONSTRAINT chk_support_sessions_expires_after_start
  CHECK (expires_at > started_at);

ALTER TABLE support_sessions ADD CONSTRAINT chk_support_sessions_ended_after_start
  CHECK (ended_at IS NULL OR ended_at >= started_at);

COMMIT;
