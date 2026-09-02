import { describe, expect, it, vi } from 'vitest';
import { ProviderNotConfiguredError, ProviderRequestError } from '../errors.js';
import { PerplexityProvider } from './perplexity.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('PerplexityProvider', () => {
  it('reports healthCheck() === false with no API key, without making a request', async () => {
    const fetchImpl = vi.fn();
    const provider = new PerplexityProvider({ fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws ProviderNotConfiguredError from complete() with no API key', async () => {
    const fetchImpl = vi.fn();
    const provider = new PerplexityProvider({ fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends an authenticated chat/completions request and maps the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        model: 'sonar',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 6, completion_tokens: 2 },
      }),
    );
    const provider = new PerplexityProvider({ apiKey: 'p-test', fetchImpl });

    const result = await provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.perplexity.ai/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer p-test');

    expect(result).toMatchObject({
      provider: 'perplexity',
      model: 'sonar',
      rawResponse: 'hello',
      tokensUsed: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
    });
  });

  it('throws ProviderRequestError on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, false, 500));
    const provider = new PerplexityProvider({ apiKey: 'p-test', fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('healthCheck() probes with a minimal (max_tokens: 1) request and resolves true when OK', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const provider = new PerplexityProvider({ apiKey: 'p-test', fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(1);
  });

  it('healthCheck() resolves false (never throws) on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const provider = new PerplexityProvider({ apiKey: 'p-test', fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
  });
});
