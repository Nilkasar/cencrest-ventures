# Epic 6 — AI Provider Abstraction (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect. Depends on Epic 0 (platform foundation) only — no dependency on the CRM/Brand/SEO epics, so this could in principle be pulled earlier if a later epic needs it sooner. Everything AI-related in Epics 7, 11, 12 depends on this.

## Why this epic

ADR-003 (`DECISIONS.md`) is explicit and non-negotiable: **no application code may import an AI provider SDK directly.** This is the one epic where getting the interface wrong is expensive everywhere downstream — GEO testing alone calls all 4 real assistants (OpenAI, Anthropic, Google, Perplexity) per query, and local development must work against Ollama with zero cloud cost. Build the abstraction once, correctly, before anything depends on it.

## Interface (`docs/12-ai/AI_ARCHITECTURE.md`, verbatim contract — implement exactly this shape)

```typescript
interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  extract<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>>;
  healthCheck(): Promise<boolean>;
}
```
`CompletionRequest.promptVersion` is REQUIRED on every call — no exceptions, this is the evidence-traceability contract (ADR-006). `CompletionResult` always carries `requestId`, `timestamp`, `tokensUsed`, `latencyMs` — every AI call is logged with these regardless of provider.

## Providers to implement this epic

- `OllamaProvider` — local dev default, `qwen3:8b`, no API key.
- `OpenAIProvider`, `AnthropicProvider`, `GoogleProvider`, `PerplexityProvider` — cloud, optional, key-gated (absence of an API key means the provider reports `healthCheck() === false`, it does not throw at import time).
- `AIProviderRegistry` with the exact `taskDefaults` routing table from `docs/12-ai/AI_ARCHITECTURE.md` (`geo.query` → all 4 cloud providers, `content.generation` → openai-or-ollama-fallback, `seo.analysis`/`extraction` → ollama).

## Prompt system (`docs/12-ai/AI_ARCHITECTURE.md`)

Prompts are versioned template files under `apps/api/prompts/{geo,seo,content,agents}/*.v{version}.txt`, rendered with variable substitution at call time. Patch/minor/major version semantics apply (bug fix / value-changing improvement / breaking schema change). The `prompt_versions` table (Epic 0's schema) is the durable record — file-based templates are the source of truth checked into git, the table tracks what's actually been used against real data once this runs live.

## Extraction schema discipline (ADR-004, carried forward from Epic 0)

`extract<T>()` must validate the LLM's JSON output against the provided schema and retry (default 2 attempts) on mismatch — never let malformed LLM output silently become a wrong observation. This is the boundary where "LLM extracts observations, formulas compute scores" is enforced in code, not just in a doc.

## What this epic does NOT include

No GEO query execution pipeline (that's Epic 7 — this epic only proves each provider's `complete`/`extract`/`healthCheck` works in isolation, with unit tests against a fake/mock transport, not live API calls). No evaluation-dataset harness (mentioned in `docs/12-ai/AI_ARCHITECTURE.md`'s "AI Evaluation Framework" — that's a later, explicitly-scoped epic once there's real extraction output to evaluate).

## End-to-end flow (qa-flow-tester must trace every step below, not just each provider in isolation)

1. `AIProviderRegistry.resolve('geo.query')` returns providers in the exact order/set specified by `taskDefaults` (all 4 cloud providers) — confirm this by reading the routing code, not just the config object; a misrouted call silently defaulting to Ollama for a GEO query would be invisible until Epic 7 and would invalidate the product's core evidence claim.
2. `OllamaProvider.complete()` (mocked transport) called WITHOUT a `promptVersion` — confirm this is a compile-time or runtime rejection, not a silently-accepted call (ADR-006 is non-negotiable).
3. `extract<T>()` called with a schema, and a mocked LLM response that doesn't match the schema on the first attempt but does on the second — confirm the retry actually happens (up to the configured default of 2) and `parseAttempts` is reported correctly.
4. `AnthropicProvider.healthCheck()` with no API key configured — confirm it resolves to `false` and does NOT throw, and that nothing upstream (e.g. app startup) crashes because of it.
5. A `complete()` call (mocked) — confirm every field required by `CompletionResult` (`requestId`, `timestamp`, `tokensUsed`, `latencyMs`, `promptVersion`) is actually populated, not left undefined because a provider adapter forgot one.
6. Confirm no file under `apps/api` (or any future consumer) imports a provider SDK (`openai`, `@anthropic-ai/sdk`, etc.) directly — grep for it; this is the one architectural rule (ADR-003) this entire epic exists to enforce.

## Definition of done

Standard DoD. Unit tests for the registry's routing logic and for request/response shape validation, all against mocked HTTP — no real API keys required to pass CI. A `healthCheck()` test asserting a provider without a configured key reports `false` cleanly rather than throwing.
