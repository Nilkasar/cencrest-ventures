import { Hono } from 'hono';
import { z } from 'zod';
import type { MiddlewareHandler } from 'hono';
import { db, withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import { getBrandForOrg } from '../lib/brand-context.js';
import { resolvePlanLimits } from '../lib/entitlements.js';
import { countAiQueriesThisMonth } from '../lib/ai-visibility/usage.js';
import { PLAN_TIERS, type PlanTier } from '../lib/billing/plan-catalog.js';
import { getPaymentProvider } from '../lib/billing/payment-provider.js';
import {
  getOrCreateSubscription,
  getPlanBySlug,
  setSubscriptionPlan,
  serializeSubscription,
} from '../lib/billing/subscription-store.js';
import type { AppEnv } from '../types/context.js';

const subscriptionRoute = new Hono<AppEnv>();

// docs/08-security/SECURITY.md's permission matrix already has
// `manage_billing: ['owner']` (lib/rbac.ts) — reused exactly, not
// duplicated, per the epic brief.
const MANAGE_BILLING = 'manage_billing' as const;
const ENTITY_TYPE = 'subscription';

// `subscriptions` is 1:1 with an org and has no `:id` route param for
// `auditLog`'s default `getEntityId` to read — the organization id is the
// only stable, meaningful id to log here (same situation
// `routes/orgs.ts`'s org-level mutations are in).
function getEntityId(c: Parameters<MiddlewareHandler<AppEnv>>[0]): string {
  try {
    return c.get('org')?.organizationId ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Real usage counted against the CURRENT plan's limits for every metric a
 * prior epic already established real counting logic for. The remaining
 * documented-but-not-yet-enforced keys (`pages_analyzed`, `snapshots_per_month`,
 * `agent_runs_per_month`, `autonomy_level_max`, `client_accounts`) report
 * `used: null` — honestly "not tracked yet" (no agent/snapshot/autonomy
 * feature exists to count), never a fabricated zero. */
async function buildUsageSummary(organizationId: string) {
  const { limits } = await resolvePlanLimits(organizationId);
  const brand = await getBrandForOrg(organizationId);

  const [competitorsUsed, activeQuerySet, aiQueriesUsed, teamMembersUsed] = await Promise.all([
    brand
      ? withOrgContext(organizationId, (tx) =>
          tx.competitors.count({ where: { organization_id: organizationId, brand_id: brand.id, deleted_at: null } }),
        )
      : Promise.resolve(0),
    brand
      ? withOrgContext(organizationId, (tx) =>
          tx.query_sets.findFirst({
            where: { organization_id: organizationId, brand_id: brand.id, status: 'active', deleted_at: null },
            select: { query_count: true },
          }),
        )
      : Promise.resolve(null),
    countAiQueriesThisMonth(organizationId),
    withOrgContext(organizationId, (tx) => tx.memberships.count({ where: { organization_id: organizationId } })),
  ]);

  return {
    competitors_tracked: { used: competitorsUsed, limit: limits.competitors_tracked },
    queries_per_query_set: { used: activeQuerySet?.query_count ?? null, limit: limits.queries_per_query_set },
    ai_queries_per_month: { used: aiQueriesUsed, limit: limits.ai_queries_per_month },
    team_members: { used: teamMembersUsed, limit: limits.team_members },
    // Not tracked by any prior epic yet — see this function's doc comment.
    pages_analyzed: { used: null, limit: limits.pages_analyzed },
    snapshots_per_month: { used: null, limit: limits.snapshots_per_month },
    agent_runs_per_month: { used: null, limit: limits.agent_runs_per_month },
    autonomy_level_max: { used: null, limit: limits.autonomy_level_max },
    client_accounts: { used: null, limit: limits.client_accounts },
  };
}

// ── GET /api/orgs/me/subscription — any member (viewer+) can view the
// org's own plan/usage; only mutating it is owner-only (epic spec). ────────
subscriptionRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  const subscription = await getOrCreateSubscription(org.organizationId);
  const usage = await buildUsageSummary(org.organizationId);

  return c.json({ ...serializeSubscription(subscription), usage });
});

// ── GET /api/orgs/me/subscription/invoices — same read-only permission
// level as GET / (viewer+, not owner-only — viewing billing history isn't a
// mutation). Fake data from `NullPaymentProvider.getInvoices` until a real
// `PaymentProvider` is wired (epic spec's UI surface, verbatim). An org that
// never went through upgrade/downgrade has no `external_customer_id` yet —
// same as a real Stripe customer that was never created — so it gets an
// honest empty list, not a fabricated invoice. ─────────────────────────────
subscriptionRoute.get('/invoices', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  const current = await getOrCreateSubscription(org.organizationId);
  if (!current.external_customer_id) return c.json({ invoices: [] });

  const provider = getPaymentProvider();
  const invoices = await provider.getInvoices(current.external_customer_id);
  return c.json({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      amountCents: inv.amountCents,
      currency: inv.currency,
      status: inv.status,
      createdAt: inv.createdAt,
    })),
  });
});

const planSlugSchema = z.object({ planSlug: z.enum(PLAN_TIERS) });

function tierIndex(slug: PlanTier): number {
  return PLAN_TIERS.indexOf(slug);
}

/** Shared upgrade/downgrade body: validates the target plan, resolves (or
 * bootstraps) the current subscription, calls the `PaymentProvider`, and
 * persists the new plan via `setSubscriptionPlan` — the one function that
 * ever calls `.update()` on a subscription. */
async function changePlan(
  organizationId: string,
  ownerEmail: string,
  ownerName: string,
  targetSlug: PlanTier,
) {
  const current = await getOrCreateSubscription(organizationId);
  const provider = getPaymentProvider();
  const targetPlan = await getPlanBySlug(targetSlug);
  if (!targetPlan || !targetPlan.active) {
    return { error: 'plan_not_found' as const };
  }

  let externalCustomerId = current.external_customer_id;
  if (!externalCustomerId) {
    const customer = await provider.createCustomer(ownerEmail, ownerName);
    externalCustomerId = customer.id;
  }

  let externalSubscription;
  if (current.external_id) {
    externalSubscription = await provider.upgradeSubscription(current.external_id, targetPlan.id);
  } else {
    externalSubscription = await provider.createSubscription(externalCustomerId, targetPlan.id);
  }

  const updated = await setSubscriptionPlan(organizationId, current.id, targetSlug, {
    status: 'active',
    cancelled_at: null,
    external_customer_id: externalCustomerId,
    external_id: externalSubscription.id,
    current_period_start: externalSubscription.currentPeriodStart,
    current_period_end: externalSubscription.currentPeriodEnd,
  });

  return { subscription: updated };
}

// ── POST /api/orgs/me/subscription/upgrade — owner-only, audit-logged
// (epic spec's API surface). ────────────────────────────────────────────
subscriptionRoute.post(
  '/upgrade',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  requirePermission(MANAGE_BILLING),
  auditLog({ action: 'billing.changed', entityType: ENTITY_TYPE, getEntityId }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = planSlugSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const current = await getOrCreateSubscription(org.organizationId);

    if (tierIndex(parsed.data.planSlug) <= tierIndex(current.plans.slug as PlanTier)) {
      return c.json(
        {
          error: 'not_an_upgrade',
          message: `${parsed.data.planSlug} is not higher than your current plan (${current.plans.slug}). Use /downgrade instead.`,
        },
        422,
      );
    }

    const result = await changePlan(org.organizationId, user.email, user.name, parsed.data.planSlug);
    if ('error' in result) return c.json(result, 404);

    return c.json(serializeSubscription(result.subscription));
  },
);

// ── POST /api/orgs/me/subscription/downgrade — owner-only, audit-logged. ──
subscriptionRoute.post(
  '/downgrade',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  requirePermission(MANAGE_BILLING),
  auditLog({ action: 'billing.changed', entityType: ENTITY_TYPE, getEntityId }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = planSlugSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const current = await getOrCreateSubscription(org.organizationId);

    if (tierIndex(parsed.data.planSlug) >= tierIndex(current.plans.slug as PlanTier)) {
      return c.json(
        {
          error: 'not_a_downgrade',
          message: `${parsed.data.planSlug} is not lower than your current plan (${current.plans.slug}). Use /upgrade instead.`,
        },
        422,
      );
    }

    const result = await changePlan(org.organizationId, user.email, user.name, parsed.data.planSlug);
    if ('error' in result) return c.json(result, 404);

    return c.json(serializeSubscription(result.subscription));
  },
);

// ── POST /api/orgs/me/subscription/cancel — owner-only, audit-logged.
// NON-NEGOTIABLE: never hard-delete. This handler contains no `.delete()`
// call on any table — cancellation is a plan change to `free` + an
// `organizations.status` flip, both plain `.update()`s. ────────────────────
subscriptionRoute.post(
  '/cancel',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  requirePermission(MANAGE_BILLING),
  auditLog({ action: 'billing.changed', entityType: ENTITY_TYPE, getEntityId }),
  async (c) => {
    const org = c.get('org');
    const current = await getOrCreateSubscription(org.organizationId);
    const provider = getPaymentProvider();

    if (current.external_id) {
      await provider.cancelSubscription(current.external_id);
    }

    const now = new Date();
    const updated = await setSubscriptionPlan(org.organizationId, current.id, 'free', {
      status: 'canceled',
      cancelled_at: now,
    });

    // organizations has no RLS (see @bebest/database DECISIONS.md §1) —
    // plain `db`, matching how routes/orgs.ts's soft-delete already updates
    // organizations directly. `.update()`, never `.delete()`.
    await db.organizations.update({ where: { id: org.organizationId }, data: { status: 'cancelled' } });

    return c.json({ ...serializeSubscription(updated), cancelledAt: now });
  },
);

export default subscriptionRoute;
