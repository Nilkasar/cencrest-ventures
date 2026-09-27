/**
 * THE `ai_usage` WRITER — one function, called from exactly one place
 * (`metered-provider.ts`, the adapter-boundary decorator). Nothing else in
 * the codebase should call this: metering at call sites is how the leak
 * reopens the next time someone adds a feature.
 *
 * Two hard rules, both tested:
 *   1. It NEVER throws and never rejects. A metering failure must not fail
 *      the AI call or lose the response — we already paid the vendor; losing
 *      the answer on top of that is the worst possible outcome.
 *   2. It writes through `withOrgContext`, so the row is inserted inside a
 *      transaction with `app.current_org` set and `ai_usage`'s RLS
 *      `WITH CHECK` policy is satisfied. Background jobs (the AI Visibility
 *      pipeline, agent runs, the free-snapshot orchestrator) all run outside
 *      a request, so there is no ambient tenant context to inherit — they get
 *      it from the attribution their registry was built with.
 */
import { withOrgContext } from '@bebest/database';
import { computeAiCallCost } from '@bebest/ai-provider';
import { resolveMeteringOrgId, type AiUsageAttribution } from './attribution.js';

export interface AiUsageRecordInput {
  attribution: AiUsageAttribution;
  /** `AIProvider.name` — 'openai' | 'anthropic' | 'google' | 'perplexity' | 'ollama'. */
  providerName: string;
  /** The model the provider ECHOED BACK (e.g. `gpt-4o-2024-11-20`), not the
   * one we asked for — a provider silently serving a different snapshot is
   * exactly the kind of cost surprise this table exists to catch. */
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs?: number | null;
  finishReason?: string | null;
}

// Column widths from `schema.prisma`'s `ai_usage`. Truncated rather than
// allowed to raise a Postgres 22001 that would lose the whole row.
const PROVIDER_NAME_MAX = 50;
const MODEL_MAX = 100;
const FINISH_REASON_MAX = 50;

function log(level: 'warn' | 'error', msg: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.warn(line);
}

/**
 * Records one AI call's token counts and dollar cost. Resolves regardless of
 * outcome; problems are logged as structured JSON (same shape the rest of
 * this codebase's background code logs — see
 * `lib/free-snapshot/orchestrator.ts`).
 */
export async function recordAiUsage(input: AiUsageRecordInput): Promise<void> {
  try {
    const cost = computeAiCallCost({
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
    });

    // An UNPRICED model is a silent under-count of real spend, so it is
    // logged every time rather than quietly stored as $0. A self-hosted
    // (Ollama) zero is a genuine zero and is not warned about.
    if (!cost.pricingFound) {
      log('warn', 'ai_usage_model_unpriced', {
        provider: input.providerName,
        model: input.model,
        feature: input.attribution.feature,
        pricingTableVersion: cost.pricingTableVersion,
        hint: 'add this model to packages/ai-provider/src/pricing.ts — its spend is currently recorded as $0',
      });
    }

    const organizationId = resolveMeteringOrgId(input.attribution);
    if (organizationId === null) {
      log('error', 'ai_usage_write_skipped_no_org', {
        provider: input.providerName,
        model: input.model,
        feature: input.attribution.feature,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        costUsd: cost.usd,
        hint: 'CRM_INTERNAL_ORG_ID is unset, so unattributed AI spend cannot be recorded',
      });
      return;
    }

    await withOrgContext(organizationId, (tx) =>
      tx.ai_usage.create({
        data: {
          organization_id: organizationId,
          provider_name: input.providerName.slice(0, PROVIDER_NAME_MAX),
          model: input.model.slice(0, MODEL_MAX),
          tokens_in: Math.max(0, Math.trunc(input.tokensIn)),
          tokens_out: Math.max(0, Math.trunc(input.tokensOut)),
          // A fixed-6dp STRING, straight into `Decimal(10,6)`. Never a JS
          // number — that is the float round trip this whole design avoids.
          cost_usd: cost.usd,
          latency_ms: input.latencyMs ?? null,
          finish_reason: input.finishReason ? input.finishReason.slice(0, FINISH_REASON_MAX) : null,
        },
      }),
    );
  } catch (err) {
    // Rule 1. Swallowed on purpose — see this module's header.
    log('error', 'ai_usage_write_failed', {
      provider: input.providerName,
      model: input.model,
      feature: input.attribution.feature,
      organizationId: input.attribution.organizationId,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
