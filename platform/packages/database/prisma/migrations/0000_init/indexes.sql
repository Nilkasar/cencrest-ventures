-- BeBest platform — supplemental partial indexes
--
-- Prisma's schema.prisma `@@index` syntax cannot express a partial index
-- (a `WHERE` clause on the index itself), so the handful the SCHEMA.md
-- design doc calls out — and a few more that match the same "hot, narrow
-- slice of a big table" shape — are added here by hand. These are IN
-- ADDITION to the plain `@@index` declarations already in schema.prisma;
-- do not drop those, the query planner uses both depending on the query.
--
-- Not applied automatically — see rls.sql header for the same caveat.

BEGIN;

-- Tenant lookup on the single most-queried table, active rows only
-- (mirrors docs/06-database/SCHEMA.md's example index verbatim).
CREATE INDEX idx_brands_org_active ON brands(organization_id) WHERE deleted_at IS NULL;

-- Opportunity ranking feed: "give me this org's open opportunities, best
-- first" is the single most common opportunity-engine query.
CREATE INDEX idx_opportunities_org_score_open ON opportunities(organization_id, unified_score DESC)
  WHERE status IS DISTINCT FROM 'dismissed';

-- Job queue drain: workers poll for queued work only.
CREATE INDEX idx_background_jobs_queue_pending ON background_jobs(status, priority, run_after)
  WHERE status = 'queued';

-- Action Center: "my open actions" is the default view.
CREATE INDEX idx_actions_open_queue ON actions(organization_id, status, priority)
  WHERE deleted_at IS NULL AND status NOT IN ('completed', 'dismissed');

-- Notification bell: unread-only feed per user.
CREATE INDEX idx_notifications_unread ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Prompt job dispatch: workers poll for queued prompt jobs per run.
CREATE INDEX idx_prompt_jobs_queue_pending ON prompt_jobs(run_id, status)
  WHERE status = 'queued';

COMMIT;
