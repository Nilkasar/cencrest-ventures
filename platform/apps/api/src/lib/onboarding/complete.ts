/**
 * Epic 22 (Workspace Views) Phase 2 — onboarding completion, on the server.
 *
 * Before this, "onboarding complete" was a localStorage flag in the browser
 * (apps/web/src/lib/onboarding-client.ts `writeCompletedAt`): a second
 * device saw the wizard again, and nothing started the first crawl or the
 * first query set. `POST /api/brands/me/onboarding/complete` now:
 *
 *   1. Re-checks the wizard's own minimums server-side — the same rules
 *      `deriveCompletedSteps` applies client-side, so the API cannot be
 *      talked into "complete" with less than the UI requires:
 *        brand-basics  a brand with a non-blank name
 *        competitors   at least 1 live competitor (the step blocks Continue
 *                      at zero)
 *        industry      at least 1 industry
 *        use-cases     at least 3 live use cases (MIN_USE_CASES)
 *        claims        optional — no server rule
 *   2. Claims completion with a conditional UPDATE
 *      (`onboarding_completed_at IS NULL`). Exactly one caller can win that,
 *      however many requests race (a double-clicked "Done", two devices).
 *   3. Only the winner kicks off the first crawl (lib/crawler/start-crawl.ts,
 *      the same function `POST /brands/me/crawl` uses) and the first active
 *      query set (lib/agents/ensure-query-universe.ts → lib/query-sets/
 *      generate.ts, the same functions the agents and the query-set routes
 *      use). Every later call is a no-op that reports what exists — so
 *      calling twice never creates a second crawl or query set.
 *   4. If a kickoff THROWS, the claim is released (completed_at reset) and
 *      the error propagates (500): a retry then redoes the whole step
 *      instead of leaving "complete" with nothing started. A kickoff that is
 *      deliberately SKIPPED (no website, a crawl already exists, an active
 *      query set already exists) is not an error.
 */
import { withOrgContext, type brands } from '@bebest/database';
import { getBrandForOrg } from '../brand-context.js';
import { startCrawlForBrand } from '../crawler/start-crawl.js';
import { ensureActiveQuerySet } from '../agents/ensure-query-universe.js';

export const MIN_COMPETITORS = 1;
export const MIN_INDUSTRIES = 1;
export const MIN_USE_CASES = 3;

export type OnboardingStepKey = 'brand-basics' | 'competitors' | 'industry' | 'use-cases';

export type CrawlKickoff =
  | { status: 'started'; jobId: string }
  | {
      status: 'skipped';
      jobId?: string;
      reason: 'no_website_url' | 'crawl_already_in_progress' | 'already_crawled' | 'onboarding_already_completed';
    };

export type QuerySetKickoff =
  | { status: 'created'; id: string }
  | {
      status: 'skipped';
      id?: string;
      reason: 'active_query_set_exists' | 'onboarding_already_completed';
    };

export type CompleteOnboardingResult =
  | { error: 'no_brand' }
  | { error: 'incomplete'; missing: OnboardingStepKey[] }
  | {
      completedAt: Date;
      alreadyCompleted: boolean;
      brandId: string;
      crawl: CrawlKickoff;
      querySet: QuerySetKickoff;
    };

export async function completeOnboarding(params: {
  organizationId: string;
  userId: string;
}): Promise<CompleteOnboardingResult> {
  const { organizationId, userId } = params;
  const brand = await getBrandForOrg(organizationId);
  if (!brand) return { error: 'no_brand' };

  if (brand.onboarding_completed_at) {
    return alreadyCompleted(organizationId, brand, brand.onboarding_completed_at);
  }

  const [competitorCount, useCaseCount] = await withOrgContext(organizationId, (tx) =>
    Promise.all([
      tx.competitors.count({ where: { organization_id: organizationId, brand_id: brand.id, deleted_at: null } }),
      tx.use_cases.count({ where: { organization_id: organizationId, brand_id: brand.id, deleted_at: null } }),
    ]),
  );

  const missing: OnboardingStepKey[] = [];
  if (brand.name.trim() === '') missing.push('brand-basics');
  if (competitorCount < MIN_COMPETITORS) missing.push('competitors');
  if (brand.industries.length < MIN_INDUSTRIES) missing.push('industry');
  if (useCaseCount < MIN_USE_CASES) missing.push('use-cases');
  if (missing.length > 0) return { error: 'incomplete', missing };

  const completedAt = new Date();
  const claimed = await withOrgContext(organizationId, (tx) =>
    tx.brands.updateMany({
      where: { id: brand.id, organization_id: organizationId, onboarding_completed_at: null },
      data: { onboarding_completed_at: completedAt },
    }),
  );
  if (claimed.count === 0) {
    // Another request completed it between our read and our update.
    const current = await getBrandForOrg(organizationId);
    return alreadyCompleted(organizationId, brand, current?.onboarding_completed_at ?? completedAt);
  }

  try {
    const crawl = await kickoffFirstCrawl(organizationId, brand, userId);
    const querySet = await kickoffFirstQuerySet(organizationId, brand.id, userId);
    return { completedAt, alreadyCompleted: false, brandId: brand.id, crawl, querySet };
  } catch (err) {
    await withOrgContext(organizationId, (tx) =>
      tx.brands.updateMany({
        where: { id: brand.id, organization_id: organizationId, onboarding_completed_at: completedAt },
        data: { onboarding_completed_at: null },
      }),
    ).catch(() => {
      // Best effort — the original error is the one worth surfacing.
    });
    throw err;
  }
}

async function kickoffFirstCrawl(
  organizationId: string,
  brand: brands,
  userId: string,
): Promise<CrawlKickoff> {
  if (!brand.website_url) return { status: 'skipped', reason: 'no_website_url' };

  // "First crawl": a brand that has already been crawled (e.g. from Website
  // Intelligence before finishing the wizard) is not crawled again.
  const previous = await withOrgContext(organizationId, (tx) =>
    tx.crawl_jobs.findFirst({
      where: { organization_id: organizationId, brand_id: brand.id, status: { notIn: ['queued', 'running'] } },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    }),
  );
  if (previous) return { status: 'skipped', reason: 'already_crawled', jobId: previous.id };

  const result = await startCrawlForBrand({ organizationId, brand, userId });
  if (result.status === 'started') return { status: 'started', jobId: result.job.id };
  if (result.reason === 'crawl_already_in_progress') {
    return { status: 'skipped', reason: 'crawl_already_in_progress', jobId: result.job.id };
  }
  return { status: 'skipped', reason: result.reason };
}

async function kickoffFirstQuerySet(organizationId: string, brandId: string, userId: string): Promise<QuerySetKickoff> {
  const result = await ensureActiveQuerySet(organizationId, brandId, userId);
  if ('error' in result) {
    // `no_brand` (deleted between our read and now) or `no_human_trigger`
    // (impossible — userId is always set here). Neither is a skip.
    throw new Error(`Could not create the first query set: ${result.error}`);
  }
  return result.created
    ? { status: 'created', id: result.querySet.id }
    : { status: 'skipped', reason: 'active_query_set_exists', id: result.querySet.id };
}

/** A repeat call: nothing is started; report what exists. */
async function alreadyCompleted(organizationId: string, brand: brands, completedAt: Date): Promise<CompleteOnboardingResult> {
  const [latestCrawl, activeSet] = await withOrgContext(organizationId, (tx) =>
    Promise.all([
      tx.crawl_jobs.findFirst({
        where: { organization_id: organizationId, brand_id: brand.id },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      }),
      tx.query_sets.findFirst({
        where: { organization_id: organizationId, brand_id: brand.id, status: 'active', deleted_at: null },
        select: { id: true },
      }),
    ]),
  );
  return {
    completedAt,
    alreadyCompleted: true,
    brandId: brand.id,
    crawl: { status: 'skipped', reason: 'onboarding_already_completed', ...(latestCrawl ? { jobId: latestCrawl.id } : {}) },
    querySet: { status: 'skipped', reason: 'onboarding_already_completed', ...(activeSet ? { id: activeSet.id } : {}) },
  };
}
