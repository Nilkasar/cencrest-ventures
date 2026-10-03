-- Epic 22 (Workspace Views), Phase 0 — indexes.
--
-- These are also declared as `@@index` in schema.prisma (with the same
-- names), so a FRESH database already has them from db:apply's rendered
-- schema step; `IF NOT EXISTS` makes this file a no-op there and the thing
-- that creates them on an EXISTING database. See ddl.sql's header.
--
-- platform_access_events serves three reads in Phase 1's audit screen:
-- newest-first overall, per staff member, and per target organization.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_platform_access_events_created_at
  ON platform_access_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_access_events_user
  ON platform_access_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_access_events_target_org
  ON platform_access_events (target_org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_sessions_staff
  ON support_sessions (staff_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_sessions_org
  ON support_sessions (org_id, started_at DESC);

COMMIT;
