/**
 * The `BrandObservation` extraction contract — `docs/12-ai/AI_ARCHITECTURE.md`'s
 * `BrandObservation` interface, transcribed field-for-field into a JSON
 * Schema for `AIProvider.extract<BrandObservation>()`
 * (`@bebest/ai-provider`) and a matching TypeScript type for the rest of
 * this app. Extraction-metadata fields
 * (`extractionModelUsed`/`extractionPromptVersion`/`extractionConfidence`)
 * are deliberately NOT part of the schema the LLM fills in — they describe
 * the extraction call itself, not something the model can observe about its
 * own output, and are stamped by `pipeline.ts` from values it already knows
 * (which provider/model ran, which prompt version was rendered), never
 * asked of the model.
 */
import type { JSONSchema } from '@bebest/ai-provider';

export interface BrandObservation {
  brandMentioned: boolean;
  /** Normalized 0 (start of response) .. 1 (end). `null` when not mentioned. */
  brandFirstPosition: number | null;
  brandMentionCount: number;
  brandSentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
  /** A short quoted excerpt around the brand mention, or `null` when not mentioned. */
  brandContext: string | null;
  brandRecommended: boolean;
  brandRecommendationStrength: 'strong' | 'weak' | 'implied' | null;
  competitorsMentioned: string[];
  citedUrls: string[];
  citedDomains: string[];
  /** ISO 639-1 language code, e.g. "en". */
  responseLanguage: string;
  responseWordCount: number;
}

/** JSON Schema handed to `extract<BrandObservation>()` — Ajv-validated
 * (`@bebest/ai-provider`'s `parseAndValidateJson`) before this app ever
 * trusts a field from it. `additionalProperties: false` so a model that
 * pads its JSON with extra chatty fields fails validation loudly (and
 * retries — ADR-004) rather than those fields being silently ignored and
 * masking a confused extraction. */
export const BRAND_OBSERVATION_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'brandMentioned',
    'brandFirstPosition',
    'brandMentionCount',
    'brandSentiment',
    'brandContext',
    'brandRecommended',
    'brandRecommendationStrength',
    'competitorsMentioned',
    'citedUrls',
    'citedDomains',
    'responseLanguage',
    'responseWordCount',
  ],
  properties: {
    brandMentioned: { type: 'boolean' },
    brandFirstPosition: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    brandMentionCount: { type: 'integer', minimum: 0 },
    brandSentiment: { type: ['string', 'null'], enum: ['positive', 'neutral', 'negative', 'mixed', null] },
    brandContext: { type: ['string', 'null'] },
    brandRecommended: { type: 'boolean' },
    brandRecommendationStrength: { type: ['string', 'null'], enum: ['strong', 'weak', 'implied', null] },
    competitorsMentioned: { type: 'array', items: { type: 'string' } },
    citedUrls: { type: 'array', items: { type: 'string' } },
    citedDomains: { type: 'array', items: { type: 'string' } },
    responseLanguage: { type: 'string' },
    responseWordCount: { type: 'integer', minimum: 0 },
  },
};
