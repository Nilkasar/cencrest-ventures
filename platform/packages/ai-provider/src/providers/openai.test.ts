import { describe, expect, it, vi } from 'vitest';
import { MissingPromptVersionError, ProviderNotConfiguredError, ProviderRequestError } from '../errors.js';
import { OpenAIProvider } from './openai.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('OpenAIProvider', () => {
  it('reports healthCheck() === false with no API key, without making a request', async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAIProvider({ fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws ProviderNotConfiguredError from complete() with no API key, without making a request', async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAIProvider({ fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws MissingPromptVersionError even with a key configured', async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: '' })).rejects.toThrow(
      MissingPromptVersionError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends an authenticated chat/completions request and maps the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        model: 'gpt-4o',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }),
    );
    const provider = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });

    const result = await provider.complete({ systemPrompt: 'sys', userPrompt: 'hi', promptVersion: 'test.v1' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      rawResponse: 'hello',
      tokensUsed: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
    });
  });

  it('throws ProviderRequestError on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad key' }, false, 401));
    const provider = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('healthCheck() resolves false (never throws) on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const provider = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it('healthCheck() resolves true when the key is valid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const provider = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(true);
  });
});
