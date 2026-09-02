-- BeBest platform — CHECK constraints for Epic 4 (SEO Intelligence)
--
-- Same rule as prisma/migrations/0000_init/checks.sql: only columns with a
-- genuinely closed, stable value set or a plain data-quality range get one.
-- `seo_opportunities.opportunity_type` deliberately does NOT get one —
-- schema.prisma's "Epic 4 (SEO Intelligence) additions" comment explains
-- why (the spec's own literal list ends in "...", an open taxonomy, same
-- treatment as `queries.category` in 0004_query_universe/checks.sql).
--
-- Not applied automatically — same caveat as every other migration folder.

BEGIN;

-- seo_keywords (data-quality checks — same pair the legacy `keywords` table
-- already has in 0000_init/checks.sql, for the same two columns under new
-- names).
ALTER TABLE seo_keywords ADD CONSTRAINT chk_seo_keywords_volume_non_negative
  CHECK (monthly_volume IS NULL OR monthly_volume >= 0);
ALTER TABLE seo_keywords ADD CONSTRAINT chk_seo_keywords_difficulty_range
  CHECK (difficulty IS NULL OR (difficulty >= 0 AND difficulty <= 100));

-- seo_analyses.score — the technical/content health score is normalized
-- 0-100 (docs/epics/04-seo-intelligence.md's UI surface: "technical health
-- score"), same range convention the formula scores below use.
ALTER TABLE seo_analyses ADD CONSTRAINT chk_seo_analyses_score_range
  CHECK (score >= 0 AND score <= 100);

-- seo_opportunities — the three formula outputs, all normalized 0-100 per
-- docs/10-seo/SEO_ENGINE.md's formula v1.0 (verbatim: "normalized to
-- 0-100"). `scoring_formula_version` gets a non-empty check rather than a
-- closed IN(...) list — a future v1.1/v2.0 must be introducible without a
-- schema migration to widen an enum-like CHECK.
ALTER TABLE seo_opportunities ADD CONSTRAINT chk_seo_opportunities_value_score_range
  CHECK (value_score >= 0 AND value_score <= 100);
ALTER TABLE seo_opportunities ADD CONSTRAINT chk_seo_opportunities_effort_score_range
  CHECK (effort_score >= 0 AND effort_score <= 100);
ALTER TABLE seo_opportunities ADD CONSTRAINT chk_seo_opportunities_opportunity_score_range
  CHECK (opportunity_score >= 0 AND opportunity_score <= 100);
ALTER TABLE seo_opportunities ADD CONSTRAINT chk_seo_opportunities_formula_version_present
  CHECK (length(scoring_formula_version) > 0);

COMMIT;
