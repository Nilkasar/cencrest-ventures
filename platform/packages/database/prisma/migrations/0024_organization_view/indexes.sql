-- Epic 22 (Workspace Views), Phase 2 — indexes.
--
-- Declared in schema.prisma with the same name (`map:`), so a FRESH database
-- already has it from db:apply's rendered-schema step; `IF NOT EXISTS` makes
-- this a no-op there and the thing that creates it on an EXISTING database.
--
-- One preference row per (organization, user, type, channel). Also serves
-- the only read — "this user's preferences in this org" — by its prefix.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_prefs_org_user_type_channel
  ON notification_preferences (organization_id, user_id, notification_type, channel);

COMMIT;
