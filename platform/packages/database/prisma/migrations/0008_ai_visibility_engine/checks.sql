-- BeBest platform — CHECK constraints for Epic 7 (AI Visibility Engine)
--
-- Same rule as every other migration folder in this package (DECISIONS.md
-- §6): only columns with a genuinely closed, stable value set get a CHECK.
-- Not applied automatically — `prisma validate`/`generate` only, no live
-- database.

BEGIN;

-- ai_runs.status — queued | running | completed | failed. Same four-value
-- vocabulary as `crawl_jobs.status` (DECISIONS.md §17); no `cancelled`
-- value yet — nothing in this epic's API surface sets one.
ALTER TABLE ai_runs ADD CONSTRAINT chk_ai_runs_status
  CHECK (status IN ('queued', 'running', 'completed', 'failed'));

-- ai_run_responses.extraction_status — pending | completed | failed. Set by
-- the extraction step (a separate provider call from the one that produced
-- `raw_response`); 'failed' never implies the raw evidence above it is
-- missing, only that no `brand_observations` row could be derived from it.
ALTER TABLE ai_run_responses ADD CONSTRAINT chk_ai_run_responses_extraction_status
  CHECK (extraction_status IN ('pending', 'completed', 'failed'));

-- brand_observations.brand_sentiment — positive | neutral | negative |
-- mixed (docs/12-ai/AI_ARCHITECTURE.md's `BrandObservation.brandSentiment`
-- union, including `null` for "brand not mentioned, no sentiment to
-- extract"). NOT the same vocabulary as the legacy `sentiment_val` enum
-- (which lacks `mixed`) — reusing that enum would either drop a real value
-- this epic's own spec requires, or force-widen a enum three OTHER,
-- unrelated tables (`mention_extractions`) already depend on. A plain
-- VARCHAR+CHECK avoids both, same precedent as every other closed-but-
-- table-specific vocabulary in this schema.
ALTER TABLE brand_observations ADD CONSTRAINT chk_brand_observations_sentiment
  CHECK (brand_sentiment IS NULL OR brand_sentiment IN ('positive', 'neutral', 'negative', 'mixed'));

-- brand_observations.brand_recommendation_strength — strong | weak |
-- implied (docs/12-ai/AI_ARCHITECTURE.md's
-- `BrandObservation.brandRecommendationStrength`), null when
-- `brand_recommended` is false.
ALTER TABLE brand_observations ADD CONSTRAINT chk_brand_observations_recommendation_strength
  CHECK (brand_recommendation_strength IS NULL OR brand_recommendation_strength IN ('strong', 'weak', 'implied'));

-- brand_observations.brand_first_position — normalized 0-1 character
-- offset (0 = start of response, 1 = end); null only when not mentioned.
-- Out-of-range values here would silently corrupt the deterministic
-- PositionScore formula (average(1 - first_position) x 100), so this is a
-- real correctness CHECK, not just documentation.
ALTER TABLE brand_observations ADD CONSTRAINT chk_brand_observations_first_position
  CHECK (brand_first_position IS NULL OR (brand_first_position >= 0 AND brand_first_position <= 1));

COMMIT;
