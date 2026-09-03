-- BeBest platform — CHECK constraints for Epic 13 (Action Center &
-- Controlled Publishing).
--
-- `actions` already existed (0000_init) with its own `chk_actions_status`
-- (Epic 0's generic placeholder vocabulary, never consumed by any route —
-- confirmed by grep before this epic's first edit). This epic widens that
-- constraint to its real approve -> execute -> rollback lifecycle. Same
-- DROP + re-ADD precedent 0013_agency_white_label_integrations/checks.sql
-- already established for exactly this "an earlier epic's placeholder
-- vocabulary needs a real one" situation (see that file's own header
-- comment) — a DROP + re-ADD is used (not `ALTER ... ADD VALUE`, which does
-- not exist for a plain CHECK) so the constraint name stays the same one
-- downstream tooling would look for. `chk_actions_priority` is untouched —
-- this epic does not use or change that column's vocabulary.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after every earlier
-- epic folder's, in numeric order, alongside the real `prisma migrate
-- deploy`) against your own database once you have a real DATABASE_URL.

BEGIN;

-- actions.status — pending (awaiting approval) -> approved (human approved,
-- awaiting execution) -> completed (executed/published), or rolled_back
-- (published_content reverted within the 30-day window). Widened from Epic
-- 0's {pending, in_progress, completed, dismissed}; safe because this table
-- has zero application usage before this epic (confirmed by grep).
ALTER TABLE actions DROP CONSTRAINT IF EXISTS chk_actions_status;
ALTER TABLE actions ADD CONSTRAINT chk_actions_status
  CHECK (status IN ('pending', 'approved', 'completed', 'rolled_back'));

-- actions.autonomy_level — 1-4, the literal domain model
-- (docs/06-database/SCHEMA.md §4: "1=recommend, 2=draft, 3=approve+exec,
-- 4=autonomous"). Deliberately NOT narrowed to 1-3 the way
-- `agent_runs.autonomy_level` is (0014's chk_agent_runs_autonomy_level) —
-- this epic's own non-negotiable requires the Level 4 block be provable
-- even when a row legitimately holds 4 (see chk_actions_level4_never_
-- executes below, and routes/action-details.ts's execute guard clause,
-- which is the PRIMARY enforcement this constraint only backs up).
ALTER TABLE actions ADD CONSTRAINT chk_actions_autonomy_level
  CHECK (autonomy_level BETWEEN 1 AND 4);

-- actions — DB-level mirror of routes/action-details.ts's execute guard
-- clauses (defense in depth, same spirit as chk_agent_runs_autonomy_level):
-- execution requires a prior approval, and a Level 4 action can never reach
-- `executed_at` at all, regardless of what code path tried to set it.
ALTER TABLE actions ADD CONSTRAINT chk_actions_execute_requires_approval
  CHECK (executed_at IS NULL OR approved_at IS NOT NULL);
ALTER TABLE actions ADD CONSTRAINT chk_actions_level4_never_executes
  CHECK (executed_at IS NULL OR autonomy_level <= 3);

-- actions — rollback requires a prior execution (nothing to roll back
-- otherwise); the 30-day WINDOW itself is a real, tested application-layer
-- check (lib/actions/rollback-window.ts), not expressible as a static CHECK
-- (it depends on "now," which Postgres CHECK constraints cannot reference).
ALTER TABLE actions ADD CONSTRAINT chk_actions_rollback_requires_execution
  CHECK (rolled_back_at IS NULL OR executed_at IS NOT NULL);

-- actions — approval fields are set together or not at all, same
-- all-or-nothing discipline 0014's agent_pending_actions approval-fields
-- CHECK already establishes for that table.
ALTER TABLE actions ADD CONSTRAINT chk_actions_approval_fields_together
  CHECK ((approved_by IS NULL) = (approved_at IS NULL));

-- actions — the two handoff sources (Epic 11's content_drafts, Epic 12's
-- agent_pending_actions) are mutually exclusive per row: a single, real,
-- traceable origin, never both/ambiguous.
ALTER TABLE actions ADD CONSTRAINT chk_actions_single_handoff_source
  CHECK (content_draft_id IS NULL OR agent_pending_action_id IS NULL);

-- published_content.status — published | rolled_back.
ALTER TABLE published_content ADD CONSTRAINT chk_published_content_status
  CHECK (status IN ('published', 'rolled_back'));

-- published_content — rollback attribution fields set together or not at
-- all, same all-or-nothing discipline as chk_actions_approval_fields_together
-- above.
ALTER TABLE published_content ADD CONSTRAINT chk_published_content_rollback_together
  CHECK ((rolled_back_at IS NULL) = (rolled_back_by IS NULL));

COMMIT;
