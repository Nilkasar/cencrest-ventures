import type { CompletionRequest, CompletionResult, FetchLike } from '../types.js';
import { ProviderRequestError } from '../errors.js';
import { BaseAIProvider, buildRequestMeta, readBodySafely } from './base-provider.js';

export interface OllamaProviderOptions {
  /** default: http://localhost:11434 */
  baseURL?: string;
  /** default: qwen3:8b — the local-dev default model (AI_ARCHITECTURE.md). */
  model?: string;
  fetchImpl?: FetchLike;
}

interface OllamaChatResponse {
  model?: string;
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Local dev default — no API key, talks to a locally running `ollama
 * serve`. `healthCheck()` hits `/api/tags` (cheap, no model load) so
 * "is Ollama running at all" can be checked without generating anything. */
export class OllamaProvider extends BaseAIProvider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: OllamaProviderOptions = {}) {
    super();
    this.model = options.model ?? 'qwen3:8b';
    this.baseURL = (options.baseURL ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.assertPromptVersion(request);

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.userPrompt });

    const start = Date.now();
    const res = await this.fetchImpl(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
        },
      }),
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      throw new ProviderRequestError(this.name, res.status, await readBodySafely(res));
    }

    const data = (await res.json()) as OllamaChatResponse;
    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;

    return {
      provider: this.name,
      model: data.model ?? this.model,
      promptVersion: request.promptVersion,
      rawResponse: data.message?.content ?? '',
      tokensUsed: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      latencyMs,
      ...buildRequestMeta(),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseURL}/api/tags`, { method: 'GET' });
      return res.ok;
    } catch {
      // Ollama not running / unreachable — report unavailable, never throw.
      return false;
    }
  }
}
