import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { AIProviderRegistry } from '@bebest/ai-provider';
import type { AIProvider, CompletionResult } from '@bebest/ai-provider';
import { countWords, generateDraftContent, parseGeneratedContent } from './draft-generator.js';

// The real prompts directory ships with `apps/api` — reused here rather
// than duplicating a fixture template, same "test against the real
// checked-in file" approach `lib/ai-visibility/pipeline.test.ts` uses for
// its own prompts.
const PROMPTS_BASE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');

function fakeProvider(rawResponse: string, overrides: Partial<CompletionResult> = {}, providerName = 'openai'): AIProvider {
  const result: CompletionResult = {
    provider: providerName,
    model: 'gpt-4o-mini',
    promptVersion: 'unused', // overwritten by the caller's actual promptVersion in real use
    rawResponse,
    tokensUsed: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    latencyMs: 42,
    timestamp: '2026-01-01T00:00:00.000Z',
    requestId: 'req-1',
    ...overrides,
  };
  return {
    name: providerName,
    model: 'gpt-4o-mini',
    complete: vi.fn().mockImplementation(async (req) => ({ ...result, promptVersion: req.promptVersion })),
    extract: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

describe('parseGeneratedContent', () => {
  it('parses the TITLE/META/BODY format', () => {
    const raw = 'TITLE: The Best Guide\nMETA: A short description of the guide.\nBODY:\nHere is the body.\nMore text.';
    const parsed = parseGeneratedContent(raw, 'fallback title');
    expect(parsed.title).toBe('The Best Guide');
    expect(parsed.metaDescription).toBe('A short description of the guide.');
    expect(parsed.body).toBe('Here is the body.\nMore text.');
  });

  it('degrades gracefully (never throws, never loses the raw text) when the format is not followed', () => {
    const raw = 'just some free-form text with no structure at all';
    const parsed = parseGeneratedContent(raw, 'fallback title');
    expect(parsed.title).toBe('fallback title');
    expect(parsed.metaDescription).toBeNull();
    expect(parsed.body).toBe(raw);
  });

  it('handles a missing META line (optional) while still parsing TITLE/BODY', () => {
    const raw = 'TITLE: A Title\nBODY:\nSome body text.';
    const parsed = parseGeneratedContent(raw, 'fallback');
    expect(parsed.title).toBe('A Title');
    expect(parsed.metaDescription).toBeNull();
    expect(parsed.body).toBe('Some body text.');
  });
});

describe('countWords', () => {
  it('counts words, collapsing whitespace', () => {
    expect(countWords('one two   three\nfour')).toBe(4);
  });

  it('returns 0 for empty/whitespace-only text', () => {
    expect(countWords('   ')).toBe(0);
    expect(countWords('')).toBe(0);
  });
});

describe('generateDraftContent', () => {
  const baseInput = {
    brandName: 'Acme',
    contentType: 'landing_page',
    title: 'Best Freight Visibility Software',
    targetQuery: 'best freight visibility software',
    keywords: ['freight visibility software'],
    implementationNotes: 'SEO requirements: x.\n\nGEO requirements: y.',
    evidenceSummary: 'CompetitorA appears in 84% of responses.',
    outline: [{ section: 'Introduction', notes: 'address the query' }],
    brandClaims: [{ id: 'c1', claim: 'SOC2 certified', confidence: 'high', verified: true }],
  };

  it('routes via AIProviderRegistry.resolveAvailable("content.generation"), never a hardcoded provider', async () => {
    const provider = fakeProvider('TITLE: Generated Title\nMETA: Generated meta description text here for testing purposes ok.\nBODY:\nGenerated body content.');
    const registry = new AIProviderRegistry({ providers: { openai: provider } });
    const resolveSpy = vi.spyOn(registry, 'resolveAvailable');

    const result = await generateDraftContent(baseInput, { registry, promptsBaseDir: PROMPTS_BASE_DIR });

    expect(resolveSpy).toHaveBeenCalledWith('content.generation');
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(result.providerName).toBe('openai');
    expect(result.title).toBe('Generated Title');
    expect(result.metaDescription).toBe('Generated meta description text here for testing purposes ok.');
    expect(result.body).toBe('Generated body content.');
    expect(result.wordCount).toBe(3);
  });

  it('stamps a real, non-empty promptVersion on every call (ADR-006 — "versioned like every other AI call in this system")', async () => {
    const provider = fakeProvider('TITLE: T\nBODY:\nB.');
    const registry = new AIProviderRegistry({ providers: { openai: provider } });

    const result = await generateDraftContent(baseInput, { registry, promptsBaseDir: PROMPTS_BASE_DIR });

    expect(result.promptVersion).toMatch(/^generation\.v\d+(\.\d+)*$/);
    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ promptVersion: result.promptVersion }));
  });

  it('falls back to ollama when the primary content.generation provider is unavailable, per taskDefaults', async () => {
    const unavailable: AIProvider = {
      name: 'openai',
      model: 'gpt-4o-mini',
      complete: vi.fn(),
      extract: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(false),
    };
    const fallback = fakeProvider('TITLE: T\nBODY:\nB.', {}, 'ollama');
    const registry = new AIProviderRegistry({ providers: { openai: unavailable, ollama: fallback } });

    const result = await generateDraftContent(baseInput, { registry, promptsBaseDir: PROMPTS_BASE_DIR });

    expect(unavailable.complete).not.toHaveBeenCalled();
    expect(fallback.complete).toHaveBeenCalledTimes(1);
    expect(result.providerName).toBe('ollama');
  });
});
