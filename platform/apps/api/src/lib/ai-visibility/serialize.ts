/**
 * Response shapes shared by `routes/ai-runs.ts` and
 * `routes/ai-run-details.ts` — kept in one place so the frontend (Epic 7's
 * follow-on agent) gets an identical shape for `ai_runs`/`ai_run_responses`/
 * `brand_observations` regardless of which route returned it.
 */
import type { ai_runs, ai_run_responses, brand_observations, Prisma } from '@bebest/database';
import { AVS_FORMULA_VERSION } from './scoring.js';

export function serializeAiRun(run: ai_runs) {
  const totalDone = run.completed_jobs + run.failed_jobs;
  const progressPct = run.total_jobs > 0 ? Math.min(100, Math.round((totalDone / run.total_jobs) * 100)) : 0;

  return {
    id: run.id,
    brandId: run.brand_id,
    querySetId: run.query_set_id,
    providers: run.providers,
    status: run.status,
    totalJobs: run.total_jobs,
    completedJobs: run.completed_jobs,
    failedJobs: run.failed_jobs,
    progressPct: run.status === 'completed' || run.status === 'failed' ? 100 : progressPct,
    aiVisibilityScore: run.ai_visibility_score === null ? null : Number(run.ai_visibility_score),
    scoringFormulaVersion: run.scoring_formula_version,
    error: run.error,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

/**
 * `GET /ai-runs/:id/score`'s shape — the evidence-traceability contract
 * (`docs/11-geo/GEO_ENGINE.md`'s "every score must be explainable"): each
 * component carries its own weight and the weighted contribution it made
 * to the total, so a caller (or a human reading a network trace) can add
 * the four `weightedContribution` values and get `aiVisibilityScore` back
 * without knowing the formula ahead of time. `computed: false` (all score
 * fields `null`) is a normal response for a run that hasn't finished
 * AGGREGATE yet — this endpoint returns 200, not an error, so a frontend
 * can poll it the same way it polls run status.
 */
export function serializeAiRunScore(run: ai_runs) {
  const computed = run.ai_visibility_score !== null;

  function component(value: Prisma.Decimal | null, weight: number) {
    const numeric = value === null ? null : Number(value);
    return {
      value: numeric,
      weight,
      weightedContribution: numeric === null ? null : Math.round(numeric * weight * 100) / 100,
    };
  }

  return {
    runId: run.id,
    status: run.status,
    computed,
    aiVisibilityScore: run.ai_visibility_score === null ? null : Number(run.ai_visibility_score),
    scoringFormulaVersion: run.scoring_formula_version ?? (computed ? AVS_FORMULA_VERSION : null),
    formula: 'MentionScore*0.25 + RecommendationScore*0.40 + PositionScore*0.20 + CoverageScore*0.15',
    breakdown: {
      mentionScore: component(run.mention_score, 0.25),
      recommendationScore: component(run.recommendation_score, 0.4),
      positionScore: component(run.position_score, 0.2),
      coverageScore: component(run.coverage_score, 0.15),
    },
  };
}

export function serializeBrandObservation(observation: brand_observations) {
  return {
    id: observation.id,
    queryId: observation.query_id,
    aiRunResponseId: observation.ai_run_response_id,
    brandMentioned: observation.brand_mentioned,
    brandFirstPosition: observation.brand_first_position === null ? null : Number(observation.brand_first_position),
    brandMentionCount: observation.brand_mention_count,
    brandSentiment: observation.brand_sentiment,
    brandContext: observation.brand_context,
    brandRecommended: observation.brand_recommended,
    brandRecommendationStrength: observation.brand_recommendation_strength,
    competitorsMentioned: observation.competitors_mentioned,
    citedUrls: observation.cited_urls,
    citedDomains: observation.cited_domains,
    responseLanguage: observation.response_language,
    responseWordCount: observation.response_word_count,
    extractionModelUsed: observation.extraction_model_used,
    extractionPromptVersion: observation.extraction_prompt_version,
    extractionConfidence: observation.extraction_confidence,
    createdAt: observation.created_at,
  };
}

/** `observation` is the 1:1 `brand_observations` row already joined in via
 * `include` — see `routes/ai-run-details.ts`'s `/responses` handler. `null`
 * means extraction hasn't completed (or failed) for this response yet;
 * the raw evidence fields above are populated regardless. */
export function serializeAiRunResponse(response: ai_run_responses & { brand_observations?: brand_observations | null }) {
  return {
    id: response.id,
    queryId: response.query_id,
    provider: response.provider,
    model: response.model,
    promptVersion: response.prompt_version,
    temperature: response.temperature === null ? null : Number(response.temperature),
    rawResponse: response.raw_response,
    requestId: response.request_id,
    tokensPrompt: response.tokens_prompt,
    tokensCompletion: response.tokens_completion,
    tokensTotal: response.tokens_total,
    latencyMs: response.latency_ms,
    extractionStatus: response.extraction_status,
    extractionError: response.extraction_error,
    extractedAt: response.extracted_at,
    createdAt: response.created_at,
    observation: response.brand_observations ? serializeBrandObservation(response.brand_observations) : null,
  };
}
