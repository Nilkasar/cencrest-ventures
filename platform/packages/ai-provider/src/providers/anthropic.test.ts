import { describe, expect, it, vi } from 'vitest';
import { ProviderNotConfiguredError, ProviderRequestError } from '../errors.js';
import { AnthropicProvider } from './anthropic.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('AnthropicProvider', () => {
  it('reports healthCheck() === false with no API key, without making a request', async () => {
    const fetchImpl = vi.fn();
    const provider = new AnthropicProvider({ fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws ProviderNotConfiguredError from complete() with no API key', async () => {
    const fetchImpl = vi.fn();
    const provider = new AnthropicProvider({ fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the system prompt as a top-level field, not a message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 4, output_tokens: 2 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'ak-test', fetchImpl });

    const result = await provider.complete({ systemPrompt: 'sys', userPrompt: 'hi', promptVersion: 'test.v1' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('ak-test');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);

    expect(result).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      rawResponse: 'hello',
      tokensUsed: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    });
  });

  it('picks the text content block when multiple content blocks are returned', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'tool_use', text: undefined },
          { type: 'text', text: 'the real answer' },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'ak-test', fetchImpl });

    const result = await provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' });
    expect(result.rawResponse).toBe('the real answer');
  });

  it('throws ProviderRequestError on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, false, 429));
    const provider = new AnthropicProvider({ apiKey: 'ak-test', fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('healthCheck() resolves false (never throws) on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const provider = new AnthropicProvider({ apiKey: 'ak-test', fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(false);
  });
});
