-- BeBest platform — CHECK constraints for Epic 12 (GEO Agent / SEO Agent /
-- Growth Agent)
--
-- `agent_runs`/`agent_events`/`agent_pending_actions` use the VARCHAR+CHECK
-- pattern (DECISIONS.md §6), not native Postgres enums, for the same
-- "closed but may grow" reasoning `crawl_jobs.status`/`ai_runs.status`
-- already use — a later epic's agent type (Content/Research/Competitor/
-- Measurement, per docs/13-agents/AGENT_ARCHITECTURE.md's full type list)
-- should never need a schema migration to widen a Postgres ENUM.
--
-- `chk_agent_runs_autonomy_level` is DEFENSE IN DEPTH, not the primary
-- guard: Level 4 is hard-blocked in application code
-- (`apps/api/src/lib/agents/autonomy.ts`'s `assertAutonomyLevelAllowed`,
-- called on every path that could produce a level, never bypassable by any
-- config value) BEFORE a row is ever written. This CHECK exists so that
-- even a hypothetical future direct-write path (a migration script, a
-- different service) cannot silently insert `autonomy_level = 4` and have
-- it succeed — belt-and-suspenders, matching this epic's own "hard-coded
-- rejection, not a half-wired feature" instruction.
--
-- Not applied automatically — this package never connects to a database.
-- Run this (after every earlier epic folder's, in numeric order, alongside
-- the real `prisma migrate deploy`) against your own database once you have
-- a real DATABASE_URL.

BEGIN;

ALTER TABLE agent_runs
  ADD CONSTRAINT chk_agent_runs_agent_name
  CHECK (agent_name IN ('geo_agent', 'seo_agent', 'growth_agent'));

ALTER TABLE agent_runs
  ADD CONSTRAINT chk_agent_runs_status
  CHECK (status IN ('queued', 'running', 'completed', 'failed'));

ALTER TABLE agent_runs
  ADD CONSTRAINT chk_agent_runs_triggered_by
  CHECK (triggered_by IN ('user', 'schedule', 'event'));

-- A schedule/event-triggered run genuinely has no human to attribute to;
-- a user-triggered one always does — same "required attribution when a
-- human causes it" invariant `crawl_jobs.created_by`/`ai_runs.created_by`
-- enforce via NOT NULL, expressed here as a CHECK instead because
-- `triggered_by_id` must stay nullable for the other two trigger kinds.
ALTER TABLE agent_runs
  ADD CONSTRAINT chk_agent_runs_triggered_by_id_required_for_user
  CHECK (triggered_by <> 'user' OR triggered_by_id IS NOT NULL);

ALTER TABLE agent_runs
  ADD CONSTRAINT chk_agent_runs_autonomy_level
  CHECK (autonomy_level IN (1, 2, 3));

ALTER TABLE agent_events
  ADD CONSTRAINT chk_agent_events_type
  CHECK (type IN ('progress', 'observation', 'recommendation', 'draft', 'action_required', 'complete', 'error'));

ALTER TABLE agent_pending_actions
  ADD CONSTRAINT chk_agent_pending_actions_status
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- `approved_by`/`approved_at`/`rollback_until` are only ever meaningful once
-- `status = 'approved'` (see routes/agent-run-details.ts's approve
-- handler) — this CHECK makes "approved without an approver/timestamp" and
-- "rolled-back-window set on a still-pending action" both impossible at the
-- database layer, not just by application discipline.
ALTER TABLE agent_pending_actions
  ADD CONSTRAINT chk_agent_pending_actions_approval_fields
  CHECK (
    (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND rollback_until IS NOT NULL)
    OR (status <> 'approved' AND approved_by IS NULL AND approved_at IS NULL AND rollback_until IS NULL)
  );

COMMIT;
