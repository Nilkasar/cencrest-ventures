/**
 * THE ADAPTER BOUNDARY — every AI call in the platform passes through
 * `MeteredAIProvider.complete()`, so metering cannot be forgotten by the
 * next feature. Nothing calls `recordAiUsage` directly; it is called from
 * here and nowhere else.
 *
 * WHY A DECORATOR IN `apps/api` RATHER THAN METERING INSIDE THE PROVIDERS:
 *   - `@bebest/ai-provider` is a pure package with no database access and no
 *     concept of a tenant. Writing `ai_usage` from `providers/openai.ts`
 *     would put Prisma, RLS and `organization_id` inside it — an app concern
 *     leaking into a package whose whole purpose (ADR-003) is to be the only
 *     thing that knows how to talk to a vendor.
 *   - The `AIProvider` interface stays byte-identical, so no route, agent or
 *     pipeline signature changes. `MeteredAIProvider` IS an `AIProvider`;
 *     callers cannot tell the difference, and a test can still inject a
 *     hand-rolled fake registry exactly as before.
 *
 * WHY IT EXTENDS `BaseAIProvider` INSTEAD OF DELEGATING `extract()`:
 *   `extract()` retries until the JSON validates (up to `retries + 1`
 *   attempts) and EVERY attempt is a separately billed provider call. If this
 *   class delegated to `inner.extract()`, the inner provider's own
 *   `this.complete()` would bypass the decorator and only the final attempt's
 *   tokens would ever be seen — a silent under-count precisely on the
 *   expensive, badly-behaving calls we most want to see. Extending
 *   `BaseAIProvider` reuses that same shared retry implementation while
 *   routing each attempt through `this.complete()` — i.e. through metering.
 */
import { BaseAIProvider, type AIProvider, type CompletionRequest, type CompletionResult } from '@bebest/ai-provider';
import { recordAiUsage, type AiUsageRecordInput } from './record.js';
import type { AiUsageAttribution } from './attribution.js';

/** Injectable for tests; production always uses `recordAiUsage`. */
export type AiUsageRecorder = (input: AiUsageRecordInput) => Promise<void>;

export class MeteredAIProvider extends BaseAIProvider {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly inner: AIProvider,
    private readonly attribution: AiUsageAttribution,
    private readonly recorder: AiUsageRecorder = recordAiUsage,
  ) {
    super();
    // Transparent: callers reading `.name`/`.model` (e.g. pipeline.ts, which
    // persists the provider name on `ai_run_responses`) see the real
    // provider, never "metered".
    this.name = inner.name;
    this.model = inner.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // ADR-006 is enforced here too, not only inside the wrapped provider, so
    // the decorator honors the `AIProvider` contract on its own terms.
    this.assertPromptVersion(request);

    // A provider call that THROWS was not billed (no tokens were returned),
    // so nothing is metered and the error propagates untouched.
    const result = await this.inner.complete(request);

    // AWAITED, not fire-and-forget: this code runs in background jobs and in
    // serverless functions that can be frozen the instant the handler
    // returns, and a dropped promise there means a permanently lost row. The
    // added latency is one short transaction against a call that already took
    // seconds.
    //
    // The try/catch is the hard guarantee that a metering failure can never
    // fail the underlying AI call or lose a response we have already paid
    // for. `recordAiUsage` already swallows its own errors; this catch means
    // that promise is not the only thing standing between a bad metering
    // change and a destroyed response.
    try {
      await this.recorder({
        attribution: this.attribution,
        providerName: result.provider,
        model: result.model,
        tokensIn: result.tokensUsed.promptTokens,
        tokensOut: result.tokensUsed.completionTokens,
        latencyMs: result.latencyMs,
        finishReason: result.finishReason ?? null,
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'ai_usage_recorder_threw',
          provider: result.provider,
          model: result.model,
          feature: this.attribution.feature,
          organizationId: this.attribution.organizationId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    return result;
  }

  /**
   * Not metered, and deliberately so: `healthCheck()` returns a bare boolean
   * with no usage metadata, so there is nothing truthful to record. Note that
   * `PerplexityProvider.healthCheck()` is a REAL billed request (it sends a
   * `max_tokens: 1` completion, and Perplexity charges a flat per-request
   * search fee) — that spend is invisible to this table, and a frequently-polled
   * status endpoint calling `healthCheckAll()` would bill for every poll. See
   * `platform/GO_LIVE.md` §6.
   */
  healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }
}

/** Wraps every provider instance in `providers` with metering for one
 * attribution. The wrappers are cheap objects around shared provider
 * instances — no HTTP client or key is duplicated. */
export function wrapProvidersWithMetering<K extends string>(
  providers: Partial<Record<K, AIProvider>>,
  attribution: AiUsageAttribution,
  recorder?: AiUsageRecorder,
): Partial<Record<K, AIProvider>> {
  const wrapped: Partial<Record<K, AIProvider>> = {};
  for (const [name, provider] of Object.entries(providers) as Array<[K, AIProvider | undefined]>) {
    if (provider) wrapped[name] = new MeteredAIProvider(provider, attribution, recorder);
  }
  return wrapped;
}
