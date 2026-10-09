import { describe, expect, it, vi } from 'vitest';
import { ProviderNotConfiguredError, ProviderRequestError } from '../errors.js';
import { GoogleProvider } from './google.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('GoogleProvider', () => {
  it('reports healthCheck() === false with no API key, without making a request', async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleProvider({ fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws ProviderNotConfiguredError from complete() with no API key', async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleProvider({ fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the API key as a query parameter and maps the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        modelVersion: 'gemini-2.0-flash',
        candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'world' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      }),
    );
    const provider = new GoogleProvider({ apiKey: 'g-test', fetchImpl });

    const result = await provider.complete({ systemPrompt: 'sys', userPrompt: 'hi', promptVersion: 'test.v1' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('key=g-test');
    expect(url).toContain('gemini-2.0-flash:generateContent');
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);

    expect(result).toMatchObject({
      provider: 'google',
      model: 'gemini-2.0-flash',
      rawResponse: 'hello world',
      tokensUsed: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });
  });

  it('throws ProviderRequestError on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, false, 403));
    const provider = new GoogleProvider({ apiKey: 'g-test', fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('healthCheck() resolves false (never throws) on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const provider = new GoogleProvider({ apiKey: 'g-test', fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
  });
});

describe('GoogleProvider usage + finish-reason mapping (cost metering input)', () => {
  it("maps Gemini's usageMetadata names and folds thinking tokens into completionTokens", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        modelVersion: 'gemini-2.0-flash-001',
        candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 900,
          candidatesTokenCount: 300,
          cachedContentTokenCount: 700,
          thoughtsTokenCount: 120,
        },
      }),
    );
    const provider = new GoogleProvider({ apiKey: 'g-key', fetchImpl });

    const result = await provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' });

    expect(result.tokensUsed).toEqual({
      promptTokens: 900,
      completionTokens: 420,
      totalTokens: 1320,
      cachedPromptTokens: 700,
      reasoningTokens: 120,
    });
    expect(result.finishReason).toBe('STOP');
    expect(result.model).toBe('gemini-2.0-flash-001');
  });

  it('omits the optional counters when Gemini does not report them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'x' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      }),
    );
    const provider = new GoogleProvider({ apiKey: 'g-key', fetchImpl });

    const result = await provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' });

    expect(result.tokensUsed).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
    expect(result.finishReason).toBeNull();
  });

  it('surfaces finishReason MAX_TOKENS for a truncated-but-billed response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'trunc' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1024 },
      }),
    );
    const provider = new GoogleProvider({ apiKey: 'g-key', fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).resolves.toMatchObject({
      finishReason: 'MAX_TOKENS',
    });
  });
});
