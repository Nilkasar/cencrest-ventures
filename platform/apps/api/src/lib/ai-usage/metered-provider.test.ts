import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AIProvider, CompletionRequest, CompletionResult, ExtractionResult } from '@bebest/ai-provider';
import { MeteredAIProvider, wrapProvidersWithMetering, type AiUsageRecorder } from './metered-provider.js';
import type { AiUsageRecordInput } from './record.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

function completion(overrides: Partial<CompletionResult> = {}): CompletionResult {
  return {
    provider: 'openai',
    model: 'gpt-4o-2024-11-20',
    promptVersion: 'geo.brand-query.v1.0',
    rawResponse: 'hello',
    tokensUsed: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
    finishReason: 'stop',
    latencyMs: 912,
    timestamp: new Date().toISOString(),
    requestId: 'req-1',
    ...overrides,
  };
}

/** A hand-rolled fake — never a real network call, per the repo's own
 * provider-test convention. */
function fakeProvider(complete: (req: CompletionRequest) => Promise<CompletionResult>): AIProvider {
  return {
    name: 'openai',
    model: 'gpt-4o',
    complete: vi.fn(complete),
    extract: vi.fn(async () => {
      throw new Error('inner.extract() must never be called — MeteredAIProvider owns the retry loop');
    }),
    healthCheck: vi.fn(async () => true),
  };
}

let recorded: AiUsageRecordInput[];
let recorder: AiUsageRecorder;

beforeEach(() => {
  recorded = [];
  recorder = vi.fn(async (input: AiUsageRecordInput) => {
    recorded.push(input);
  });
});

describe('MeteredAIProvider', () => {
  it('is transparent: same name/model as the provider it wraps', () => {
    const metered = new MeteredAIProvider(fakeProvider(async () => completion()), { organizationId: ORG_A, feature: 'f' }, recorder);
    expect(metered.name).toBe('openai');
    expect(metered.model).toBe('gpt-4o');
  });

  it('returns the provider response unchanged and meters it with the provider-reported tokens', async () => {
    const inner = fakeProvider(async () => completion());
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'ai_visibility_run' }, recorder);

    const result = await metered.complete({ userPrompt: 'hi', promptVersion: 'v1' });

    expect(result.rawResponse).toBe('hello');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      attribution: { organizationId: ORG_A, feature: 'ai_visibility_run' },
      providerName: 'openai',
      // The model the provider ECHOED, not the requested one.
      model: 'gpt-4o-2024-11-20',
      tokensIn: 1000,
      tokensOut: 500,
      latencyMs: 912,
      finishReason: 'stop',
    });
  });

  it('carries the right organization_id per wrapper — two orgs never cross', async () => {
    const inner = fakeProvider(async () => completion());
    const a = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, recorder);
    const b = new MeteredAIProvider(inner, { organizationId: ORG_B, feature: 'f' }, recorder);

    await a.complete({ userPrompt: 'hi', promptVersion: 'v1' });
    await b.complete({ userPrompt: 'hi', promptVersion: 'v1' });

    expect(recorded.map((r) => r.attribution.organizationId)).toEqual([ORG_A, ORG_B]);
  });

  it('a metering failure never fails the AI call or loses the response', async () => {
    const inner = fakeProvider(async () => completion({ rawResponse: 'the expensive answer' }));
    const exploding: AiUsageRecorder = vi.fn(async () => {
      throw new Error('ai_usage insert blew up');
    });
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, exploding);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Production's `recordAiUsage` swallows its own errors; this proves the
    // decorator does NOT depend on that, so a future recorder that throws
    // still cannot destroy a response we have already paid for.
    await expect(metered.complete({ userPrompt: 'hi', promptVersion: 'v1' })).resolves.toMatchObject({
      rawResponse: 'the expensive answer',
    });
    expect(JSON.parse(errorSpy.mock.calls[0]![0] as string).msg).toBe('ai_usage_recorder_threw');
    errorSpy.mockRestore();
  });

  it('a metering failure mid-extraction does not lose the extracted result either', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = fakeProvider(async () => completion({ rawResponse: '{"ok":true}' }));
    const exploding: AiUsageRecorder = vi.fn(async () => {
      throw new Error('ai_usage insert blew up');
    });
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, exploding);

    const result = await metered.extract<{ ok: boolean }>({
      userPrompt: 'hi',
      promptVersion: 'v1',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    expect(result.parsed.ok).toBe(true);
    errorSpy.mockRestore();
  });

  it('does not meter a failed provider call (nothing was billed, nothing to record)', async () => {
    const inner = fakeProvider(async () => {
      throw new Error('429 rate limited');
    });
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, recorder);

    await expect(metered.complete({ userPrompt: 'hi', promptVersion: 'v1' })).rejects.toThrow('429 rate limited');
    expect(recorded).toHaveLength(0);
  });

  it('propagates the prompt-version requirement (ADR-006) unchanged', async () => {
    const metered = new MeteredAIProvider(fakeProvider(async () => completion()), { organizationId: ORG_A, feature: 'f' }, recorder);
    await expect(metered.complete({ userPrompt: 'hi', promptVersion: '' })).rejects.toThrow();
  });

  it('delegates healthCheck() to the wrapped provider', async () => {
    const inner = fakeProvider(async () => completion());
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, recorder);
    await expect(metered.healthCheck()).resolves.toBe(true);
    expect(inner.healthCheck).toHaveBeenCalledTimes(1);
  });
});

describe('MeteredAIProvider.extract()', () => {
  const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };

  it('meters the call once when extraction validates on the first attempt', async () => {
    const inner = fakeProvider(async () => completion({ rawResponse: '{"ok":true}' }));
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, recorder);

    const result: ExtractionResult<{ ok: boolean }> = await metered.extract<{ ok: boolean }>({
      userPrompt: 'hi',
      promptVersion: 'v1',
      schema,
    });

    expect(result.parsed.ok).toBe(true);
    expect(result.parseAttempts).toBe(1);
    expect(recorded).toHaveLength(1);
  });

  it('meters EVERY retry attempt — each one is a separately billed provider call', async () => {
    let call = 0;
    const inner = fakeProvider(async () => {
      call += 1;
      return completion({ rawResponse: call < 3 ? 'not json at all' : '{"ok":true}' });
    });
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, recorder);

    const result = await metered.extract<{ ok: boolean }>({ userPrompt: 'hi', promptVersion: 'v1', schema, retries: 2 });

    expect(result.parseAttempts).toBe(3);
    // This is the whole reason this class extends BaseAIProvider instead of
    // delegating to `inner.extract()`: 3 billed calls, 3 metered rows.
    expect(recorded).toHaveLength(3);
    expect(recorded.every((r) => r.tokensIn === 1000 && r.tokensOut === 500)).toBe(true);
  });

  it('still meters every attempt when extraction ultimately fails', async () => {
    const inner = fakeProvider(async () => completion({ rawResponse: 'never valid' }));
    const metered = new MeteredAIProvider(inner, { organizationId: ORG_A, feature: 'f' }, recorder);

    await expect(metered.extract({ userPrompt: 'hi', promptVersion: 'v1', schema, retries: 1 })).rejects.toThrow();
    expect(recorded).toHaveLength(2);
  });
});

describe('wrapProvidersWithMetering', () => {
  it('wraps every registered provider and skips absent ones', () => {
    const wrapped = wrapProvidersWithMetering(
      { openai: fakeProvider(async () => completion()), anthropic: undefined },
      { organizationId: ORG_A, feature: 'f' },
      recorder,
    );
    expect(Object.keys(wrapped)).toEqual(['openai']);
    expect(wrapped.openai).toBeInstanceOf(MeteredAIProvider);
  });
});

/**
 * THE TRIPWIRE. Metering only holds if new AI-calling code goes through
 * `getMeteredAiProviderRegistry()`. `getDefaultAiProviderRegistry()` returns
 * UNMETERED providers and exists only for callers that need the routing
 * table (`resolveNames`) to plan a run, without making a model call.
 *
 * If this test fails because you added a file: use
 * `getMeteredAiProviderRegistry(attribution)` instead. Only add to the
 * allowlist if your file genuinely makes no `complete()`/`extract()` call.
 */
describe('unmetered-registry allowlist', () => {
  const ALLOWED = new Set([
    // Reads the routing table to count planned jobs; makes no model call.
    'lib/agents/run-ai-visibility-step.ts',
    // Reads the routing table + each provider's model NAME to PRICE a run
    // before dispatch. Makes no model call, and deliberately never calls
    // healthCheck()/resolveAvailable() either (on Perplexity that is itself a
    // billed request) — see lib/ai-usage/run-cost-estimator.ts.
    'lib/ai-usage/run-preflight.ts',
    'routes/ai-runs.ts',
    'routes/competitor-ai-runs.ts',
    // The definition itself.
    'lib/ai-visibility/provider-registry.ts',
  ]);

  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) acc.push(full);
    }
    return acc;
  }

  it('no production file outside the allowlist references the unmetered registry accessor', () => {
    const srcRoot = path.resolve(import.meta.dirname, '../..');
    const offenders = walk(srcRoot)
      .filter((file) => readFileSync(file, 'utf8').includes('getDefaultAiProviderRegistry'))
      .map((file) => path.relative(srcRoot, file))
      // Doc-comment-only mentions in modules that never import it.
      .filter((rel) => rel !== 'lib/queue/default-job-queue.ts')
      .filter((rel) => !ALLOWED.has(rel));

    expect(offenders).toEqual([]);
  });
});
