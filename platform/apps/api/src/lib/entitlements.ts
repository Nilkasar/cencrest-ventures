/**
 * Entitlement / usage-limit enforcement — the reusable pattern for every
 * plan-limited resource. Epic 2 (Brand Intelligence) is the first caller
 * (`competitors_tracked`); the brief for this epic explicitly calls out
 * that Epic 4/5 (and later, Billing itself) need the identical shape, so
 * this is written once, generically, rather than as a one-off `if` in
 * `routes/competitors.ts`.
 *
 * `docs/16-billing/BILLING_ARCHITECTURE.md` principle #3: "usage limits are
 * stored in `plans.limits` (JSONB), not hard-coded." Epic 16 (Billing) is
 * still PLANNED (see platform/EPICS.md) — there is no `plans` table yet,
 * only `subscriptions.plan` (a plain string). `PLAN_LIMITS` below is the
 * stand-in: ONE exported data map (not scattered `if plan === 'free'`
 * conditionals in route handlers), transcribed from
 * `docs/16-billing/BILLING_ARCHITECTURE.md`'s "Plan Limits" table, so that
 * when Epic 16 ships a real `plans` table, `resolvePlanLimits` below is the
 * only function that needs to change — every call site
 * (`checkUsageLimit`) stays the same.
 */

import { withOrgContext } from '@bebest/database';

// Post-verification fix (Epic 2 QA pass): this list was missing `managed`
// and `enterprise` — docs/16-billing/BILLING_ARCHITECTURE.md's "PLAN TIERS"
// table defines all seven (free/starter/growth/pro/agency/managed/
// enterprise), and the frontend's `Organization["plan"]` union was also
// incomplete (missing `managed`) — both sides are now brought up to the
// full documented list rather than just resolving the one mismatch that
// was reported. See DECISIONS.md §15.
export const PLAN_TIERS = ['free', 'starter', 'growth', 'pro', 'agency', 'managed', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export interface PlanLimits {
  /** `null` means unlimited. */
  competitors_tracked: number | null;
  // Epic 5 (Intent & Query Universe) addition. docs/11-geo/GEO_ENGINE.md's
  // "Query Universe Size" table gives this per-tier, per-generated-set (not
  // a cumulative org-wide total): "Free Snapshot: 20-50 sample queries,
  // Starter: 200, Growth: 500, Pro: 1,400+, Enterprise: Custom (5,000+)."
  // Free is a *range* in the doc; 50 (the upper bound) is used as the cap so
  // a free-tier generate produces the richest sample the tier allows, same
  // as every other tier reading as "up to N," not "as low as N."
  queries_per_query_set: number | null;
}

// Mirrors docs/16-billing/BILLING_ARCHITECTURE.md's "Plan Limits" JSON
// example exactly for the one metric this epic needs. Add a new key here
// (and to `PlanLimits` above) the next time a plan-limited resource ships —
// do NOT duplicate this map or write a parallel one elsewhere.
const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { competitors_tracked: 2, queries_per_query_set: 50 },
  starter: { competitors_tracked: 5, queries_per_query_set: 200 },
  growth: { competitors_tracked: 10, queries_per_query_set: 500 },
  pro: { competitors_tracked: 20, queries_per_query_set: 1400 },
  // "Agency: per-client" per the epic spec — that's a multi-client
  // entitlement model (Epic 18: agency_clients), not a flat cap on the
  // agency org itself, so there is no single number to enforce here yet.
  // `null` (unlimited) is the correct placeholder until Epic 18 defines
  // the per-client shape; it is NOT a claim that agency tracking is
  // actually unbounded in the product. GEO_ENGINE.md's query-universe-size
  // table has no `agency` row either, so `queries_per_query_set` gets the
  // same documented placeholder.
  agency: { competitors_tracked: null, queries_per_query_set: null },
  // `managed` ("Enterprise lite — human + AI service hybrid") and
  // `enterprise` ("Custom SLAs + dedicated support") are both in
  // BILLING_ARCHITECTURE.md's plan list but have no limits example in that
  // doc's JSON (custom-negotiated by definition). `null` (unlimited) here
  // is the same documented placeholder as `agency` above, not a real
  // product claim — Epic 16 replaces this whole map with `plans.limits`.
  // `enterprise.queries_per_query_set` is the one exception: GEO_ENGINE.md
  // explicitly gives it a documented floor ("Custom (5,000+)"), so 5000 is
  // used instead of `null` — a real number, not unlimited, but flagged here
  // as a floor a real Epic 16 `plans` row would override, not a hard cap.
  managed: { competitors_tracked: null, queries_per_query_set: null },
  enterprise: { competitors_tracked: null, queries_per_query_set: 5000 },
};

const DEFAULT_PLAN: PlanTier = 'free';

function isPlanTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * Reads the org's current plan tier + that tier's limits. `subscriptions`
 * has RLS (see @bebest/database rls.sql), so this goes through
 * `withOrgContext`, not the raw `db` client. An org with no `subscriptions`
 * row (never subscribed to anything, or a fresh signup ahead of Epic 16's
 * webhook-driven provisioning) is treated as `free` — fail toward the most
 * restrictive tier, never the most permissive.
 */
export async function resolvePlanLimits(
  organizationId: string,
): Promise<{ plan: PlanTier; limits: PlanLimits }> {
  const subscription = await withOrgContext(organizationId, (tx) =>
    tx.subscriptions.findUnique({ where: { organization_id: organizationId } }),
  );

  const plan = subscription && isPlanTier(subscription.plan) ? subscription.plan : DEFAULT_PLAN;
  return { plan, limits: PLAN_LIMITS[plan] };
}

/**
 * Thrown by `checkUsageLimit` when adding `increment` more of `metric`
 * would push the org over its plan's limit. Carries everything a route
 * handler needs to build a specific, actionable error response (the epic
 * brief: "reject... with a clear, specific error naming the limit and the
 * upgrade path, not a generic 403") — callers should NOT swallow this into
 * a bare 403; see `routes/competitors.ts` for the intended response shape.
 */
export class EntitlementLimitError extends Error {
  constructor(
    public readonly metric: keyof PlanLimits,
    public readonly limit: number,
    public readonly current: number,
    public readonly plan: PlanTier,
    public readonly upgradeTo: PlanTier | null,
  ) {
    super(`${String(metric)} limit (${limit}) reached for the ${plan} plan`);
    this.name = 'EntitlementLimitError';
  }
}

function nextTierUp(plan: PlanTier): PlanTier | null {
  const i = PLAN_TIERS.indexOf(plan);
  if (i < 0 || i >= PLAN_TIERS.length - 1) return null;
  return PLAN_TIERS[i + 1] ?? null;
}

/**
 * The reusable entitlement-check helper. `countCurrent` is supplied by the
 * caller (each resource counts its own current usage differently — e.g.
 * competitors counts non-deleted rows for the org's brand) and MUST itself
 * be scoped correctly (typically via `withOrgContext`); this function does
 * not know how to count anything, only how to compare a count to a limit.
 *
 * Resolves silently (no return value) when within limit. Throws
 * `EntitlementLimitError` — never returns a boolean — so a route handler
 * cannot forget to check a return value; the compiler-visible contract
 * ("do something with this or it propagates as an unhandled rejection") is
 * the whole point of making this its own function rather than an inline if.
 */
export async function checkUsageLimit(
  organizationId: string,
  metric: keyof PlanLimits,
  countCurrent: () => Promise<number>,
  increment = 1,
): Promise<void> {
  const { plan, limits } = await resolvePlanLimits(organizationId);
  const limit = limits[metric];
  if (limit === null) return; // unlimited on this plan

  const current = await countCurrent();
  if (current + increment > limit) {
    throw new EntitlementLimitError(metric, limit, current, plan, nextTierUp(plan));
  }
}
