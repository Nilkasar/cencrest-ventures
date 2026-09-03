import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { AIProviderRegistry, type AIProvider, type CompletionResult, type ExtractionResult } from '@bebest/ai-provider';
import { runFreeSnapshotAiQueries } from './ai-run.js';
import type { GeneratedQuery } from '../query-generator.js';

function fakeProvider(name: string, model: string): AIProvider & { complete: ReturnType<typeof vi.fn>; extract: ReturnType<typeof vi.fn> } {
  return { name, model, complete: vi.fn(), extract: vi.fn(), healthCheck: vi.fn().mockResolvedValue(true) };
}

function completionResult(rawResponse: string, provider: string, model: string): CompletionResult {
  return {
    provider,
    model,
    promptVersion: 'brand-query.v1.0',
    rawResponse,
    tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    latencyMs: 10,
    timestamp: new Date().toISOString(),
    requestId: `req-${Math.random()}`,
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

const PROMPTS_DIR = path.join(import.meta.dirname, '../../prompts');

const Q1: GeneratedQuery = { text: 'best CRM for startups?', category: 'commercial', intentType: 'commercial', tags: [], priority: 1 };

describe('runFreeSnapshotAiQueries', () => {
  it('fans out to every provider `geo.query` resolves to (all 4 cloud providers) and never routes a GEO query to Ollama', async () => {
    const openai = fakeProvider('openai', 'gpt-4o');
    const anthropic = fakeProvider('anthropic', 'claude');
    const google = fakeProvider('google', 'gemini');
    const perplexity = fakeProvider('perplexity', 'sonar');
    const ollama = fakeProvider('ollama', 'qwen3:8b');

    for (const p of [openai, anthropic, google, perplexity]) {
      p.complete.mockResolvedValue(completionResult('Acme is a fine choice.', p.name, p.model));
    }
    ollama.extract.mockResolvedValue(
      extractionResult({
        brandMentioned: true,
        brandFirstPosition: 0.2,
        brandMentionCount: 1,
        brandSentiment: 'positive',
        brandContext: 'Acme is a fine choice',
        brandRecommended: false,
        brandRecommendationStrength: null,
        competitorsMentioned: [],
        citedUrls: [],
        citedDomains: [],
        responseLanguage: 'en',
        responseWordCount: 5,
      }),
    );

    const registry = new AIProviderRegistry({ default: 'ollama', providers: { openai, anthropic, google, perplexity, ollama } });

    const result = await runFreeSnapshotAiQueries('Acme', [Q1], { registry, promptsBaseDir: PROMPTS_DIR });

    expect(result.providers.sort()).toEqual(['anthropic', 'google', 'openai', 'perplexity']);
    expect(ollama.complete).not.toHaveBeenCalled();
    expect(openai.extract).not.toHaveBeenCalled();
    expect(ollama.extract).toHaveBeenCalledTimes(4);
    expect(result.observations).toHaveLength(4);
    expect(result.totalQueries).toBe(1);
  });

  it('computes the sample AI Visibility Score with the exact same formula as the paid pipeline, from only the successful observations', async () => {
    const openai = fakeProvider('openai', 'gpt-4o');
    const anthropic = fakeProvider('anthropic', 'claude');
    const ollama = fakeProvider('ollama', 'qwen3:8b');

    openai.complete.mockResolvedValue(completionResult('Acme is great, I recommend Acme.', 'openai', 'gpt-4o'));
    // anthropic's GEO-query call itself fails outright — no evidence, no observation.
    anthropic.complete.mockRejectedValue(new Error('connection reset'));

    ollama.extract.mockResolvedValue(
      extractionResult({
        brandMentioned: true,
        brandFirstPosition: 0.0,
        brandMentionCount: 2,
        brandSentiment: 'positive',
        brandContext: 'Acme is great',
        brandRecommended: true,
        brandRecommendationStrength: 'strong',
        competitorsMentioned: ['Rival Inc'],
        citedUrls: [],
        citedDomains: [],
        responseLanguage: 'en',
        responseWordCount: 6,
      }),
    );

    const registry = new AIProviderRegistry({ default: 'ollama', providers: { openai, anthropic, ollama } });

    const result = await runFreeSnapshotAiQueries('Acme', [Q1], { registry, promptsBaseDir: PROMPTS_DIR });

    // `resolveNames('geo.query')` always returns the FULL 4-cloud-provider
    // taskDefault (openai/anthropic/google/perplexity), regardless of which
    // of those this particular registry actually has instances for — same
    // "totalProviders is the fan-out width, not the success count"
    // denominator `pipeline.ts` uses. google/perplexity aren't registered
    // here, so `registry.get()` throws for them and they simply contribute
    // no observation, same numeric effect as a provider call failing.
    expect(result.totalQueries).toBe(1);
    expect(result.providers).toHaveLength(4);
    expect(result.observations).toHaveLength(1);
    // MentionScore = 1/(1*4)*100 = 25; RecommendationScore = 1/1*100 = 100;
    // PositionScore = (1-0)*100 = 100; CoverageScore = 1/1*100 = 100.
    // AVS = 25*0.25 + 100*0.40 + 100*0.20 + 100*0.15 = 81.25
    expect(result.score.mentionScore).toBe(25);
    expect(result.score.recommendationScore).toBe(100);
    expect(result.score.positionScore).toBe(100);
    expect(result.score.coverageScore).toBe(100);
    expect(result.score.aiVisibilityScore).toBe(81.25);
    expect(result.observations[0]!.competitorsMentioned).toEqual(['Rival Inc']);
  });

  it('never caps or expands the query list itself — the caller\'s free-tier cap is what limits how many queries are run', async () => {
    const openai = fakeProvider('openai', 'gpt-4o');
    openai.complete.mockResolvedValue(completionResult('nothing relevant', 'openai', 'gpt-4o'));
    const registry = new AIProviderRegistry({ default: 'openai', providers: { openai } });

    const manyQueries: GeneratedQuery[] = Array.from({ length: 7 }, (_, i) => ({
      text: `query ${i}`,
      category: 'category',
      intentType: 'informational',
      tags: [],
      priority: 3,
    }));

    const result = await runFreeSnapshotAiQueries('Acme', manyQueries, { registry, promptsBaseDir: PROMPTS_DIR });

    expect(result.totalQueries).toBe(7);
    expect(openai.complete).toHaveBeenCalledTimes(7);
  });
});
