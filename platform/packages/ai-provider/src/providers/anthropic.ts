import type { CompletionRequest, CompletionResult, FetchLike } from '../types.js';
import { ProviderNotConfiguredError, ProviderRequestError } from '../errors.js';
import { BaseAIProvider, buildRequestMeta, readBodySafely } from './base-provider.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  /** default: claude-sonnet-4-6 (see docs/12-ai/AI_ARCHITECTURE.md) */
  model?: string;
  baseURL?: string;
  fetchImpl?: FetchLike;
}

const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicMessagesResponse {
  model?: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  /** Real field names from the Messages response. `input_tokens` EXCLUDES
   * cache reads/writes, which Anthropic reports as their own counters — so
   * the billable input total is the sum of all three. */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export class AnthropicProvider extends BaseAIProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicProviderOptions = {}) {
    super();
    this.apiKey = options.apiKey && options.apiKey.length > 0 ? options.apiKey : undefined;
    this.model = options.model ?? 'claude-sonnet-4-6';
    this.baseURL = (options.baseURL ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.assertPromptVersion(request);
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.name);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: [{ role: 'user', content: request.userPrompt }],
      temperature: request.temperature ?? 0.7,
    };
    if (request.systemPrompt) body.system = request.systemPrompt;

    const start = Date.now();
    const res = await this.fetchImpl(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      throw new ProviderRequestError(this.name, res.status, await readBodySafely(res));
    }

    const data = (await res.json()) as AnthropicMessagesResponse;
    const textBlock = data.content.find((block) => block.type === 'text');
    const usage = data.usage ?? { input_tokens: 0, output_tokens: 0 };
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    // Cache reads/writes are billable input tokens that `input_tokens` does
    // not include; omitting them would under-count spend on any cached call.
    const promptTokens = usage.input_tokens + cacheRead + cacheWrite;
    const reportsCache = usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined;

    return {
      provider: this.name,
      model: data.model ?? this.model,
      promptVersion: request.promptVersion,
      rawResponse: textBlock?.text ?? '',
      tokensUsed: {
        promptTokens,
        completionTokens: usage.output_tokens,
        totalTokens: promptTokens + usage.output_tokens,
        ...(reportsCache ? { cachedPromptTokens: cacheRead } : {}),
      },
      finishReason: data.stop_reason ?? null,
      latencyMs,
      ...buildRequestMeta(),
    };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await this.fetchImpl(`${this.baseURL}/models`, {
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
