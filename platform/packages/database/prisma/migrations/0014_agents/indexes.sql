-- BeBest platform — partial index for Epic 12 (GEO Agent / SEO Agent /
-- Growth Agent)
--
-- Mirrors `idx_opportunity_recommendations_open_rank`/
-- `idx_unified_opportunities_open_score`'s "list the open queue, narrowed to
-- the interesting subset" read pattern — the Level 3 approval inbox reads
-- "every pending action for this org," not the whole history including
-- already-approved/rejected rows. Not expressible in Prisma's `@@index` DSL
-- (no WHERE clause support) — same recurring reason every other
-- hand-written indexes.sql file in this package exists.
--
-- Not applied automatically — `prisma validate`/`generate` only, no live
-- database.

BEGIN;

CREATE INDEX idx_agent_pending_actions_pending
  ON agent_pending_actions (organization_id, created_at)
  WHERE status = 'pending';

COMMIT;
