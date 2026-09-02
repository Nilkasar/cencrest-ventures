/**
 * The extraction boundary (ADR-004): turn a raw LLM text response into a
 * JSON value that has been validated against the caller-supplied schema, or
 * throw a specific, typed error. This is the one place `extract<T>()` (in
 * `providers/base-provider.ts`) delegates parsing/validation to, so every
 * provider gets identical, testable behavior here regardless of transport.
 */
import Ajv from 'ajv';
import type { JSONSchema } from './types.js';
import { JsonParseError, SchemaValidationError } from './errors.js';

// One Ajv instance for the whole process. `strict: false` because callers
// hand us arbitrary hand-written JSON Schema (no particular draft is
// enforced) — we want validation, not Ajv's stricter authoring lint rules.
// `allErrors: true` so a failed extraction reports every mismatch at once,
// which also becomes part of the retry prompt (see base-provider.ts).
const ajv = new Ajv({ strict: false, allErrors: true });

/** Best-effort extraction of a JSON value out of free-form model output.
 * Models routinely wrap JSON in ```json fences, add a sentence before/after
 * it, or otherwise don't return *pure* JSON even when asked to. Order of
 * attempts, cheapest/most-specific first:
 *   1. The whole trimmed string parses as-is.
 *   2. A ```json ... ``` (or bare ``` ... ```) fenced block.
 *   3. The substring between the first `{`/`[` and the matching last
 *      `}`/`]` in the response.
 * Never throws — returns the best candidate substring found, or the
 * original text if nothing looked JSON-shaped (JSON.parse will then fail
 * with a clear error at the call site).
 */
export function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) {
    return trimmed;
  }

  const objectComesFirst = firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket);
  if (objectComesFirst) {
    const last = trimmed.lastIndexOf('}');
    if (last > firstBrace) return trimmed.slice(firstBrace, last + 1);
  } else {
    const last = trimmed.lastIndexOf(']');
    if (last > firstBracket) return trimmed.slice(firstBracket, last + 1);
  }

  return trimmed;
}

/** Parses `raw` as JSON and validates it against `schema`. Throws
 * `JsonParseError` if no valid JSON could be parsed at all, or
 * `SchemaValidationError` if it parsed but doesn't match `schema`. Never
 * returns an unvalidated value. */
export function parseAndValidateJson<T>(raw: string, schema: JSONSchema): T {
  const candidate = extractJsonCandidate(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new JsonParseError(raw, err);
  }

  const validate = ajv.compile(schema);
  if (!validate(parsed)) {
    throw new SchemaValidationError(validate.errors ?? [], parsed);
  }

  return parsed as T;
}
