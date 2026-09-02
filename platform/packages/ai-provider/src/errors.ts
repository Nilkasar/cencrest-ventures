/** All errors this package throws, in one place — never a bare `Error`, so
 * callers (and tests) can distinguish "provider not configured" (expected,
 * routed around) from "provider blew up" (real failure) from "model output
 * didn't parse" (extraction discipline, ADR-004). */

export class MissingPromptVersionError extends Error {
  constructor(public readonly provider: string) {
    super(
      `${provider}: "promptVersion" is required on every CompletionRequest ` +
        `(ADR-006 evidence-traceability contract) — no exceptions.`,
    );
    this.name = 'MissingPromptVersionError';
  }
}

/** Thrown by a cloud provider's `complete()`/`extract()` when called with no
 * API key configured. `healthCheck()` must NEVER throw this (or anything
 * else) — it reports `false` instead. This is only for the case where a
 * caller bypasses `AIProviderRegistry.resolveAvailable()` and calls a
 * misconfigured provider directly. */
export class ProviderNotConfiguredError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider}: no API key configured — check healthCheck() before calling complete()/extract().`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/** A provider's HTTP transport returned a non-2xx response. */
export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${provider}: request failed with status ${status}: ${body.slice(0, 500)}`);
    this.name = 'ProviderRequestError';
  }
}

/** No JSON value could be parsed out of the raw model response at all. */
export class JsonParseError extends Error {
  public override readonly cause?: unknown;

  constructor(
    public readonly rawResponse: string,
    cause: unknown,
  ) {
    super(`Could not parse JSON out of the model response: ${causeMessage(cause)}`);
    this.name = 'JsonParseError';
    this.cause = cause;
  }
}

/** JSON parsed fine but failed schema validation. */
export class SchemaValidationError extends Error {
  constructor(
    public readonly errors: readonly unknown[],
    public readonly value: unknown,
  ) {
    super(`Extracted JSON does not match the provided schema: ${JSON.stringify(errors)}`);
    this.name = 'SchemaValidationError';
  }
}

/** `extract<T>()` exhausted its retry budget without producing schema-valid
 * JSON (ADR-004 — malformed LLM output must never silently become a wrong
 * observation). */
export class ExtractionValidationError extends Error {
  public override readonly cause?: unknown;

  constructor(
    public readonly provider: string,
    public readonly attempts: number,
    public readonly lastRawResponse: string,
    lastError: unknown,
  ) {
    super(
      `${provider}: extract<T>() failed to produce schema-valid JSON after ` +
        `${attempts} attempt(s). Last error: ${causeMessage(lastError)}`,
    );
    this.name = 'ExtractionValidationError';
    this.cause = lastError;
  }
}

export class ProviderNotRegisteredError extends Error {
  constructor(public readonly provider: string) {
    super(`No AIProvider is registered under the name "${provider}".`);
    this.name = 'ProviderNotRegisteredError';
  }
}

export class NoAvailableProviderError extends Error {
  constructor(
    public readonly task: string,
    public readonly tried: readonly string[],
  ) {
    super(
      `No healthy provider available for task "${task}" ` +
        `(tried: ${tried.length > 0 ? tried.join(', ') : 'none registered'}).`,
    );
    this.name = 'NoAvailableProviderError';
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
