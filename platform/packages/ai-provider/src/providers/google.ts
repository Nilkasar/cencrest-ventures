import type { CompletionRequest, CompletionResult, FetchLike } from '../types.js';
import { ProviderNotConfiguredError, ProviderRequestError } from '../errors.js';
import { BaseAIProvider, buildRequestMeta, readBodySafely } from './base-provider.js';

export interface GoogleProviderOptions {
  apiKey?: string;
  /** default: gemini-2.0-flash */
  model?: string;
  baseURL?: string;
  fetchImpl?: FetchLike;
}

interface GoogleGenerateContentResponse {
  modelVersion?: string;
  candidates: Array<{ content: { parts: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
}

/** Gemini's API key travels as a `?key=` query parameter, not a header —
 * kept internal to this provider so nothing upstream has to know that. */
export class GoogleProvider extends BaseAIProvider {
  readonly name = 'google';
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GoogleProviderOptions = {}) {
    super();
    this.apiKey = options.apiKey && options.apiKey.length > 0 ? options.apiKey : undefined;
    this.model = options.model ?? 'gemini-2.0-flash';
    this.baseURL = (options.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.assertPromptVersion(request);
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.name);

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      },
    };
    if (request.systemPrompt) {
      body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    const start = Date.now();
    const res = await this.fetchImpl(
      `${this.baseURL}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      throw new ProviderRequestError(this.name, res.status, await readBodySafely(res));
    }

    const data = (await res.json()) as GoogleGenerateContentResponse;
    const candidate = data.candidates[0];
    const usage = data.usageMetadata ?? { promptTokenCount: 0, candidatesTokenCount: 0 };

    return {
      provider: this.name,
      model: data.modelVersion ?? this.model,
      promptVersion: request.promptVersion,
      rawResponse: candidate?.content.parts.map((part) => part.text ?? '').join('') ?? '',
      tokensUsed: {
        promptTokens: usage.promptTokenCount,
        completionTokens: usage.candidatesTokenCount,
        totalTokens: usage.promptTokenCount + usage.candidatesTokenCount,
      },
      latencyMs,
      ...buildRequestMeta(),
    };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await this.fetchImpl(`${this.baseURL}/models?key=${encodeURIComponent(this.apiKey)}`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
