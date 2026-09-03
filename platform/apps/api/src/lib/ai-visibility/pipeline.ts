/**
 * The Epic 7 GEO query pipeline — EXECUTE + AGGREGATE steps of
 * `docs/12-ai/AI_ARCHITECTURE.md`'s "GEO Query Execution" (PREPARE + QUEUE
 * happen in `routes/ai-runs.ts`, same split as Epic 3's crawler: the
 * `ai_runs` row is created, entitlement-checked, and scheduled
 * synchronously in the route; this file is what the scheduled background
 * job (routed through `JobQueue` — see `lib/ai-visibility/schedule-run.ts`
 * and `lib/queue/job-queue.ts`) actually runs).
 *
 * **The evidence-preservation guarantee, by construction.** Each
 * (query x provider) job makes TWO independent provider calls, never one:
 *
 *   1. `provider.complete()` — the GEO query itself, asked exactly as a
 *      real user would ask an AI assistant (no framing that reveals this
 *      is a brand-visibility measurement, which would bias the answer).
 *      The instant this succeeds, its `rawResponse` is written to
 *      `ai_run_responses` — BEFORE step 2 is even attempted.
 *   2. A SEPARATE extraction call (`provider.extract<BrandObservation>()`,
 *      routed via `taskDefaults['extraction']` — Ollama by default, never
 *      the GEO-query provider necessarily) that reads the row written in
 *      step 1 and turns it into a `brand_observations` row.
 *
 * Because these are two different provider calls against two different
 * task types, a failure in step 2 (bad JSON, schema mismatch, provider
 * outage) can NEVER retroactively un-write the row step 1 already
 * committed — there is no shared failure mode that could lose both. Step 2
 * failing only prevents a `brand_observations` row from existing; the raw
 * text remains fully queryable via `GET /ai-runs/:id/responses` with
 * `extraction_status: 'failed'` and a preserved `extraction_error`.
 *
 * A GEO-query provider call itself failing (step 1) is different: there is
 * genuinely no evidence yet (no raw text was ever received), so no
 * `ai_run_responses` row is created for that job at all — it is counted
 * directly against `ai_runs.failed_jobs`.
 */
import path from 'node:path';
import { withOrgContext, type claim_confidence } from '@bebest/database';
import {
  loadPromptTemplate,
  renderPrompt,
  promptVersionFor,
  type AIProviderRegistry,
  type KnownProviderName,
  type PromptTemplate,
} from '@bebest/ai-provider';
import { getDefaultAiProviderRegistry } from './provider-registry.js';
import { BRAND_OBSERVATION_SCHEMA, type BrandObservation } from './observation-schema.js';
import { computeAiVisibilityScore, type ScoredObservation } from './scoring.js';

/** Fixed per docs/12-ai/AI_ARCHITECTURE.md's `CompletionRequest` default —
 * stored on `ai_run_responses.temperature` directly from what was
 * REQUESTED (there is no `temperature` field on `CompletionResult` to read
 * back; each provider only echoes it into the request it actually sent). */
const GEO_QUERY_TEMPERATURE = 0.7;

export interface AiVisibilityPipelineDeps {
  /** Injected for testing — a hand-rolled fake `AIProviderRegistry`, never
   * a real network call (task hard constraint). Defaults to
   * `getDefaultAiProviderRegistry()` in production. */
  registry?: AIProviderRegistry;
  /** Root prompts directory (see `@bebest/ai-provider`'s `loadPromptTemplate`
   * convention). Defaults to `apps/api/src/prompts`. */
  promptsBaseDir?: string;
}

function defaultPromptsBaseDir(): string {
  return path.join(import.meta.dirname, '../../prompts');
}

/** `parseAttempts` from `ExtractionResult` (`@bebest/ai-provider`) is a
 * deterministic, non-self-reported proxy for how confidently the model
 * produced schema-valid JSON on the first try — used instead of asking the
 * model to rate its own confidence (unreliable and not part of
 * `BrandObservation`'s schema by design, see `observation-schema.ts`). */
function deriveExtractionConfidence(parseAttempts: number): claim_confidence {
  if (parseAttempts <= 1) return 'high';
  if (parseAttempts === 2) return 'medium';
  return 'low';
}

interface JobContext {
  organizationId: string;
  brandId: string;
  runId: string;
  query: { id: string; text: string };
  providerName: string;
  registry: AIProviderRegistry;
  brandQueryTemplate: PromptTemplate;
  brandQueryPromptVersion: string;
  extractionTemplate: PromptTemplate;
  extractionPromptVersion: string;
  // Epic 8 (Competitive Intelligence): the ENTITY this run is measuring —
  // "our" brand for a normal Epic 7 run, or one `competitors` row for a
  // competitor run (`ai_runs.competitor_id` set). Field names kept as
  // `brandName`/`brandAliasesText` (not renamed to something entity-generic)
  // deliberately: they feed the SAME `{{brandName}}`/`{{brandAliases}}`
  // placeholders in `prompts/geo/extraction-brand-observation.v1.0.txt`
  // (already entity-agnostic prose — "the name ... of one specific brand"
  // reads correctly whether that "brand" is ours or a competitor's), so
  // reusing the exact prompt template unmodified, per this epic's brief, is
  // literally what motivates keeping the field names unchanged here.
  brandName: string;
  brandAliasesText: string;
}

/** Runs exactly one (query x provider) job to completion. Never throws —
 * every failure mode is caught and turned into a `failed_jobs` increment
 * (and, where evidence exists, a persisted `extraction_error`), so a
 * caller can run many of these concurrently with `Promise.allSettled` (or
 * even a bare `Promise.all`) without one job's failure ever aborting
 * sibling jobs still in flight — same "one failure doesn't fail the whole
 * run" principle `lib/crawler/engine.ts` uses per-page. */
async function runOneJob(ctx: JobContext): Promise<void> {
  let provider;
  try {
    provider = ctx.registry.get(ctx.providerName as KnownProviderName);
  } catch {
    await bumpFailedJobs(ctx.organizationId, ctx.runId);
    return;
  }

  let completion;
  try {
    const userPrompt = renderPrompt(ctx.brandQueryTemplate, { queryText: ctx.query.text });
    completion = await provider.complete({
      userPrompt,
      promptVersion: ctx.brandQueryPromptVersion,
      temperature: GEO_QUERY_TEMPERATURE,
    });
  } catch {
    // No evidence was ever received — nothing to store, this job is a
    // straightforward failure with no `ai_run_responses` row.
    await bumpFailedJobs(ctx.organizationId, ctx.runId);
    return;
  }

  // Evidence committed to the database NOW, before extraction is even
  // attempted — see this file's top-of-file doc comment.
  const responseRow = await withOrgContext(ctx.organizationId, (tx) =>
    tx.ai_run_responses.create({
      data: {
        organization_id: ctx.organizationId,
        brand_id: ctx.brandId,
        ai_run_id: ctx.runId,
        query_id: ctx.query.id,
        provider: completion.provider,
        model: completion.model,
        prompt_version: completion.promptVersion,
        temperature: GEO_QUERY_TEMPERATURE,
        raw_response: completion.rawResponse,
        request_id: completion.requestId,
        tokens_prompt: completion.tokensUsed.promptTokens,
        tokens_completion: completion.tokensUsed.completionTokens,
        tokens_total: completion.tokensUsed.totalTokens,
        latency_ms: completion.latencyMs,
      },
    }),
  );

  try {
    const extractionProvider = await ctx.registry.resolveAvailable('extraction');
    const extractionUserPrompt = renderPrompt(ctx.extractionTemplate, {
      brandName: ctx.brandName,
      brandAliases: ctx.brandAliasesText,
      responseText: completion.rawResponse,
    });
    const result = await extractionProvider.extract<BrandObservation>({
      userPrompt: extractionUserPrompt,
      promptVersion: ctx.extractionPromptVersion,
      schema: BRAND_OBSERVATION_SCHEMA,
    });

    await withOrgContext(ctx.organizationId, async (tx) => {
      await tx.brand_observations.create({
        data: {
          organization_id: ctx.organizationId,
          brand_id: ctx.brandId,
          ai_run_id: ctx.runId,
          ai_run_response_id: responseRow.id,
          query_id: ctx.query.id,
          brand_mentioned: result.parsed.brandMentioned,
          brand_first_position: result.parsed.brandFirstPosition,
          brand_mention_count: result.parsed.brandMentionCount,
          brand_sentiment: result.parsed.brandSentiment,
          brand_context: result.parsed.brandContext,
          brand_recommended: result.parsed.brandRecommended,
          brand_recommendation_strength: result.parsed.brandRecommendationStrength,
          competitors_mentioned: result.parsed.competitorsMentioned,
          cited_urls: result.parsed.citedUrls,
          cited_domains: result.parsed.citedDomains,
          response_language: result.parsed.responseLanguage,
          response_word_count: result.parsed.responseWordCount,
          extraction_model_used: extractionProvider.model,
          extraction_prompt_version: result.promptVersion,
          extraction_confidence: deriveExtractionConfidence(result.parseAttempts),
        },
      });
      await tx.ai_run_responses.update({
        where: { id: responseRow.id },
        data: { extraction_status: 'completed', extracted_at: new Date() },
      });
    });

    await bumpCompletedJobs(ctx.organizationId, ctx.runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withOrgContext(ctx.organizationId, (tx) =>
      tx.ai_run_responses.update({
        where: { id: responseRow.id },
        data: { extraction_status: 'failed', extraction_error: message.slice(0, 2000) },
      }),
    );
    await bumpFailedJobs(ctx.organizationId, ctx.runId);
  }
}

async function bumpCompletedJobs(organizationId: string, runId: string): Promise<void> {
  await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.update({ where: { id: runId }, data: { completed_jobs: { increment: 1 } } }),
  );
}

async function bumpFailedJobs(organizationId: string, runId: string): Promise<void> {
  await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.update({ where: { id: runId }, data: { failed_jobs: { increment: 1 } } }),
  );
}

/**
 * Runs one `ai_runs` row to completion. Must be called only after the row
 * (status `queued`, `total_jobs` already set) exists — see
 * `routes/ai-runs.ts`'s PREPARE step. Never throws by itself for a
 * per-job failure (see `runOneJob`); a caller (the `JobQueue`-registered
 * handler in `lib/ai-visibility/schedule-run.ts`) should still `.catch()`
 * this for the case where a whole-run
 * setup step fails (e.g. the query_set was deleted between PREPARE and
 * EXECUTE) and mark the run `failed`, same pattern as
 * `lib/crawler/engine.ts` / `routes/crawl.ts`.
 */
export async function runAiVisibilityRun(
  runId: string,
  organizationId: string,
  brandId: string,
  deps: AiVisibilityPipelineDeps = {},
): Promise<void> {
  const registry = deps.registry ?? getDefaultAiProviderRegistry();
  const baseDir = deps.promptsBaseDir ?? defaultPromptsBaseDir();

  const run = await withOrgContext(organizationId, (tx) => tx.ai_runs.findUniqueOrThrow({ where: { id: runId } }));
  const brand = await withOrgContext(organizationId, (tx) => tx.brands.findUniqueOrThrow({ where: { id: brandId } }));
  const queries = await withOrgContext(organizationId, (tx) =>
    tx.queries.findMany({ where: { query_set_id: run.query_set_id, deleted_at: null }, orderBy: { created_at: 'asc' } }),
  );

  // Epic 8 (Competitive Intelligence): the ONLY branch point this epic adds
  // to Epic 7's pipeline. `run.competitor_id` (read from the row itself, not
  // a new function parameter — see routes/ai-runs.ts and
  // routes/competitor-ai-runs.ts, both of which just set the column at
  // create time) selects which entity's name/aliases get extracted for.
  // Everything else below — QUEUE, EXECUTE, the two-call-per-job evidence
  // guarantee, AGGREGATE's formula v1.0 — runs completely unmodified,
  // exactly the "extend/parameterize, don't fork" instruction this epic's
  // brief gives.
  const competitor = run.competitor_id
    ? await withOrgContext(organizationId, (tx) => tx.competitors.findUniqueOrThrow({ where: { id: run.competitor_id! } }))
    : null;
  const trackedEntityName = competitor ? competitor.name : brand.name;
  const trackedEntityAliases = competitor ? competitor.aliases : brand.aliases;

  await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.update({ where: { id: runId }, data: { status: 'running', started_at: new Date() } }),
  );

  const brandQueryTemplate = loadPromptTemplate({ baseDir, category: 'geo', name: 'brand-query' });
  const extractionTemplate = loadPromptTemplate({ baseDir, category: 'geo', name: 'extraction-brand-observation' });
  const brandQueryPromptVersion = promptVersionFor(brandQueryTemplate);
  const extractionPromptVersion = promptVersionFor(extractionTemplate);
  const brandAliasesText = trackedEntityAliases.length > 0 ? trackedEntityAliases.join(', ') : 'none';
  const providerNames = run.providers;

  // QUEUE + EXECUTE: one job per (query x provider). Providers for a given
  // query run concurrently (they're independent AI assistants being asked
  // the same question); queries are processed one at a time — a documented
  // simplification of AI_ARCHITECTURE.md's "queue with concurrency limit"
  // strategy (no durable queue exists yet, see the route's own
  // `// TODO: durable queue` marker), not a claim this matches the real
  // 5,600-job-scale throughput target.
  for (const query of queries) {
    await Promise.allSettled(
      providerNames.map((providerName) =>
        runOneJob({
          organizationId,
          brandId,
          runId,
          query: { id: query.id, text: query.text },
          providerName,
          registry,
          brandQueryTemplate,
          brandQueryPromptVersion,
          extractionTemplate,
          extractionPromptVersion,
          brandName: trackedEntityName,
          brandAliasesText,
        }),
      ),
    );
  }

  // AGGREGATE: formula v1.0, computed once, from every brand_observations
  // row this run produced (see scoring.ts for the full derivation and its
  // documented interpretation of the source docs' two ambiguities).
  const observationRows = await withOrgContext(organizationId, (tx) =>
    tx.brand_observations.findMany({
      where: { ai_run_id: runId },
      select: { query_id: true, brand_mentioned: true, brand_recommended: true, brand_first_position: true },
    }),
  );
  const observations: ScoredObservation[] = observationRows.map((o) => ({
    queryId: o.query_id,
    brandMentioned: o.brand_mentioned,
    brandRecommended: o.brand_recommended,
    brandFirstPosition: o.brand_first_position === null ? null : Number(o.brand_first_position),
  }));
  const score = computeAiVisibilityScore({
    observations,
    totalQueries: queries.length,
    totalProviders: providerNames.length,
  });

  await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.update({
      where: { id: runId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        mention_score: score.mentionScore,
        recommendation_score: score.recommendationScore,
        position_score: score.positionScore,
        coverage_score: score.coverageScore,
        ai_visibility_score: score.aiVisibilityScore,
        scoring_formula_version: score.formulaVersion,
      },
    }),
  );
}
