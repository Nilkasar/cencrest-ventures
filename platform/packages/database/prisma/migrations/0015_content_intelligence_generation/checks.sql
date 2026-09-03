-- BeBest platform — CHECK constraints for Epic 11 (Content Intelligence &
-- Generation)'s three new tables. Same template every prior migration
-- folder's checks.sql uses (schema.prisma design principle #7: enum-like
-- VARCHAR columns keep their VARCHAR type but get a CHECK constraint).
--
-- `content_briefs` already got its `chk_content_briefs_status` constraint in
-- 0000_init (this epic did not change that column's vocabulary) — not
-- repeated here.
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after every earlier
-- epic folder's, in numeric order) against your own database once you have
-- a real DATABASE_URL.

BEGIN;

-- content_drafts.status — 'generated' (just produced, awaiting review) or
-- 'approved' (a human approved this specific version). Deliberately does
-- NOT include 'published' — see schema.prisma's header comment on this
-- model for why this epic's own status vocabulary must never contain that
-- value at all, not just avoid setting it.
ALTER TABLE content_drafts ADD CONSTRAINT chk_content_drafts_status
  CHECK (status IN ('generated', 'approved'));

-- content_quality_checks.check_type — this epic's spec's literal 5-check
-- list (docs/epics/11-content-intelligence-generation.md's generation
-- pipeline step 4).
ALTER TABLE content_quality_checks ADD CONSTRAINT chk_content_quality_checks_type
  CHECK (check_type IN ('fact_check', 'brand_voice', 'duplicate_content', 'seo_checklist', 'geo_structure'));

-- content_quality_checks.status — every check's own individual result
-- (never just a single aggregate pass/fail — this epic's DoD, verbatim).
ALTER TABLE content_quality_checks ADD CONSTRAINT chk_content_quality_checks_status
  CHECK (status IN ('pass', 'fail', 'warning'));

COMMIT;
