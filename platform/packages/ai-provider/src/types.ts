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

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
