import type { CompletionRequest, CompletionResult, FetchLike } from '../types.js';
import { ProviderNotConfiguredError, ProviderRequestError } from '../errors.js';
import { BaseAIProvider, buildRequestMeta, readBodySafely } from './base-provider.js';

export interface PerplexityProviderOptions {
  apiKey?: string;
  /** default: sonar */
  model?: string;
  baseURL?: string;
  fetchImpl?: FetchLike;
}

interface PerplexityChatResponse {
  model?: string;
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class PerplexityProvider extends BaseAIProvider {
  readonly name = 'perplexity';
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: PerplexityProviderOptions = {}) {
    super();
    this.apiKey = options.apiKey && options.apiKey.length > 0 ? options.apiKey : undefined;
    this.model = options.model ?? 'sonar';
    this.baseURL = (options.baseURL ?? 'https://api.perplexity.ai').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.assertPromptVersion(request);
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.name);

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.userPrompt });

    const start = Date.now();
    const res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      }),
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      throw new ProviderRequestError(this.name, res.status, await readBodySafely(res));
    }

    const data = (await res.json()) as PerplexityChatResponse;
    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };

    return {
      provider: this.name,
      model: data.model ?? this.model,
      promptVersion: request.promptVersion,
      rawResponse: data.choices[0]?.message.content ?? '',
      tokensUsed: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.prompt_tokens + usage.completion_tokens,
      },
      latencyMs,
      ...buildRequestMeta(),
    };
  }

  /** Perplexity has no dedicated "list models" / health endpoint, so this
   * sends the cheapest possible real completion (`max_tokens: 1`) as a
   * connectivity+auth probe. Still never throws — a failure of any kind
   * (network, 401, etc.) resolves `false`. */
  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
