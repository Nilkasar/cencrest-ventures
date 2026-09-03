/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — the free-tier-scoped AI run step
 * (`docs/epics/17-free-snapshot.md` step 2d: "Run the sample query set
 * across all 4 AI providers (Epic 7) — small scope, matching the free
 * tier's query budget").
 *
 * This is NOT a call into `lib/ai-visibility/pipeline.ts`'s
 * `runAiVisibilityRun`: that function's contract requires a persisted
 * `ai_runs` row (`findUniqueOrThrow`), a persisted `brands` row, and a
 * persisted `query_set_id` → `queries` rows — none of which exist for an
 * anonymous, unauthenticated snapshot request (same "no tenant/brand to
 * attach to" reasoning as `crawl.ts` in this same directory).
 *
 * What IS reused, exactly, per the epic brief's "same all-4-providers rule"
 * instruction:
 *   - `getDefaultAiProviderRegistry()` — the SAME process-wide registry
 *     Epic 7/8 construct from `process.env`, never a second one.
 *   - `registry.resolveNames('geo.query')` — the SAME provider-resolution
 *     call `routes/ai-runs.ts` makes, so a free snapshot fans out to
 *     exactly the same 4 cloud providers a paid run does, never a
 *     hand-copied/shortened list.
 *   - The exact same two-call-per-job evidence pattern `pipeline.ts`'s
 *     `runOneJob` uses (a GEO-query `complete()` call, then a SEPARATE
 *     `extraction` task `extract()` call reading its raw text) — same
 *     prompt templates (`prompts/geo/brand-query.v1.0.txt`,
 *     `prompts/geo/extraction-brand-observation.v1.0.txt`), same
 *     `BRAND_OBSERVATION_SCHEMA`, same `computeAiVisibilityScore` formula.
 *
 * What is deliberately NOT reused/ported — documented simplifications:
 *   - No `ai_run_responses`/`brand_observations` rows are ever written.
 *     There is no tenant/brand to attach persisted evidence to, so a GEO-
 *     query call's raw text (and an extraction failure) live only in this
 *     function's return value for the duration of one pipeline run, not as
 *     a durable, individually-auditable row the way a paid run's evidence
 *     trail is. `docs/epics/17-free-snapshot.md`'s own "lightweight report"
 *     framing (step 2f) already flags the free report as a simplification
 *     of the full pipeline's traceability, not a silent gap.
 *   - A GEO-query call failure and an extraction failure are both treated
 *     identically here: the job simply contributes no observation (exactly
 *     `pipeline.ts`'s numeric effect on the AVS formula — a failure counts
 *     against `totalQueries x totalProviders`'s denominator without ever
 *     appearing in the numerator), whereas `pipeline.ts` additionally
 *     distinguishes the two for evidence/debugging purposes
 *     (`extraction_status`/`extraction_error` on a persisted row). There is
 *     nothing to distinguish them for here, since neither is persisted.
 */
import path from 'node:path';
import {
  loadPromptTemplate,
  renderPrompt,
  promptVersionFor,
  type AIProviderRegistry,
  type KnownProviderName,
} from '@bebest/ai-provider';
import { getDefaultAiProviderRegistry } from '../ai-visibility/provider-registry.js';
import { BRAND_OBSERVATION_SCHEMA, type BrandObservation } from '../ai-visibility/observation-schema.js';
import { computeAiVisibilityScore, type ScoredObservation, type AiVisibilityScoreResult } from '../ai-visibility/scoring.js';
import type { GeneratedQuery, QueryTemplateCategory } from '../query-generator.js';

/** Same fixed value `pipeline.ts` requests for every GEO query call. */
const GEO_QUERY_TEMPERATURE = 0.7;

export interface FreeSnapshotAiRunDeps {
  /** Injected for testing — a hand-rolled fake `AIProviderRegistry`, never
   * a real network call (task hard constraint). Defaults to
   * `getDefaultAiProviderRegistry()` in production, same default
   * `pipeline.ts` uses. */
  registry?: AIProviderRegistry;
  promptsBaseDir?: string;
}

export interface FreeSnapshotObservation {
  queryId: string;
  queryText: string;
  category: QueryTemplateCategory;
  provider: KnownProviderName;
  brandMentioned: boolean;
  brandRecommended: boolean;
  brandFirstPosition: number | null;
  competitorsMentioned: string[];
}

export interface FreeSnapshotAiRunResult {
  providers: KnownProviderName[];
  totalQueries: number;
  observations: FreeSnapshotObservation[];
  score: AiVisibilityScoreResult;
}

function defaultPromptsBaseDir(): string {
  return path.join(import.meta.dirname, '../../prompts');
}

/**
 * Runs every (query x provider) job for the free-tier-scoped `queries` list
 * and computes the sample AI Visibility Score from whatever observations
 * succeed — mirrors `pipeline.ts`'s EXECUTE + AGGREGATE steps exactly, just
 * without the PREPARE/QUEUE persistence layer a real `ai_runs` row needs.
 * `queries` is the caller's already-capped list (see
 * `query-generator.ts`'s `generateQueryUniverse`) — this function has no
 * cap logic of its own, so a test can assert the FREE-TIER cap was applied
 * before this function ever runs, not inside it.
 */
export async function runFreeSnapshotAiQueries(
  brandName: string,
  queries: readonly GeneratedQuery[],
  deps: FreeSnapshotAiRunDeps = {},
): Promise<FreeSnapshotAiRunResult> {
  const registry = deps.registry ?? getDefaultAiProviderRegistry();
  const baseDir = deps.promptsBaseDir ?? defaultPromptsBaseDir();

  // docs/12-ai/AI_ARCHITECTURE.md's routing table, via the SAME registry
  // resolution logic every other GEO-query caller uses — never a hand-
  // copied literal array. Resolves to all 4 cloud providers, never Ollama.
  const providers = registry.resolveNames('geo.query');

  const brandQueryTemplate = loadPromptTemplate({ baseDir, category: 'geo', name: 'brand-query' });
  const extractionTemplate = loadPromptTemplate({ baseDir, category: 'geo', name: 'extraction-brand-observation' });
  const brandQueryPromptVersion = promptVersionFor(brandQueryTemplate);
  const extractionPromptVersion = promptVersionFor(extractionTemplate);

  const observations: FreeSnapshotObservation[] = [];

  // Same "providers for a given query run concurrently, queries are
  // processed one at a time" documented simplification as `pipeline.ts`.
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    const queryId = `q${i + 1}`;

    await Promise.allSettled(
      providers.map(async (providerName) => {
        let provider;
        try {
          provider = registry.get(providerName);
        } catch {
          return;
        }

        let completion;
        try {
          const userPrompt = renderPrompt(brandQueryTemplate, { queryText: query.text });
          completion = await provider.complete({
            userPrompt,
            promptVersion: brandQueryPromptVersion,
            temperature: GEO_QUERY_TEMPERATURE,
          });
        } catch {
          return; // no evidence was ever received — nothing to observe for this job.
        }

        try {
          const extractionProvider = await registry.resolveAvailable('extraction');
          const extractionUserPrompt = renderPrompt(extractionTemplate, {
            brandName,
            brandAliases: 'none',
            responseText: completion.rawResponse,
          });
          const result = await extractionProvider.extract<BrandObservation>({
            userPrompt: extractionUserPrompt,
            promptVersion: extractionPromptVersion,
            schema: BRAND_OBSERVATION_SCHEMA,
          });

          observations.push({
            queryId,
            queryText: query.text,
            category: query.category,
            provider: providerName,
            brandMentioned: result.parsed.brandMentioned,
            brandRecommended: result.parsed.brandRecommended,
            brandFirstPosition: result.parsed.brandFirstPosition,
            competitorsMentioned: result.parsed.competitorsMentioned,
          });
        } catch {
          // Extraction failed — see module header for why this has no
          // separate evidence trail to preserve for a free snapshot.
        }
      }),
    );
  }

  const scored: ScoredObservation[] = observations.map((o) => ({
    queryId: o.queryId,
    brandMentioned: o.brandMentioned,
    brandRecommended: o.brandRecommended,
    brandFirstPosition: o.brandFirstPosition,
  }));
  const score = computeAiVisibilityScore({
    observations: scored,
    totalQueries: queries.length,
    totalProviders: providers.length,
  });

  return { providers, totalQueries: queries.length, observations, score };
}
