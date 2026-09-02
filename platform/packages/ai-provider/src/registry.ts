/**
 * `AIProviderRegistry` — the routing table from `docs/12-ai/AI_ARCHITECTURE.md`
 * ("Provider Resolution"), implemented as data plus two small resolution
 * methods, not scattered `if (task === ...)` checks. This is the seam Epic 7
 * (GEO query pipeline), Epic 11 (content generation), and Epic 12 (agents)
 * are expected to depend on — none of them should ever construct a provider
 * class directly.
 */
import type { AIProvider, KnownProviderName } from './types.js';
import { NoAvailableProviderError, ProviderNotRegisteredError } from './errors.js';

/** A task may resolve to one provider (`seo.analysis`, `extraction`), an
 * ordered fallback chain where only the first *available* one is actually
 * used (`content.generation`: openai, or ollama if no key), or a full
 * fan-out where the caller queries every listed provider
 * (`geo.query`: all 4 cloud assistants — GEO measures what each of them
 * says, so this is never a "pick one" case). The registry itself is
 * agnostic to which of those two usage patterns a caller wants — see
 * `resolve()` (fan-out — return every candidate) vs. `resolveAvailable()`
 * (fallback — return the first healthy candidate). */
export type TaskDefaults = Record<string, KnownProviderName | KnownProviderName[]>;

/** Transcribed verbatim from `docs/12-ai/AI_ARCHITECTURE.md`'s
 * `providerRegistry` example, with one deliberate change: `content.generation`
 * is stored as the ordered chain `['openai', 'ollama']` rather than the bare
 * string `'openai'` — the doc's own comment next to it ("or ollama if no
 * key") IS the fallback behavior the epic spec asks for; encoding it as an
 * array is what makes `resolveAvailable()` able to actually perform that
 * fallback instead of the comment being aspirational prose. */
export const DEFAULT_TASK_DEFAULTS: TaskDefaults = {
  'geo.query': ['openai', 'anthropic', 'google', 'perplexity'],
  'content.generation': ['openai', 'ollama'],
  'seo.analysis': ['ollama'],
  extraction: ['ollama'],
};

export interface AIProviderRegistryOptions {
  /** Global fallback when a task has no explicit routing and no override
   * was given. default: 'ollama' (local dev must always have a usable
   * default with zero cloud cost). */
  default?: KnownProviderName;
  providers: Partial<Record<KnownProviderName, AIProvider>>;
  /** Merged on top of `DEFAULT_TASK_DEFAULTS` — pass a partial table to
   * override specific tasks without having to repeat the rest. */
  taskDefaults?: TaskDefaults;
}

export class AIProviderRegistry {
  private readonly defaultProvider: KnownProviderName;
  private readonly providers: Partial<Record<KnownProviderName, AIProvider>>;
  private readonly taskDefaults: TaskDefaults;

  constructor(options: AIProviderRegistryOptions) {
    this.defaultProvider = options.default ?? 'ollama';
    this.providers = options.providers;
    this.taskDefaults = { ...DEFAULT_TASK_DEFAULTS, ...options.taskDefaults };
  }

  /** Every provider name registered with an actual instance. */
  list(): KnownProviderName[] {
    return Object.keys(this.providers) as KnownProviderName[];
  }

  /** Looks up a registered provider instance by name. Throws
   * `ProviderNotRegisteredError` — this is a programmer error (a task's
   * routing table names a provider nobody constructed), not a runtime
   * "unavailable" condition, so it throws rather than returning undefined. */
  get(name: KnownProviderName): AIProvider {
    const provider = this.providers[name];
    if (!provider) throw new ProviderNotRegisteredError(name);
    return provider;
  }

  /** Resolves the ordered candidate provider NAMES for `task`, honoring
   * priority: explicit `override` > `taskDefaults[task]` > global default
   * (exactly the "Provider Resolution" priority list in
   * AI_ARCHITECTURE.md). Always returns an array so callers have one shape
   * to iterate regardless of whether the task is single/fallback/fan-out. */
  resolveNames(task: string, override?: KnownProviderName | KnownProviderName[]): KnownProviderName[] {
    const chosen = override ?? this.taskDefaults[task] ?? this.defaultProvider;
    return Array.isArray(chosen) ? chosen : [chosen];
  }

  /** Same as `resolveNames`, but returns the registered `AIProvider`
   * instances. For a fan-out task (`geo.query`) this is every provider the
   * caller should query; for a single/fallback task, callers that want
   * fan-out-shaped access can still use this, but usually want
   * `resolveAvailable()` instead. Throws if any resolved name isn't
   * registered. */
  resolve(task: string, override?: KnownProviderName | KnownProviderName[]): AIProvider[] {
    return this.resolveNames(task, override).map((name) => this.get(name));
  }

  /** Fallback resolution: walks the candidates for `task` in order and
   * returns the first one whose `healthCheck()` resolves `true` (the
   * `content.generation`: "openai, or ollama if no key" behavior). A
   * candidate name that isn't registered is skipped rather than throwing,
   * so a routing table can list a provider that a given deployment simply
   * never constructed. Throws `NoAvailableProviderError` if none are
   * healthy. */
  async resolveAvailable(task: string, override?: KnownProviderName | KnownProviderName[]): Promise<AIProvider> {
    const candidates = this.resolveNames(task, override);
    const tried: string[] = [];

    for (const name of candidates) {
      const provider = this.providers[name];
      if (!provider) continue;
      tried.push(name);
      if (await provider.healthCheck()) return provider;
    }

    throw new NoAvailableProviderError(task, tried);
  }

  /** Runs `healthCheck()` on every registered provider concurrently — a
   * single call an ops/status endpoint can use to report which providers
   * are actually usable right now. */
  async healthCheckAll(): Promise<Partial<Record<KnownProviderName, boolean>>> {
    const entries = Object.entries(this.providers) as Array<[KnownProviderName, AIProvider]>;
    const results = await Promise.all(entries.map(async ([name, provider]) => [name, await provider.healthCheck()] as const));
    return Object.fromEntries(results);
  }
}
