-- BeBest platform — partial index for Epic 10 (Recommendation Engine)
--
-- Mirrors `idx_unified_opportunities_open_score`'s "list, sorted by rank
-- desc, non-dismissed only" read pattern (`GET /brands/me/recommendations`'
-- default "top 10 prioritized recommendations" view — docs/09-ux/
-- CUSTOMER_JOURNEY.md's onboarding Step 6 / Stage 4 dashboard), narrowed to
-- non-dismissed rows so a dismissed recommendation never competes for the
-- same ranked list a plain `@@index([organization_id, brand_id,
-- priority_rank])` would have to scan past. Not expressible in Prisma's
-- `@@index` DSL (no WHERE clause support) — same recurring reason every
-- other hand-written indexes.sql file in this package exists.
--
-- Not applied automatically — `prisma validate`/`generate` only, no live
-- database.

BEGIN;

CREATE INDEX idx_opportunity_recommendations_open_rank
  ON opportunity_recommendations (organization_id, brand_id, priority_rank DESC)
  WHERE status != 'dismissed';

COMMIT;
