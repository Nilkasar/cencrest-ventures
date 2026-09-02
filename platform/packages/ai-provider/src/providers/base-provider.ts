import { randomUUID } from 'node:crypto';
import type { AIProvider, CompletionRequest, CompletionResult, ExtractionRequest, ExtractionResult } from '../types.js';
import { ExtractionValidationError, MissingPromptVersionError } from '../errors.js';
import { parseAndValidateJson } from '../json.js';

/** Shared plumbing for every concrete provider. A subclass implements only
 * `complete()` and `healthCheck()` (plus the two readonly fields); this
 * class provides `extract()` once, generically, on top of `complete()` —
 * so the retry-until-schema-valid behavior (ADR-004) is identical across
 * providers and gets tested once here rather than five times per provider.
 */
export abstract class BaseAIProvider implements AIProvider {
  abstract readonly name: string;
  abstract readonly model: string;

  abstract complete(request: CompletionRequest): Promise<CompletionResult>;
  abstract healthCheck(): Promise<boolean>;

  /** Every concrete `complete()` must call this before making a network
   * call — enforces the "promptVersion is required, no exceptions" rule at
   * a single shared checkpoint. */
  protected assertPromptVersion(request: CompletionRequest): void {
    if (!request.promptVersion || request.promptVersion.trim().length === 0) {
      throw new MissingPromptVersionError(this.name);
    }
  }

  async extract<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>> {
    this.assertPromptVersion(request);
    const maxAttempts = (request.retries ?? 2) + 1;

    let lastCompletion: CompletionResult | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptRequest: CompletionRequest =
        attempt === 1 ? request : { ...request, userPrompt: buildRetryPrompt(request, lastError) };

      const completion = await this.complete(attemptRequest);
      lastCompletion = completion;

      try {
        const parsed = parseAndValidateJson<T>(completion.rawResponse, request.schema);
        return {
          ...completion,
          parsed,
          rawResponseBeforeParsing: completion.rawResponse,
          parseAttempts: attempt,
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw new ExtractionValidationError(this.name, maxAttempts, lastCompletion?.rawResponse ?? '', lastError);
  }
}

function buildRetryPrompt<T>(request: ExtractionRequest<T>, lastError: unknown): string {
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  return (
    `${request.userPrompt}\n\n` +
    `Your previous response did not satisfy the requirements below:\n${reason}\n\n` +
    `Respond again with ONLY a single JSON value (no prose, no markdown fences) ` +
    `matching this JSON Schema:\n${JSON.stringify(request.schema)}`
  );
}

/** `requestId`/`timestamp` generation, shared so every provider stamps
 * these identically. `latencyMs` is measured by the caller (it wraps the
 * actual network call, which varies per provider). */
export function buildRequestMeta(): { requestId: string; timestamp: string } {
  return { requestId: randomUUID(), timestamp: new Date().toISOString() };
}

export async function readBodySafely(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
