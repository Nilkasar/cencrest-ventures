import { withOrgContext, type brands } from '@bebest/database';

/**
 * Resolves the current organization's single brand profile.
 *
 * MULTI-BRAND: see Epic 18. This assumes exactly one (non-deleted) brand
 * per organization, per docs/epics/02-brand-intelligence.md's explicit
 * scope note for this epic ("assume exactly one brand per organization and
 * leave the multi-brand case ... rather than building it now"). `findFirst`
 * orders by `created_at` so behavior stays deterministic even if that
 * invariant is ever violated by a future bug, rather than returning
 * whichever row the database happens to return first.
 *
 * Every competitors/entities/use_cases/brand_claims route resolves the
 * brand through this one function — never queries `brands` directly — so
 * the day Epic 18 adds real multi-brand support, this is the only place
 * that needs to change (e.g. to take a `brandId` param instead of
 * inferring "the" brand from the org).
 */
export async function getBrandForOrg(organizationId: string): Promise<brands | null> {
  return withOrgContext(organizationId, (tx) =>
    tx.brands.findFirst({
      where: { organization_id: organizationId, deleted_at: null },
      orderBy: { created_at: 'asc' },
    }),
  );
}

export const NO_BRAND_ERROR = {
  error: 'Brand profile not found',
  message: 'This organization has no brand profile yet. Create one first via PATCH /api/brands/me.',
} as const;
