-- BeBest platform — partial index for Epic 3 (Website Intelligence)
--
-- Prisma's `@@index` DSL has no WHERE-clause support (see 0000_init/
-- indexes.sql's header), so the one hot-path index this epic needs —
-- "which crawl jobs are waiting to be picked up by the worker" — is
-- hand-written here, same pattern as idx_background_jobs_queue_pending.
--
-- Not applied automatically — same caveat as every prior migration folder.

BEGIN;

CREATE INDEX idx_crawl_jobs_queue_pending ON crawl_jobs(created_at)
  WHERE status = 'queued';

COMMIT;
