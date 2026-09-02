import { Hono } from 'hono';
import { getActivePlans } from '../lib/billing/subscription-store.js';
import { PLAN_CATALOG, PLAN_TIERS } from '../lib/billing/plan-catalog.js';
import type { AppEnv } from '../types/context.js';

const plansRoute = new Hono<AppEnv>();

function serializePlanRow(row: { slug: string; name: string; description: string | null; price_monthly: number | null; price_yearly: number | null; limits: unknown; features: unknown }) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceMonthlyCents: row.price_monthly,
    priceYearlyCents: row.price_yearly,
    limits: row.limits,
    features: row.features,
  };
}

// ── GET /api/plans — public (no auth): lists active plans for a
// pricing/upgrade UI (epic spec's API surface, verbatim). ──────────────────
plansRoute.get('/', async (c) => {
  const rows = await getActivePlans();

  // Defensive fallback: an environment where apps/api/scripts/seed-plans.ts
  // has not yet been run against the database has an empty `plans` table.
  // Rather than return `[]` to a pricing page, fall back to the exact same
  // PLAN_CATALOG data the seed script would have inserted — never a
  // DIFFERENT set of numbers, just the same ones a fresh seed would produce.
  if (rows.length === 0) {
    return c.json(
      PLAN_TIERS.map((slug) => {
        const entry = PLAN_CATALOG[slug];
        return {
          slug: entry.slug,
          name: entry.name,
          description: entry.description,
          priceMonthlyCents: entry.priceMonthlyCents,
          priceYearlyCents: entry.priceYearlyCents,
          limits: entry.limits,
          features: entry.features,
        };
      }),
    );
  }

  return c.json(rows.map(serializePlanRow));
});

export default plansRoute;
