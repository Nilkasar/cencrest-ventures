/**
 * Epic 16 (Billing) — seeds the 7-tier plan catalog (`./billing/plan-catalog.js`'s
 * `PLAN_CATALOG`) into the real `plans` table.
 *
 * NOT RUN as part of this build — this build makes no database connections
 * at all (see `platform/docs/epics/16-billing-backend.md`'s "What's not
 * done" section). Run this once, manually, against a real database before
 * serving billing routes in an environment where `plans` is empty:
 *
 *   pnpm --filter @bebest/api run seed:plans
 *
 * Upserts by `slug` — idempotent and safe to re-run any time `PLAN_CATALOG`
 * changes (e.g. a new documented limit key). Never deletes a plan row that
 * has since been removed from `PLAN_CATALOG` — an active `subscriptions.plan_id`
 * could still reference it; removing a tier is a deliberate, separate
 * operation (mark it `active: false`), not a side effect of re-running this
 * script.
 */
import { db, type Prisma } from '@bebest/database';
import { PLAN_TIERS, PLAN_CATALOG } from '../lib/billing/plan-catalog.js';

async function main(): Promise<void> {
  for (const slug of PLAN_TIERS) {
    const entry = PLAN_CATALOG[slug];
    await db.plans.upsert({
      where: { slug: entry.slug },
      create: {
        slug: entry.slug,
        name: entry.name,
        description: entry.description,
        price_monthly: entry.priceMonthlyCents,
        price_yearly: entry.priceYearlyCents,
        limits: entry.limits as unknown as Prisma.InputJsonValue,
        features: entry.features as unknown as Prisma.InputJsonValue,
        active: true,
      },
      update: {
        name: entry.name,
        description: entry.description,
        price_monthly: entry.priceMonthlyCents,
        price_yearly: entry.priceYearlyCents,
        limits: entry.limits as unknown as Prisma.InputJsonValue,
        features: entry.features as unknown as Prisma.InputJsonValue,
      },
    });
    // eslint-disable-next-line no-console -- CLI seed script, not app code
    console.log(`seeded plan: ${slug}`);
  }
  // eslint-disable-next-line no-console -- CLI seed script, not app code
  console.log(`done — ${PLAN_TIERS.length} plans seeded.`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
