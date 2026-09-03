-- BeBest platform — partial index for Epic 9 (Opportunity Engine)
--
-- Mirrors `idx_seo_opportunities_org_score`'s "list, sorted by score desc"
-- read pattern (`GET /brands/me/opportunities`), narrowed to non-dismissed
-- rows — the Opportunities screen's default view (docs/09-ux/
-- CUSTOMER_JOURNEY.md) never wants dismissed rows competing for the same
-- ranked list a plain `@@index([organization_id, opportunity_score])` would
-- have to scan past. Not expressible in Prisma's `@@index` DSL (no WHERE
-- clause support) — same recurring reason every other hand-written
-- indexes.sql file in this package exists.
--
-- Not applied automatically — `prisma validate`/`generate` only, no live
-- database.

BEGIN;

CREATE INDEX idx_unified_opportunities_open_score
  ON unified_opportunities (organization_id, opportunity_score DESC)
  WHERE status != 'dismissed';

COMMIT;
