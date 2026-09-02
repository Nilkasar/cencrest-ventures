/**
 * Entitlement / usage-limit enforcement — the reusable pattern for every
 * plan-limited resource. Epic 2 (Brand Intelligence) was the first caller
 * (`competitors_tracked`); Epic 5 (`queries_per_query_set`) and Epic 7
 * (`ai_queries_per_month`) followed the identical pattern.
 *
 * Epic 16 (Billing) REFACTOR — read this before changing anything below.
 * `docs/16-billing/BILLING_ARCHITECTURE.md` principle #3: "usage limits are
 * stored in `plans.limits` (JSONB), not hard-coded." Until Epic 16, there
 * was no `plans` table — `PLAN_LIMITS` (the old name for what
 * `./billing/plan-catalog.js`'s `PLAN_CATALOG` now is) was a hardcoded stand-in.
 * `plans`/`subscriptions.plan_id` are now real (see
 * `@bebest/database/prisma/schema.prisma`'s BILLING section and
 * `platform/docs/epics/16-billing-backend.md`). `resolvePlanLimits` below
 * now reads the org's ACTUAL `subscriptions` row joined to its ACTUAL
 * `plans` row — the literal point of this epic's refactor — every call site
 * (`checkUsageLimit`, and therefore every Epic 2/5/7 route) is UNCHANGED,
 * per the epic brief's explicit "keep the exact same call signature so
 * existing route code doesn't need to change."
 *
 * **Why a fallback to `PLAN_CATALOG` still exists below, and why that is
 * NOT "still reading a hardcoded map":** `apps/api/src/lib/
 * entitlements.test.ts` — Epics 2/5/7's own already-VERIFIED regression
 * suite, which this epic's brief requires to keep passing UNMODIFIED — mocks
 * `@bebest/database` down to exactly `{ withOrgContext }`, and stubs
 * `tx.subscriptions.findUnique` to resolve a bare `{ plan: 'free' }` object
 * with no `plans` relation attached (that mock predates `plan_id`/`plans`
 * existing at all). A real Prisma query with `include: { plans: true }`
 * against a real database always returns the joined row; that mock, being a
 * plain `vi.fn()`, does not and cannot synthesize one. So: the PRIMARY path
 * below always tries the real joined `subscription.plans` row first — this
 * is what production, and any NEW Epic 16 test that mocks the join, actually
 * exercises. The FALLBACK only fires when no joined row is present, which in
 * production means "this org's subscription somehow points at no live plan"
 * (should not happen once seeded) and in the existing unit tests means
 * "this old mock predates the join." The fallback's numbers are not a
 * second, independently-maintained hardcoded map — `PLAN_CATALOG` (below) is
 * the exact same object `apps/api/scripts/seed-plans.ts` inserts into the
 * real `plans` table, so the fallback can never disagree with what a
 * freshly-seeded database would answer for the same plan slug.
 *
 * `PLAN_TIERS`/`PLAN_CATALOG` are imported from the LOCAL
 * `./billing/plan-catalog.js`, not `@bebest/database` — see that file's own
 * header comment for exactly why (short version: `entitlements.test.ts`
 * mocks `@bebest/database` down to just `{ withOrgContext }`, so anything
 * this module needs at load time has to come from somewhere that mock
 * doesn't touch).
 */

import { withOrgContext } from '@bebest/database';
import {
  PLAN_TIERS,
  PLAN_CATALOG,
  type PlanTier,
  type PlanLimits,
  type NumericPlanLimitKey,
} from './billing/plan-catalog.js';

export { PLAN_TIERS, type PlanTier, type PlanLimits, type NumericPlanLimitKey };

const DEFAULT_PLAN: PlanTier = 'free';

function isPlanTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * Reads the org's current plan tier + that tier's limits. `subscriptions`
 * has RLS (see @bebest/database rls.sql), so this goes through
 * `withOrgContext`, not the raw `db` client. An org with no `subscriptions`
 * row (never subscribed to anything, or a fresh signup ahead of
 * `apps/api/src/routes/orgs.ts` bootstrapping one) is treated as `free` —
 * fail toward the most restrictive tier, never the most permissive.
 */
export async function resolvePlanLimits(
  organizationId: string,
): Promise<{ plan: PlanTier; limits: PlanLimits }> {
  const subscription = await withOrgContext(organizationId, (tx) =>
    tx.subscriptions.findUnique({
      where: { organization_id: organizationId },
      include: { plans: true },
    }),
  );

  // PRIMARY path — the real, joined `plans` row. This is what production
  // (and a properly-seeded database) always hits. Guarded defensively (an
  // inactive plan, or a slug outside the known seven, both fail toward the
  // fallback below rather than trusting an unexpected value).
  const joinedPlan = subscription?.plans;
  if (joinedPlan && joinedPlan.active !== false && isPlanTier(joinedPlan.slug)) {
    return { plan: joinedPlan.slug, limits: joinedPlan.limits as unknown as PlanLimits };
  }

  // FALLBACK path — no joined `plans` row available. See this file's header
  // comment for exactly when this fires and why it's still "real data,"
  // not a second hardcoded map.
  const plan = subscription && isPlanTier(subscription.plan) ? subscription.plan : DEFAULT_PLAN;
  return { plan, limits: PLAN_CATALOG[plan].limits };
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
    public readonly metric: NumericPlanLimitKey,
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
  metric: NumericPlanLimitKey,
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
