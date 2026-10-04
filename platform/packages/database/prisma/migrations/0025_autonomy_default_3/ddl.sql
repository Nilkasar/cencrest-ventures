-- 0025 — Epic 22 (Workspace Views) Phase 2 follow-up: the organization
-- autonomy ceiling defaults to 3, not 1.
--
-- 0024 added `organizations.autonomy_level_max` with DEFAULT 1, which made
-- every agent run requested at level 2 or 3 a 422 until an owner raised the
-- ceiling — a behaviour change for customers who can pick 2–3 today. The
-- decision (orchestrator, 2026-10-04): default 3, so the effective ceiling is
-- min(org setting, plan autonomy_level_max) exactly as before 0024 unless an
-- owner/admin deliberately lowers it. Level 4 stays blocked (CHECK 1..3 from
-- 0024, plus lib/agents/autonomy.ts).
--
-- WHY A NEW FOLDER, NOT AN EDIT TO 0024: 0024 is already recorded in
-- `_bebest_applied_sql` on the dev database, and scripts/apply-sql.mjs treats
-- an applied file whose checksum changed as an error ("EDITED … add a new
-- migration instead", exit 1). A fresh database gets DEFAULT 3 from the
-- rendered schema.prisma before any folder runs (0024's ADD COLUMN IF NOT
-- EXISTS is then a no-op); an existing one gets it here. Both converge.
--
-- WHICH ROWS MOVE FROM 1 TO 3: only those still holding the old default —
-- a value of 1 that no owner/admin ever chose. A deliberate choice is
-- always audited by PUT /api/orgs/me/autonomy as `settings.changed` with
-- details.setting = 'autonomy_level_max' (routes/org-settings.ts), so an org
-- with such an audit row keeps its value. Runs as the owner (BYPASSRLS) role,
-- which can read audit_events across tenants.
-- Idempotent: SET DEFAULT is a no-op the second time, and after the UPDATE
-- no un-audited row holds 1 any more.

BEGIN;

ALTER TABLE organizations ALTER COLUMN autonomy_level_max SET DEFAULT 3;

UPDATE organizations o
   SET autonomy_level_max = 3
 WHERE o.autonomy_level_max = 1
   AND NOT EXISTS (
     SELECT 1
       FROM audit_events a
      WHERE a.organization_id = o.id
        AND a.action = 'settings.changed'
        AND a.details ->> 'setting' = 'autonomy_level_max'
   );

COMMIT;
