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

## Definition of done

Standard DoD. Unit tests for the registry's routing logic and for request/response shape validation, all against mocked HTTP — no real API keys required to pass CI. A `healthCheck()` test asserting a provider without a configured key reports `false` cleanly rather than throwing.
