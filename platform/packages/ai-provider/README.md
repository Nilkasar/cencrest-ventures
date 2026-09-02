# @bebest/ai-provider

The AI provider abstraction (Epic 6). This is the ONLY sanctioned way for
`apps/api` (or any future agent code) to call an AI provider — ADR-003:
"no application code may import an AI provider SDK directly." Nothing in
this package touches a database, reads `process.env`, or makes a real
network call during its own test suite.

See `DECISIONS.md` for the reasoning behind anything below that isn't a
literal transcription of `docs/12-ai/AI_ARCHITECTURE.md` (repo root) /
`platform/docs/epics/06-ai-provider-abstraction.md`.

## What's here

- **`AIProvider` interface** (`src/types.ts`) — `complete()`, `extract<T>()`,
  `healthCheck()`, exactly as specified in AI_ARCHITECTURE.md.
- **Five providers** (`src/providers/`):
  - `OllamaProvider` — local dev default (`qwen3:8b`), no API key.
  - `OpenAIProvider`, `AnthropicProvider`, `GoogleProvider`,
    `PerplexityProvider` — cloud, key-gated. With no `apiKey` passed,
    `healthCheck()` resolves `false` and `complete()`/`extract()` throw
    `ProviderNotConfiguredError` — neither ever throws from a missing key
    alone at construction time.
  - All five extend `BaseAIProvider`, which implements `extract<T>()` once
    (parse → validate against the caller's JSON Schema → retry with a
    stricter prompt on mismatch, default 2 retries / 3 total attempts) so
    every provider gets identical extraction-retry behavior.
- **`AIProviderRegistry`** (`src/registry.ts`) — the `taskDefaults` routing
  table (`geo.query` → fan out to all 4 cloud providers, `content.generation`
  → openai with an ollama fallback, `seo.analysis`/`extraction` → ollama).
  `resolve()` for fan-out callers, `resolveAvailable()` for
  fallback-to-first-healthy callers.
- **Prompt loader** (`src/prompts/loader.ts`) — the
  `{name}.v{version}.txt` file convention: `loadPromptTemplate()`,
  `listPromptVersions()`, `renderPrompt()` (`{{variable}}` substitution,
  throws on any unfilled placeholder), `promptVersionFor()`.

## Usage

```ts
import { AIProviderRegistry, OllamaProvider, OpenAIProvider } from '@bebest/ai-provider';

const registry = new AIProviderRegistry({
  default: 'ollama',
  providers: {
    ollama: new OllamaProvider(),
    openai: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  },
});

const provider = await registry.resolveAvailable('content.generation');
const result = await provider.complete({
  userPrompt: 'Write a one-sentence summary of X.',
  promptVersion: 'generate-page.v1.0',
});
```

Structured extraction:

```ts
const result = await provider.extract<{ brandMentioned: boolean }>({
  userPrompt: renderedExtractionPrompt,
  promptVersion: 'extraction-brand-mention.v1.0',
  schema: {
    type: 'object',
    properties: { brandMentioned: { type: 'boolean' } },
    required: ['brandMentioned'],
  },
});
result.parsed.brandMentioned; // boolean, guaranteed schema-valid
```

Prompt templates:

```ts
import { loadPromptTemplate, renderPrompt, promptVersionFor } from '@bebest/ai-provider';

const template = loadPromptTemplate({ baseDir: '/path/to/prompts', category: 'geo', name: 'brand-query' });
const userPrompt = renderPrompt(template, { brandName: 'Acme', query: 'best CRM for startups' });
await provider.complete({ userPrompt, promptVersion: promptVersionFor(template) });
```

## Tests

`pnpm test` (vitest). Every provider takes an injectable `fetchImpl`
(defaults to global `fetch`); every test passes a hand-rolled fake instead
of hitting a real endpoint or a configured API key — the suite passes with
zero environment variables set. `providers/base-provider.test.ts` covers
the shared `extract()` retry logic once, against a fake provider, rather
than duplicating it per real provider.

## What's NOT in this package (see DECISIONS.md for why)

- Reading provider API keys from `process.env` and constructing the
  registry — that composition happens in the consuming app (`apps/api`),
  not here.
- Persisting `CompletionResult`/`ExtractionResult` to the database
  (`ai_runs`, `ai_responses`, `prompt_versions`) — Epic 7's job.
- The GEO query execution pipeline itself, rate limiting/backoff across
  many calls, and the actual GEO/SEO/content prompt template files under
  `apps/api/prompts/**` — this epic proves the mechanism; later epics own
  the domain content and the pipeline that calls it.
