-- 0024 — Epic 22 (Workspace Views), Phase 2: the Organization view
-- (platform/docs/epics/22-workspace-views.md, "Phase 2").
--
--   brands.onboarding_completed_at       onboarding state on the server
--   organizations.autonomy_level_max     org-wide agent autonomy ceiling (1–3)
--   notification_type 'invitation_accepted'
--   notification_preferences             widened to per-user PER-ORG
--                                        (organization_id + new unique key);
--                                        RLS in rls.sql
--
-- WHY EVERY STATEMENT HERE IS "IF NOT EXISTS" — same reason as 0023's
-- ddl.sql: on a FRESH database `db:apply` has already rendered all of this
-- from schema.prisma before this file runs, so it must be a no-op there; on
-- an EXISTING database this file is the only thing that adds it. Names are
-- Prisma's own (`<table>_<column>_fkey`, the explicit `map:` names), so both
-- paths converge on an identical schema.

BEGIN;

-- ── brands.onboarding_completed_at ─────────────────────────────────────────
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ(6);

-- Backfill. Before this column the wizard's "completed" flag lived only in
-- the browser (localStorage), so every brand that already exists would
-- otherwise be routed back to /onboarding on next login. A brand counts as
-- onboarded if it meets exactly the rule `POST /brands/me/onboarding/
-- complete` now enforces server-side (lib/onboarding/complete.ts): a
-- non-blank name, at least one industry, at least one live competitor and
-- at least three live use cases. Brands that never got that far stay NULL
-- and are (correctly) sent to finish onboarding. `updated_at` is the best
-- available "when" — the true moment was never recorded.
--
-- Runs as the migration (owner) role, which bypasses RLS (verified on the
-- dev database: neondb_owner has rolbypassrls). The `IS NULL` guard keeps it
-- re-runnable and never overwrites a real completion time.
UPDATE brands b
   SET onboarding_completed_at = b.updated_at
 WHERE b.onboarding_completed_at IS NULL
   AND b.deleted_at IS NULL
   AND length(btrim(b.name)) > 0
   AND cardinality(b.industries) > 0
   AND (SELECT count(*) FROM competitors c
         WHERE c.brand_id = b.id AND c.deleted_at IS NULL) >= 1
   AND (SELECT count(*) FROM use_cases u
         WHERE u.brand_id = b.id AND u.deleted_at IS NULL) >= 3;

-- ── organizations.autonomy_level_max ───────────────────────────────────────
-- Default 1: an organization opts in to more agent autonomy, it never
-- inherits it. CHECK 1..3 in checks.sql.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autonomy_level_max SMALLINT NOT NULL DEFAULT 1;

-- ── notification_type: invitation_accepted ─────────────────────────────────
-- ADD VALUE is allowed inside a transaction on PostgreSQL 12+; the new value
-- is not used anywhere in this transaction (which is the one restriction).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'invitation_accepted';

-- ── notification_preferences: per user, per organization ───────────────────
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- The table was ported in 0000 and never written by any code path (0 rows
-- on the dev database when this was written), but a row without an org
-- cannot satisfy NOT NULL. Rather than drop such a row, copy it to every
-- organization its user belongs to — that is exactly what an org-less
-- preference meant — then remove the org-less original.
INSERT INTO notification_preferences (organization_id, user_id, notification_type, channel, enabled)
SELECT m.organization_id, p.user_id, p.notification_type, p.channel, p.enabled
  FROM notification_preferences p
  JOIN memberships m ON m.user_id = p.user_id
 WHERE p.organization_id IS NULL;

DELETE FROM notification_preferences WHERE organization_id IS NULL;

ALTER TABLE notification_preferences
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_organization_id_fkey'
  ) THEN
    ALTER TABLE notification_preferences
      ADD CONSTRAINT notification_preferences_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations (id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- The old (user, type, channel) unique key would forbid the same person
-- holding different preferences in two organizations. Replaced by
-- uq_notif_prefs_org_user_type_channel (indexes.sql).
DROP INDEX IF EXISTS notification_preferences_user_id_notification_type_channel_key;

COMMIT;
