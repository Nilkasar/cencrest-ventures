/**
 * Verbatim contract from `docs/12-ai/AI_ARCHITECTURE.md` — do not add required
 * fields/methods here without updating that doc first. Everything in this
 * file is what `apps/api` and future agent code are allowed to depend on;
 * provider-specific request/response shapes stay inside each provider file.
 */

/** A JSON Schema document, as passed to `extract<T>()`. Kept as a plain
 * object (not a generated type) so callers can hand-write or import schemas
 * from anywhere without this package depending on a particular schema
 * authoring library. */
export type JSONSchema = Record<string, unknown>;

/**
 * Token counts as REPORTED BY THE PROVIDER — never estimated from string
 * length. Every provider in this package returns usage metadata (OpenAI and
 * Perplexity: `usage.prompt_tokens`/`completion_tokens`; Anthropic:
 * `usage.input_tokens`/`output_tokens`; Google:
 * `usageMetadata.promptTokenCount`/`candidatesTokenCount`; Ollama:
 * `prompt_eval_count`/`eval_count`), so these numbers are what the vendor
 * will actually bill for. This is the input to cost metering — see
 * `pricing.ts` and `@bebest/api`'s `lib/ai-usage/`.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Prompt tokens served from the provider's prompt cache, when it reports
   * them (OpenAI `usage.prompt_tokens_details.cached_tokens`, Anthropic
   * `usage.cache_read_input_tokens`, Google
   * `usageMetadata.cachedContentTokenCount`). Recorded for observability;
   * `pricing.ts` deliberately does NOT yet discount them (erring high is
   * the safe direction for a margin sensor).
   */
  cachedPromptTokens?: number;
  /** Reasoning tokens, when reported (OpenAI
   * `usage.completion_tokens_details.reasoning_tokens`, Google
   * `usageMetadata.thoughtsTokenCount`). Already INCLUDED in
   * `completionTokens` — surfaced separately only so an unexpectedly
   * expensive run can be explained. */
  reasoningTokens?: number;
}

export interface CompletionRequest {
  systemPrompt?: string;
  userPrompt: string;
  /** REQUIRED — evidence-traceability contract (ADR-006). Every provider's
   * `complete()`/`extract()` MUST throw `MissingPromptVersionError` rather
   * than silently proceed when this is empty. */
  promptVersion: string;
  /** default: 0.7 */
  temperature?: number;
  maxTokens?: number;
  /** Stored alongside the response by the caller (this package does not
   * persist anything itself — no database access here). */
  metadata?: Record<string, unknown>;
}

export interface CompletionResult {
  provider: string;
  model: string;
  promptVersion: string;
  rawResponse: string;
  tokensUsed: TokenUsage;
  /**
   * The provider's own stop/finish reason, verbatim and un-normalized
   * (OpenAI/Perplexity `choices[0].finish_reason`, Anthropic `stop_reason`,
   * Google `candidates[0].finishReason`, Ollama `done_reason`). Stored on
   * `ai_usage.finish_reason`: a `length`/`MAX_TOKENS` value is how a
   * truncated-but-fully-billed response becomes visible instead of just
   * looking like a bad answer.
   */
  finishReason?: string | null;
  latencyMs: number;
  /** ISO8601 */
  timestamp: string;
  /** UUID, for tracing */
  requestId: string;
}

/** `T` is a phantom type param here (verbatim contract shape): it isn't used
 * by `ExtractionRequest` itself, only by the matching
 * `ExtractionResult<T>.parsed` an implementation returns, so callers get
 * `extract<Foo>(...)` end-to-end type inference. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ExtractionRequest<T> extends CompletionRequest {
  schema: JSONSchema;
  /** Number of RETRIES after the first attempt (i.e. total attempts made is
   * `retries + 1`). default: 2 → up to 3 attempts total. */
  retries?: number;
}

export interface ExtractionResult<T> extends CompletionResult {
  parsed: T;
  rawResponseBeforeParsing: string;
  parseAttempts: number;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;

  /** Free-form text completion. */
  complete(request: CompletionRequest): Promise<CompletionResult>;

  /** Structured extraction — must return JSON matching `schema`, validated
   * and retried per `ExtractionRequest.retries`. */
  extract<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>>;

  /** Must resolve `false`, never throw, when the provider has no API key
   * configured or is otherwise unreachable. */
  healthCheck(): Promise<boolean>;
}

/** The five providers this epic implements. `AIProviderRegistry` is typed
 * against this union for its built-in `taskDefaults` table; nothing stops a
 * caller from registering additional custom providers under their own
 * string keys (see `registry.ts`). */
export type KnownProviderName = 'ollama' | 'openai' | 'anthropic' | 'google' | 'perplexity';

/** Dependency-injectable fetch signature, so every provider can be unit
 * tested with a hand-rolled mock instead of intercepting global `fetch` or
 * pulling in an HTTP-mocking library. Defaults to the global `fetch` at
 * construction time. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
