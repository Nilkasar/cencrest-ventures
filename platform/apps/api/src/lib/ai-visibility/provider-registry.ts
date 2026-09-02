/**
 * `apps/api`'s composition root for `@bebest/ai-provider` — the piece Epic
 * 6's own DECISIONS.md explicitly left for "whoever builds the epic that
 * consumes this" ("What a real deployment still has to wire up... reading
 * `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/
 * `PERPLEXITY_API_KEY` from `process.env` and constructing the
 * `AIProviderRegistry`... in `apps/api`, not in this package"). This is the
 * ONLY file in `apps/api` that reads those four env vars or constructs a
 * provider instance.
 *
 * `taskDefaults` is left at `@bebest/ai-provider`'s own
 * `DEFAULT_TASK_DEFAULTS` (not overridden here) — `'geo.query'` already
 * fans out to all four cloud providers there, which is the hard constraint
 * this epic must never silently weaken (`docs/12-ai/AI_ARCHITECTURE.md`:
 * "GEO queries specifically MUST use... all 4 real cloud assistants, never
 * Ollama"). `'extraction'` already routes to `['ollama']` there too — the
 * epic spec's explicit allowance ("Extraction... may use Ollama").
 */
import { AIProviderRegistry, OllamaProvider, OpenAIProvider, AnthropicProvider, GoogleProvider, PerplexityProvider } from '@bebest/ai-provider';

let cached: AIProviderRegistry | undefined;

/**
 * Builds (and memoizes) the process-wide registry from `process.env`.
 * Every cloud provider is constructed unconditionally — a missing API key
 * does not stop construction (per `@bebest/ai-provider`'s own contract:
 * `healthCheck()` resolves `false` and `complete()`/`extract()` throw
 * `ProviderNotConfiguredError` for an unconfigured provider; nothing here
 * needs to special-case "no key" itself).
 *
 * Tests should NOT call this — inject a hand-rolled fake `AIProvider` via
 * `AIProviderRegistry`'s own constructor directly (see
 * `pipeline.test.ts`), never a real network call, per the task's hard
 * constraint.
 */
export function getDefaultAiProviderRegistry(): AIProviderRegistry {
  if (!cached) {
    cached = new AIProviderRegistry({
      default: 'ollama',
      providers: {
        ollama: new OllamaProvider({ baseURL: process.env.OLLAMA_BASE_URL }),
        openai: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
        anthropic: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
        google: new GoogleProvider({ apiKey: process.env.GOOGLE_API_KEY }),
        perplexity: new PerplexityProvider({ apiKey: process.env.PERPLEXITY_API_KEY }),
      },
    });
  }
  return cached;
}

/** Test-only escape hatch — resets the memoized singleton so a test that
 * needs a fresh registry (e.g. after changing `process.env` mid-suite)
 * isn't stuck with whatever the first call constructed. Not used by
 * application code. */
export function __resetDefaultAiProviderRegistryForTesting(): void {
  cached = undefined;
}
