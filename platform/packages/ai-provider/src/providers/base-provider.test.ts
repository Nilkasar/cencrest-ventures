import { describe, expect, it, vi } from 'vitest';
import type { CompletionRequest, CompletionResult } from '../types.js';
import { ExtractionValidationError, MissingPromptVersionError } from '../errors.js';
import { BaseAIProvider } from './base-provider.js';

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
} as const;

function completionFor(rawResponse: string): CompletionResult {
  return {
    provider: 'fake',
    model: 'fake-model',
    promptVersion: 'test.v1',
    rawResponse,
    tokensUsed: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    latencyMs: 1,
    timestamp: new Date().toISOString(),
    requestId: 'req-1',
  };
}

/** Minimal concrete subclass so `extract()`'s shared retry/validation logic
 * can be tested without any real HTTP transport. `complete` is a plain
 * `vi.fn` the test configures per-case. */
class FakeProvider extends BaseAIProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  complete = vi.fn<(request: CompletionRequest) => Promise<CompletionResult>>();

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('BaseAIProvider.extract', () => {
  it('succeeds on the first attempt when the response already matches the schema', async () => {
    const provider = new FakeProvider();
    provider.complete.mockResolvedValueOnce(completionFor('{"ok": true}'));

    const result = await provider.extract({
      userPrompt: 'go',
      promptVersion: 'test.v1',
      schema: SCHEMA,
    });

    expect(result.parsed).toEqual({ ok: true });
    expect(result.parseAttempts).toBe(1);
    expect(result.rawResponseBeforeParsing).toBe('{"ok": true}');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('retries on a schema mismatch and succeeds on a later attempt', async () => {
    const provider = new FakeProvider();
    provider.complete
      .mockResolvedValueOnce(completionFor('not json'))
      .mockResolvedValueOnce(completionFor('{"ok": true}'));

    const result = await provider.extract({
      userPrompt: 'go',
      promptVersion: 'test.v1',
      schema: SCHEMA,
      retries: 2,
    });

    expect(result.parsed).toEqual({ ok: true });
    expect(result.parseAttempts).toBe(2);
    expect(provider.complete).toHaveBeenCalledTimes(2);
    // the retry attempt's prompt must carry forward context about the failure
    const secondCallArg = provider.complete.mock.calls[1]?.[0];
    expect(secondCallArg?.userPrompt).toContain('go');
    expect(secondCallArg?.userPrompt.length).toBeGreaterThan('go'.length);
  });

  it('throws ExtractionValidationError after exhausting retries, never returning unvalidated data', async () => {
    const provider = new FakeProvider();
    provider.complete.mockResolvedValue(completionFor('still not json'));

    await expect(
      provider.extract({ userPrompt: 'go', promptVersion: 'test.v1', schema: SCHEMA, retries: 2 }),
    ).rejects.toThrow(ExtractionValidationError);

    // default 2 retries ⇒ 3 total attempts
    expect(provider.complete).toHaveBeenCalledTimes(3);
  });

  it('defaults to 2 retries (3 total attempts) when retries is omitted', async () => {
    const provider = new FakeProvider();
    provider.complete.mockResolvedValue(completionFor('still not json'));

    await expect(provider.extract({ userPrompt: 'go', promptVersion: 'test.v1', schema: SCHEMA })).rejects.toThrow();

    expect(provider.complete).toHaveBeenCalledTimes(3);
  });

  it('rejects an extract() call with no promptVersion before ever calling complete()', async () => {
    const provider = new FakeProvider();

    await expect(
      provider.extract({ userPrompt: 'go', promptVersion: '', schema: SCHEMA }),
    ).rejects.toThrow(MissingPromptVersionError);
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
