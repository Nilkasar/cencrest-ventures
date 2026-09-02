import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AIProviderRegistry, ExtractionValidationError, type AIProvider, type CompletionResult, type ExtractionResult } from '@bebest/ai-provider';
import path from 'node:path';

// ── In-memory fake `@bebest/database` — enough of the real shape for the
// pipeline's own queries/updates, no real Postgres/RLS involved. Mirrors
// the pattern established in routes/crawl.test.ts (`vi.mock` + a plain
// object standing in for `tx`), extended here with real (not just spied)
// state so multi-step assertions (evidence persisted, scores computed from
// exactly the rows written) can be made against actual data rather than
// call arguments alone. ───────────────────────────────────────────────────
interface FakeState {
  ai_runs: Record<string, Record<string, unknown>>;
  ai_run_responses: Array<Record<string, unknown>>;
  brand_observations: Array<Record<string, unknown>>;
}

const state: FakeState = { ai_runs: {}, ai_run_responses: [], brand_observations: [] };
let responseSeq = 0;
let observationSeq = 0;

const BRAND = { id: 'brand-1', name: 'Acme', aliases: ['Acme Corp'] };
const COMPETITOR = { id: 'competitor-1', name: 'Rival Inc', aliases: ['Rival'] };
const QUERIES = [
  { id: 'q1', text: 'What is the best CRM?', created_at: new Date('2026-01-01') },
  { id: 'q2', text: 'best invoicing tool?', created_at: new Date('2026-01-02') },
];

function applyUpdateData(row: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
      row[key] = (Number(row[key]) || 0) + Number((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
}

const tx = {
  ai_runs: {
    findUniqueOrThrow: async ({ where: { id } }: { where: { id: string } }) => {
      const row = state.ai_runs[id];
      if (!row) throw new Error(`ai_runs ${id} not found`);
      return row;
    },
    update: async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.ai_runs[id];
      if (!row) throw new Error(`ai_runs ${id} not found`);
      applyUpdateData(row, data);
      return row;
    },
  },
  brands: {
    findUniqueOrThrow: async () => BRAND,
  },
  competitors: {
    findUniqueOrThrow: async ({ where: { id } }: { where: { id: string } }) => {
      if (id !== COMPETITOR.id) throw new Error(`competitors ${id} not found`);
      return COMPETITOR;
    },
  },
  queries: {
    findMany: async () => QUERIES,
  },
  ai_run_responses: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `resp-${++responseSeq}`, extraction_status: 'pending', ...data };
      state.ai_run_responses.push(row);
      return row;
    },
    update: async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.ai_run_responses.find((r) => r.id === id);
      if (!row) throw new Error(`ai_run_responses ${id} not found`);
      Object.assign(row, data);
      return row;
    },
  },
  brand_observations: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `obs-${++observationSeq}`, ...data };
      state.brand_observations.push(row);
      return row;
    },
    findMany: async ({ where }: { where: { ai_run_id: string } }) =>
      state.brand_observations.filter((o) => o.ai_run_id === where.ai_run_id),
  },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

// ── Fake providers — no real network call anywhere in this file. ──────────
function fakeProvider(name: string, model: string): AIProvider & { complete: ReturnType<typeof vi.fn>; extract: ReturnType<typeof vi.fn> } {
  return {
    name,
    model,
    complete: vi.fn(),
    extract: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

function completionResult(rawResponse: string, provider: string, model: string): CompletionResult {
  return {
    provider,
    model,
    promptVersion: 'brand-query.v1.0',
    rawResponse,
    tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    latencyMs: 42,
    timestamp: new Date().toISOString(),
    requestId: `req-${rawResponse.length}-${Math.random()}`,
  };
}

interface ParsedObservation {
  brandMentioned: boolean;
  brandFirstPosition: number | null;
  brandMentionCount: number;
  brandSentiment: string | null;
  brandContext: string | null;
  brandRecommended: boolean;
  brandRecommendationStrength: string | null;
  competitorsMentioned: string[];
  citedUrls: string[];
  citedDomains: string[];
  responseLanguage: string;
  responseWordCount: number;
}

function extractionResult(parsed: ParsedObservation): ExtractionResult<ParsedObservation> {
  return {
    provider: 'ollama',
    model: 'qwen3:8b',
    promptVersion: 'extraction-brand-observation.v1.0',
    rawResponse: JSON.stringify(parsed),
    tokensUsed: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    latencyMs: 12,
    timestamp: new Date().toISOString(),
    requestId: 'req-extract',
    parsed,
    rawResponseBeforeParsing: JSON.stringify(parsed),
    parseAttempts: 1,
  };
}

beforeEach(() => {
  state.ai_runs = {};
  state.ai_run_responses = [];
  state.brand_observations = [];
  responseSeq = 0;
  observationSeq = 0;
});

describe('runAiVisibilityRun', () => {
  it(
    'persists raw evidence even when extraction fails, links observations to their exact response, ' +
      'never routes geo-query jobs to Ollama, and computes the AVS from exactly the rows it wrote',
    async () => {
      const openai = fakeProvider('openai', 'gpt-4o');
      const anthropic = fakeProvider('anthropic', 'claude-sonnet-4-6');
      const ollama = fakeProvider('ollama', 'qwen3:8b');

      // q1/openai: GEO-query call succeeds, extraction succeeds, brand
      // mentioned + recommended near the start of the response.
      openai.complete.mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
        if (userPrompt.includes('best CRM')) return completionResult('Acme is great, I recommend Acme for this.', 'openai', 'gpt-4o');
        // q2/openai: GEO-query call succeeds, but the raw text is
        // deliberately unextractable (see ollama.extract below) — the
        // response row must still exist with the raw text intact.
        return completionResult('Something else entirely, ambiguous phrasing.', 'openai', 'gpt-4o');
      });

      // q1/anthropic: the GEO-query provider call itself fails outright —
      // no raw text was ever received, so no evidence exists to persist.
      // q2/anthropic: succeeds normally.
      anthropic.complete.mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
        if (userPrompt.includes('best CRM')) throw new Error('anthropic: connection reset');
        return completionResult('Acme is mentioned here as an option.', 'anthropic', 'claude-sonnet-4-6');
      });

      ollama.extract.mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
        if (userPrompt.includes('Something else entirely')) {
          throw new ExtractionValidationError('ollama', 3, 'not valid json at all', new Error('JSON parse failed'));
        }
        if (userPrompt.includes('Acme is great')) {
          return extractionResult({
            brandMentioned: true,
            brandFirstPosition: 0.1,
            brandMentionCount: 2,
            brandSentiment: 'positive',
            brandContext: 'Acme is great',
            brandRecommended: true,
            brandRecommendationStrength: 'strong',
            competitorsMentioned: [],
            citedUrls: [],
            citedDomains: [],
            responseLanguage: 'en',
            responseWordCount: 8,
          });
        }
        // q2/anthropic's raw text
        return extractionResult({
          brandMentioned: true,
          brandFirstPosition: 0.6,
          brandMentionCount: 1,
          brandSentiment: 'neutral',
          brandContext: 'Acme is mentioned here',
          brandRecommended: false,
          brandRecommendationStrength: null,
          competitorsMentioned: [],
          citedUrls: [],
          citedDomains: [],
          responseLanguage: 'en',
          responseWordCount: 7,
        });
      });

      const registry = new AIProviderRegistry({
        default: 'ollama',
        providers: { openai, anthropic, ollama },
      });

      state.ai_runs['run-1'] = {
        id: 'run-1',
        organization_id: 'org-1',
        brand_id: BRAND.id,
        query_set_id: 'qs-1',
        providers: ['openai', 'anthropic'],
        status: 'queued',
        total_jobs: 4,
        completed_jobs: 0,
        failed_jobs: 0,
      };

      const { runAiVisibilityRun } = await import('./pipeline.js');
      await runAiVisibilityRun('run-1', 'org-1', BRAND.id, {
        registry,
        promptsBaseDir: path.join(import.meta.dirname, '../../prompts'),
      });

      // ── Evidence preservation ──────────────────────────────────────────
      // q1/anthropic: the provider call itself failed — genuinely no
      // evidence exists, so no response row for it.
      expect(state.ai_run_responses).toHaveLength(3);

      const q2OpenaiResponse = state.ai_run_responses.find(
        (r) => r.query_id === 'q2' && r.provider === 'openai',
      );
      expect(q2OpenaiResponse).toBeDefined();
      // The literal evidence-preservation guarantee under test: raw_response
      // is intact and readable even though extraction on it failed.
      expect(q2OpenaiResponse!.raw_response).toBe('Something else entirely, ambiguous phrasing.');
      expect(q2OpenaiResponse!.extraction_status).toBe('failed');
      expect(q2OpenaiResponse!.extraction_error).toContain('schema-valid JSON');

      const q1OpenaiResponse = state.ai_run_responses.find((r) => r.query_id === 'q1' && r.provider === 'openai');
      expect(q1OpenaiResponse!.extraction_status).toBe('completed');

      // ── brand_observations link back to the EXACT response they came from ──
      expect(state.brand_observations).toHaveLength(2);
      const q1Observation = state.brand_observations.find((o) => o.query_id === 'q1');
      expect(q1Observation!.ai_run_response_id).toBe(q1OpenaiResponse!.id);
      expect(q1Observation!.ai_run_id).toBe('run-1');
      // No observation exists for the failed extraction — confirms a
      // failure never fabricates a plausible-looking observation row.
      expect(state.brand_observations.some((o) => o.ai_run_response_id === q2OpenaiResponse!.id)).toBe(false);

      // ── Provider-routing regression: GEO queries never silently fall
      // back to Ollama, and extraction never runs on a GEO-query provider. ──
      expect(ollama.complete).not.toHaveBeenCalled();
      expect(openai.extract).not.toHaveBeenCalled();
      expect(anthropic.extract).not.toHaveBeenCalled();
      expect(ollama.extract).toHaveBeenCalledTimes(3); // every job whose GEO-query call succeeded

      // ── Job accounting ──────────────────────────────────────────────────
      // completed: q1/openai, q2/anthropic. failed: q1/anthropic (provider
      // call failed), q2/openai (extraction failed).
      expect(state.ai_runs['run-1'].completed_jobs).toBe(2);
      expect(state.ai_runs['run-1'].failed_jobs).toBe(2);
      expect(state.ai_runs['run-1'].status).toBe('completed');

      // ── AGGREGATE: formula v1.0, hand-verified from exactly the two
      // successful observations (q1: mentioned+recommended, pos 0.1;
      // q2: mentioned only, pos 0.6), totalQueries=2, totalProviders=2. ──
      // MentionScore = 2/(2*2) x 100 = 50
      // RecommendationScore = {q1} / 2 x 100 = 50
      // PositionScore = avg(0.9, 0.4) x 100 = 65
      // CoverageScore = {q1,q2} / 2 x 100 = 100
      // AVS = 50*0.25 + 50*0.40 + 65*0.20 + 100*0.15 = 60.5
      expect(state.ai_runs['run-1'].mention_score).toBe(50);
      expect(state.ai_runs['run-1'].recommendation_score).toBe(50);
      expect(state.ai_runs['run-1'].position_score).toBe(65);
      expect(state.ai_runs['run-1'].coverage_score).toBe(100);
      expect(state.ai_runs['run-1'].ai_visibility_score).toBe(60.5);
      expect(state.ai_runs['run-1'].scoring_formula_version).toBe('1.0');
    },
  );

  // ── Epic 8 (Competitive Intelligence): the ONE branch point this epic
  // adds — `ai_runs.competitor_id` set — reuses every step above
  // unmodified except which entity's name/aliases feed the extraction
  // prompt. ──────────────────────────────────────────────────────────────
  it('extracts for the COMPETITOR\'s name/aliases (not the brand\'s) when ai_runs.competitor_id is set, and stores the result identically in brand_observations', async () => {
    const openai = fakeProvider('openai', 'gpt-4o');
    openai.complete.mockResolvedValue(completionResult('Rival Inc is a solid choice for this.', 'openai', 'gpt-4o'));

    const ollama = fakeProvider('ollama', 'qwen3:8b');
    let extractionUserPrompt = '';
    ollama.extract.mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
      extractionUserPrompt = userPrompt;
      return extractionResult({
        brandMentioned: true,
        brandFirstPosition: 0.0,
        brandMentionCount: 1,
        brandSentiment: 'positive',
        brandContext: 'Rival Inc is a solid choice',
        brandRecommended: true,
        brandRecommendationStrength: 'strong',
        competitorsMentioned: ['Acme'],
        citedUrls: [],
        citedDomains: [],
        responseLanguage: 'en',
        responseWordCount: 8,
      });
    });

    const registry = new AIProviderRegistry({ default: 'ollama', providers: { openai, ollama } });

    state.ai_runs['run-competitor-1'] = {
      id: 'run-competitor-1',
      organization_id: 'org-1',
      brand_id: BRAND.id,
      competitor_id: COMPETITOR.id,
      query_set_id: 'qs-1',
      providers: ['openai'],
      status: 'queued',
      total_jobs: 2,
      completed_jobs: 0,
      failed_jobs: 0,
    };

    const { runAiVisibilityRun } = await import('./pipeline.js');
    await runAiVisibilityRun('run-competitor-1', 'org-1', BRAND.id, {
      registry,
      promptsBaseDir: path.join(import.meta.dirname, '../../prompts'),
    });

    // The extraction prompt was rendered with the COMPETITOR's name/aliases,
    // never the brand's.
    expect(extractionUserPrompt).toContain('Rival Inc');
    expect(extractionUserPrompt).toContain('Rival');
    expect(extractionUserPrompt).not.toContain('Brand name: Acme');

    // The response/observation rows are written exactly like a brand run —
    // same tables, same shape, `brand_id` still the org's real brand (never
    // overwritten with the competitor's id).
    const response = state.ai_run_responses.find((r) => r.ai_run_id === 'run-competitor-1');
    expect(response!.brand_id).toBe(BRAND.id);
    const observation = state.brand_observations.find((o) => o.ai_run_id === 'run-competitor-1');
    expect(observation!.brand_mentioned).toBe(true);
    expect(observation!.brand_id).toBe(BRAND.id);

    expect(state.ai_runs['run-competitor-1'].status).toBe('completed');
    expect(state.ai_runs['run-competitor-1'].ai_visibility_score).not.toBeNull();
  });
});
