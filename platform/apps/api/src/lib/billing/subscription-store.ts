/**
 * Epic 16 (Billing) — the one place that reads/writes a `subscriptions` row
 * and its joined `plans` row. `routes/subscription.ts` (upgrade/downgrade/
 * cancel/GET) and `routes/billing-webhooks.ts` both go through this module
 * rather than querying `tx.subscriptions`/`db.plans` directly, so there is
 * exactly one code path that ever calls `.update()` on a subscription — and,
 * per the epic's non-negotiable, NOT ONE `.delete()` call anywhere in it.
 */

import { db, withOrgContext, type plans, type subscriptions } from '@bebest/database';
import { PLAN_TIERS, type PlanTier } from './plan-catalog.js';

const DEFAULT_PLAN: PlanTier = 'free';

function isPlanTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

/** `plans` is global reference data with no RLS (see `prisma/schema.prisma`'s
 * doc comment on the model) — plain `db`, not `withOrgContext`, is correct
 * here, matching how every other "platform reference data" table in this
 * codebase is read. */
export async function getPlanBySlug(slug: PlanTier): Promise<plans | null> {
  return db.plans.findUnique({ where: { slug } });
}

export async function getActivePlans(): Promise<plans[]> {
  const rows = await db.plans.findMany({ where: { active: true } });
  return rows.sort((a, b) => PLAN_TIERS.indexOf(a.slug as PlanTier) - PLAN_TIERS.indexOf(b.slug as PlanTier));
}

export type SubscriptionWithPlan = subscriptions & { plans: plans };

/**
 * Loads the org's subscription (joined to its plan). If none exists yet
 * (a fresh org that never called upgrade — `routes/orgs.ts`'s create-org
 * flow does not itself create one, per the epic's own "keep existing route
 * code unchanged" constraint), bootstraps one pointed at the seeded `free`
 * plan. Never returns `null` — every org has a real subscription row after
 * calling this once.
 */
export async function getOrCreateSubscription(organizationId: string): Promise<SubscriptionWithPlan> {
  const existing = await withOrgContext(organizationId, (tx) =>
    tx.subscriptions.findUnique({ where: { organization_id: organizationId }, include: { plans: true } }),
  );
  if (existing) return existing;

  const freePlan = await getPlanBySlug(DEFAULT_PLAN);
  if (!freePlan) {
    throw new Error(
      "No 'free' plan row exists — run apps/api/scripts/seed-plans.ts against the database before serving billing routes.",
    );
  }

  const created = await withOrgContext(organizationId, (tx) =>
    tx.subscriptions.create({
      data: {
        organization_id: organizationId,
        plan_id: freePlan.id,
        plan: freePlan.slug,
        status: 'active',
      },
    }),
  );
  return { ...created, plans: freePlan };
}

/**
 * The ONLY function that changes which plan an org's subscription points
 * at. Keeps `plan_id` (the real FK) and `plan` (the denormalized cache
 * `entitlements.ts`'s fallback path reads — see that file's header comment)
 * in sync on every call, by construction, so they can never independently
 * drift. `overrides` carries whatever else this particular transition also
 * needs to set (status, cancelled_at, external ids, period dates) — a plain
 * `.update()`, never `.delete()`.
 */
export async function setSubscriptionPlan(
  organizationId: string,
  subscriptionId: string,
  planSlug: PlanTier,
  overrides: Partial<{
    status: subscriptions['status'];
    cancelled_at: Date | null;
    trial_ends_at: Date | null;
    current_period_start: Date | null;
    current_period_end: Date | null;
    external_customer_id: string | null;
    external_id: string | null;
  }> = {},
): Promise<SubscriptionWithPlan> {
  if (!isPlanTier(planSlug)) throw new Error(`Unknown plan slug: ${planSlug}`);
  const plan = await getPlanBySlug(planSlug);
  if (!plan) throw new Error(`No '${planSlug}' plan row exists in the plans table.`);

  const updated = await withOrgContext(organizationId, (tx) =>
    tx.subscriptions.update({
      where: { id: subscriptionId },
      data: { plan_id: plan.id, plan: plan.slug, updated_at: new Date(), ...overrides },
    }),
  );
  return { ...updated, plans: plan };
}

/** Finds the subscription a webhook's external customer/subscription id
 * refers to. Plain `db`, not `withOrgContext`: a webhook knows only the
 * external id, not yet which org's tenant context to set — the exact
 * `invitations`-shaped situation `prisma/migrations/0009_billing/rls.sql`'s
 * header documents. Once this resolves an `organization_id`, every
 * subsequent read/write for that event goes back through `withOrgContext`
 * (see `getOrCreateSubscription`/`setSubscriptionPlan` above). */
export async function findSubscriptionByExternalCustomerId(
  externalCustomerId: string,
): Promise<SubscriptionWithPlan | null> {
  return db.subscriptions.findFirst({
    where: { external_customer_id: externalCustomerId },
    include: { plans: true },
  });
}

export function serializeSubscription(sub: SubscriptionWithPlan) {
  return {
    plan: {
      slug: sub.plans.slug,
      name: sub.plans.name,
      description: sub.plans.description,
      priceMonthlyCents: sub.plans.price_monthly,
      priceYearlyCents: sub.plans.price_yearly,
      limits: sub.plans.limits,
      features: sub.plans.features,
    },
    subscription: {
      status: sub.status,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      trialEndsAt: sub.trial_ends_at,
      cancelledAt: sub.cancelled_at,
    },
  };
}
