/**
 * ACTUAL SPEND, read back out of `ai_usage` — the only place real dollars
 * live (`lib/ai-usage/record.ts` is the only writer, `metered-provider.ts`
 * the only caller of that writer).
 *
 * Why this is not `usage_records`: that table is `quantity Int` keyed by the
 * `usage_metric` enum (`prompt_runs | ai_tokens | crawl_pages | users |
 * brands`) — no dollar metric, and an `Int` column cannot hold fractional
 * money. It also has no writer anywhere in `apps/api/src` today, so summing
 * it would return 0 for every org: a spend valve built on it would be open
 * at all times. `ai_usage.cost_usd` is `Decimal(10,6)` and is written on
 * every model call, so it is the only defensible source. See
 * `cost-entitlements.ts` for the enforcement built on top of this.
 *
 * Everything here works in BigInt micro-dollars (the exact unit
 * `Decimal(10,6)` stores, and the same unit `@bebest/ai-provider`'s
 * `pricing.ts` computes in), never `number`: an org with 22,400 calls a
 * month summed through a float accumulator drifts, and a budget check that
 * drifts is a budget check that can be argued with.
 */
import { withOrgContext } from '@bebest/database';
import { formatMicroUsd, parseDecimalToScaled, type MicroUsd } from '@bebest/ai-provider';

/** UTC calendar month, the same boundary convention
 * `lib/ai-visibility/usage.ts` uses for the execution-count cap — the two
 * caps must roll over together or a customer can straddle them. */
export function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Coerces whatever the driver hands back for `SUM(cost_usd)` into exact
 * micro-dollars.
 *
 * Prisma returns a `Decimal` instance for a `Decimal` column, but this is
 * deliberately tolerant of the three other shapes a caller can legitimately
 * see — `null` (no rows at all), a string (raw SQL / `$queryRaw`), and a
 * `number` (a hand-rolled test mock) — because getting this wrong silently
 * under-counts spend, which is the failure mode this whole task exists to
 * remove. A `number` is routed through `toFixed(6)` rather than
 * multiplication so the float never reaches the BigInt.
 */
export function coerceDecimalToMicroUsd(value: unknown): MicroUsd {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;

  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    text = value.toFixed(6);
  } else if (typeof value === 'string') {
    text = value;
  } else if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
    // Prisma's Decimal (decimal.js) — `toFixed(6)` is exact for a
    // Decimal(10,6) value and never produces exponent notation, which
    // `parseDecimalToScaled` would reject.
    text = (value as { toFixed: (dp: number) => string }).toFixed(6);
  } else {
    text = String(value);
  }

  const trimmed = text.trim();
  // A negative sum is not representable by any legitimate `ai_usage` row
  // (cost is never negative) — treated as zero rather than throwing, since
  // this runs on the refusal path and must not 500 a customer's run.
  if (trimmed.startsWith('-')) return 0n;
  try {
    return parseDecimalToScaled(trimmed, 6);
  } catch {
    return 0n;
  }
}

/**
 * Month-to-date vendor AI spend for one org, in micro-dollars.
 *
 * Goes through `withOrgContext` — `ai_usage` has RLS keyed on
 * `app.current_org`, so this can only ever see the org it was asked about;
 * there is no code path by which org A's budget check reads org B's spend.
 * Errors PROPAGATE: a budget check that silently returns 0 when the database
 * is unreachable is a valve that opens under load, which is precisely when
 * it matters.
 */
export async function sumOrgAiSpendThisMonth(organizationId: string, now: Date = new Date()): Promise<MicroUsd> {
  const result = await withOrgContext(organizationId, (tx) =>
    tx.ai_usage.aggregate({
      where: { organization_id: organizationId, recorded_at: { gte: startOfCurrentMonthUtc(now) } },
      _sum: { cost_usd: true },
    }),
  );
  return coerceDecimalToMicroUsd(result?._sum?.cost_usd ?? null);
}

/** Convenience for surfaces that show a customer their spend (the
 * subscription usage summary) — a fixed-6dp string, never a float. */
export function formatSpendUsd(micros: MicroUsd): string {
  return formatMicroUsd(micros);
}
