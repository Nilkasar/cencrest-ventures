/**
 * Epic 5 (Intent & Query Universe) — the `POST /generate` +
 * `PATCH /:id/activate` write logic, extracted out of `routes/query-sets.ts`
 * into reusable functions (behavior UNCHANGED — a pure code move, not a
 * rewrite) so Epic 12's GEO/Growth agents can call the exact same,
 * already-tested engine logic (`generateCandidateQueries` capped by the
 * org's real `queries_per_query_set` entitlement, then activated) instead of
 * re-implementing any part of it — this epic's own "thin orchestrator...
 * do not reimplement any of their logic" requirement. `routes/query-sets.ts`
 * now calls these same two functions; nothing about its HTTP contract
 * (status codes, response shape, audit events) changed.
 */
import { withOrgContext, type query_sets, type queries } from '@bebest/database';
import { getBrandForOrg, NO_BRAND_ERROR } from '../brand-context.js';
import { resolvePlanLimits } from '../entitlements.js';
import { generateCandidateQueries, type QueryGeneratorBrandProfile } from '../query-generator.js';

export interface GenerateQuerySetInput {
  name?: string;
  description?: string | null;
}

export type GenerateQuerySetResult =
  | { error: 'no_brand' }
  | { querySet: query_sets; queries: queries[] };

export async function generateQuerySetForBrand(
  organizationId: string,
  userId: string,
  input: GenerateQuerySetInput = {},
): Promise<GenerateQuerySetResult> {
  const brand = await getBrandForOrg(organizationId);
  if (!brand) return { error: 'no_brand' };

  const [useCases, competitors, { plan, limits }] = await Promise.all([
    withOrgContext(organizationId, (tx) =>
      tx.use_cases.findMany({ where: { organization_id: organizationId, brand_id: brand.id, deleted_at: null } }),
    ),
    withOrgContext(organizationId, (tx) =>
      tx.competitors.findMany({ where: { organization_id: organizationId, brand_id: brand.id, deleted_at: null } }),
    ),
    resolvePlanLimits(organizationId),
  ]);

  const profile: QueryGeneratorBrandProfile = {
    name: brand.name,
    categories: brand.categories,
    differentiators: brand.differentiators,
    markets: brand.markets,
    useCases: useCases.map((uc) => ({
      title: uc.title,
      industries: uc.industries,
      companySizes: uc.company_sizes,
      painPoints: uc.pain_points,
      solutions: uc.solutions,
    })),
    competitors: competitors.map((comp) => ({ name: comp.name })),
  };

  const allCandidates = generateCandidateQueries(profile);
  const generated =
    limits.queries_per_query_set === null ? allCandidates : allCandidates.slice(0, limits.queries_per_query_set);
  const planLimit = limits.queries_per_query_set ?? allCandidates.length;

  const created = await withOrgContext(organizationId, (tx) =>
    tx.query_sets.create({
      data: {
        organization_id: organizationId,
        brand_id: brand.id,
        name: input.name ?? `${brand.name} Query Universe`,
        description: input.description ?? null,
        query_count: generated.length,
        version: 1,
        status: 'draft',
        plan_tier: plan,
        plan_limit: planLimit,
        potential_count: allCandidates.length,
        created_by: userId,
        queries: {
          create: generated.map((q) => ({
            organization_id: organizationId,
            text: q.text,
            intent_type: q.intentType,
            category: q.category,
            tags: q.tags,
            priority: q.priority,
            source: 'generated',
            created_by: userId,
          })),
        },
      },
    }),
  );

  const rows = await withOrgContext(organizationId, (tx) =>
    tx.queries.findMany({ where: { query_set_id: created.id, deleted_at: null }, orderBy: { created_at: 'asc' } }),
  );

  return { querySet: created, queries: rows };
}

export type ActivateQuerySetResult =
  | { error: 'not_found' }
  | { error: 'not_draft'; current: query_sets }
  | { querySet: query_sets };

/** Same "archive whichever other query_set was active, activate this one,
 * both in one transaction" logic `routes/query-sets.ts`'s `PATCH
 * /:id/activate` already had — moved here verbatim. */
export async function activateQuerySetRow(
  organizationId: string,
  querySetId: string,
  userId: string,
): Promise<ActivateQuerySetResult> {
  const querySet = await withOrgContext(organizationId, (tx) =>
    tx.query_sets.findFirst({ where: { id: querySetId, organization_id: organizationId, deleted_at: null } }),
  );
  if (!querySet) return { error: 'not_found' };
  if (querySet.status !== 'draft') return { error: 'not_draft', current: querySet };

  const now = new Date();
  const updated = await withOrgContext(organizationId, async (tx) => {
    await tx.query_sets.updateMany({
      where: {
        organization_id: organizationId,
        brand_id: querySet.brand_id,
        status: 'active',
        id: { not: querySet.id },
        deleted_at: null,
      },
      data: { status: 'archived', archived_at: now, updated_by: userId, updated_at: now },
    });

    return tx.query_sets.update({
      where: { id: querySet.id },
      data: { status: 'active', activated_at: now, updated_by: userId, updated_at: now },
    });
  });

  return { querySet: updated };
}

export { NO_BRAND_ERROR };
