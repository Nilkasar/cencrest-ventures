import type { BadgeProps } from "@bebest/ui";
import type { AiRunStatus, BrandSentiment, ExtractionStatus, RecommendationStrength, ScoreComponentKey } from "./types";

/** Display-only label/variant maps for Epic 7 (AI Visibility Engine) enum
 *  values the API returns — same role `data/website/labels.ts` plays for
 *  Epic 3. */

export const RUN_STATUS_LABEL: Record<AiRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export const RUN_STATUS_BADGE_VARIANT: Record<AiRunStatus, NonNullable<BadgeProps["variant"]>> = {
  queued: "neutral",
  running: "accent",
  completed: "success",
  failed: "danger",
};

/** The four cloud providers `'geo.query'` fans out to
 *  (`docs/12-ai/AI_ARCHITECTURE.md`'s routing table) — never Ollama. Falls
 *  back to a title-cased render of anything unrecognized rather than
 *  hiding it, since `AiRun.providers` is server-resolved and this map is
 *  display-only. */
export const PROVIDER_LABEL: Record<string, string> = {
  openai: "ChatGPT (OpenAI)",
  anthropic: "Claude (Anthropic)",
  google: "Gemini (Google)",
  perplexity: "Perplexity",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

export const EXTRACTION_STATUS_LABEL: Record<ExtractionStatus, string> = {
  pending: "Extracting",
  completed: "Extracted",
  failed: "Extraction failed",
};

export const EXTRACTION_STATUS_BADGE_VARIANT: Record<ExtractionStatus, NonNullable<BadgeProps["variant"]>> = {
  pending: "neutral",
  completed: "success",
  failed: "danger",
};

export const SENTIMENT_LABEL: Record<BrandSentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  mixed: "Mixed",
};

export const SENTIMENT_BADGE_VARIANT: Record<BrandSentiment, NonNullable<BadgeProps["variant"]>> = {
  positive: "success",
  neutral: "neutral",
  negative: "danger",
  mixed: "warning",
};

export const RECOMMENDATION_STRENGTH_LABEL: Record<RecommendationStrength, string> = {
  strong: "Strong",
  weak: "Weak",
  implied: "Implied",
};

export const SCORE_COMPONENT_LABEL: Record<ScoreComponentKey, string> = {
  mentionScore: "Mention Score",
  recommendationScore: "Recommendation Score",
  positionScore: "Position Score",
  coverageScore: "Coverage Score",
};

/** Plain-language explanation of what each formula component measures and
 *  which raw observation fields feed it — shown directly under the
 *  headline score so "click the number, see the formula" doesn't require
 *  a trip to documentation. Verbatim source: `docs/11-geo/GEO_ENGINE.md`
 *  (formula v1.0), transcribed by `apps/api/src/lib/ai-visibility/scoring.ts`. */
export const SCORE_COMPONENT_DESCRIPTION: Record<ScoreComponentKey, string> = {
  mentionScore: "Share of (query x model) jobs where your brand was mentioned at all.",
  recommendationScore: "Share of queries where at least one model recommended your brand.",
  positionScore: "How early your brand appeared in the response, averaged across mentions (earlier is better).",
  coverageScore: "Share of your query set's distinct queries where your brand showed up in at least one response.",
};
