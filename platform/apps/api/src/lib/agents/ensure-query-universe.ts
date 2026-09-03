/**
 * Shared step used by both the GEO and SEO agents (`docs/epics/
 * 12-agents.md`'s GEO Agent flow: "generate query universe (Epic 5, if none
 * active)"): resolve the brand's active query set, generating+activating
 * one via Epic 5's own `lib/query-sets/generate.ts` functions when none
 * exists. A thin wrapper, not new logic — every actual write goes through
 * the exact same functions `routes/query-sets.ts` itself calls.
 */
import { withOrgContext, type query_sets } from '@bebest/database';
import { activateQuerySetRow, generateQuerySetForBrand } from '../query-sets/generate.js';

export type EnsureQuerySetResult =
  | { error: 'no_brand' }
  | { error: 'no_human_trigger' }
  | { querySet: query_sets; created: boolean };

export async function ensureActiveQuerySet(
  organizationId: string,
  brandId: string,
  triggeredById: string | undefined,
): Promise<EnsureQuerySetResult> {
  const active = await withOrgContext(organizationId, (tx) =>
    tx.query_sets.findFirst({
      where: { organization_id: organizationId, brand_id: brandId, status: 'active', deleted_at: null },
    }),
  );
  if (active) return { querySet: active, created: false };

  // `query_sets.created_by` is a required, human-attributed column
  // (@bebest/database DECISIONS.md §16/§4 — "triggering is a human
  // action") — a schedule/event-triggered run with no human to attribute
  // the write to cannot generate one. This build's only real trigger route
  // is user-initiated, so this branch is defensive, not a real gap.
  if (!triggeredById) return { error: 'no_human_trigger' };

  const generated = await generateQuerySetForBrand(organizationId, triggeredById, {});
  if ('error' in generated) return { error: 'no_brand' };

  const activated = await activateQuerySetRow(organizationId, generated.querySet.id, triggeredById);
  // A freshly-created draft can only fail activation if it disappeared
  // between the two calls — never actually reachable in practice, but
  // handled rather than asserted so this function has no unsafe `!`.
  if ('error' in activated) return { error: 'no_brand' };

  return { querySet: activated.querySet, created: true };
}
