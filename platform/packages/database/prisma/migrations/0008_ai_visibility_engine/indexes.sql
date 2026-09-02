-- BeBest platform — partial index for Epic 7 (AI Visibility Engine)
--
-- Mirrors `idx_crawl_jobs_queue_pending` / `idx_background_jobs_queue_pending`
-- (DECISIONS.md §11/§17): "which jobs are waiting to run" is a hot,
-- narrow-predicate query a plain `status` index serves less well than a
-- partial one. Not expressible in Prisma's `@@index` DSL (no WHERE clause
-- support) — same recurring reason every other hand-written indexes.sql
-- file in this package exists. No queue actually drains this yet (the
-- pipeline runs inline via `setImmediate` — see
-- docs/epics/07-ai-visibility-engine-backend.md's "not done" list), but the
-- index is here for the day a real worker does poll `ai_runs` by status.
--
-- Not applied automatically — `prisma validate`/`generate` only, no live
-- database.

BEGIN;

CREATE INDEX idx_ai_runs_queue_pending ON ai_runs (created_at) WHERE status IN ('queued', 'running');

COMMIT;
