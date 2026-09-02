import { describe, expect, it, vi } from 'vitest';
import { ProviderRequestError, MissingPromptVersionError } from '../errors.js';
import { OllamaProvider } from './ollama.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('OllamaProvider', () => {
  it('sends a chat request and maps the response to CompletionResult', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        model: 'qwen3:8b',
        message: { role: 'assistant', content: 'hello world' },
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    );
    const provider = new OllamaProvider({ fetchImpl });

    const result = await provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('qwen3:8b');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);

    expect(result).toMatchObject({
      provider: 'ollama',
      model: 'qwen3:8b',
      promptVersion: 'test.v1',
      rawResponse: 'hello world',
      tokensUsed: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    expect(result.requestId).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
  });

  it('includes the system prompt as a separate message when provided', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: { content: 'ok' } }));
    const provider = new OllamaProvider({ fetchImpl });

    await provider.complete({ systemPrompt: 'be terse', userPrompt: 'hi', promptVersion: 'test.v1' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('throws MissingPromptVersionError without making a request', async () => {
    const fetchImpl = vi.fn();
    const provider = new OllamaProvider({ fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: '' })).rejects.toThrow(
      MissingPromptVersionError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws ProviderRequestError on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, false, 500));
    const provider = new OllamaProvider({ fetchImpl });

    await expect(provider.complete({ userPrompt: 'hi', promptVersion: 'test.v1' })).rejects.toThrow(
      ProviderRequestError,
    );
  });

  describe('healthCheck', () => {
    it('resolves true when /api/tags responds OK', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
      const provider = new OllamaProvider({ fetchImpl });
      await expect(provider.healthCheck()).resolves.toBe(true);
    });

    it('resolves false (never throws) when the request fails outright', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const provider = new OllamaProvider({ fetchImpl });
      await expect(provider.healthCheck()).resolves.toBe(false);
    });

    it('resolves false when Ollama responds with a non-OK status', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false } as Response);
      const provider = new OllamaProvider({ fetchImpl });
      await expect(provider.healthCheck()).resolves.toBe(false);
    });
  });

  it('extract() end-to-end: parses and validates the mocked response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ message: { content: '```json\n{"brandMentioned": true}\n```' } }),
    );
    const provider = new OllamaProvider({ fetchImpl });

    const result = await provider.extract<{ brandMentioned: boolean }>({
      userPrompt: 'extract',
      promptVersion: 'extraction.v1',
      schema: { type: 'object', properties: { brandMentioned: { type: 'boolean' } }, required: ['brandMentioned'] },
    });

    expect(result.parsed).toEqual({ brandMentioned: true });
    expect(result.parseAttempts).toBe(1);
  });
});
