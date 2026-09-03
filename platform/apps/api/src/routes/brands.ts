import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg } from '../lib/brand-context.js';
import { httpUrlSchema } from '../lib/validation.js';
import type { AppEnv } from '../types/context.js';
import type { brands } from '@bebest/database';

const brandsRoute = new Hono<AppEnv>();

function serializeBrand(brand: brands) {
  return {
    id: brand.id,
    name: brand.name,
    description: brand.description,
    websiteUrl: brand.website_url,
    industries: brand.industries,
    categories: brand.categories,
    markets: brand.markets,
    logoUrl: brand.logo_url,
    aliases: brand.aliases,
    positioning: brand.positioning,
    valueProposition: brand.value_proposition,
    differentiators: brand.differentiators,
    createdAt: brand.created_at,
    updatedAt: brand.updated_at,
  };
}

// ── GET /brands/me — single brand per org (MULTI-BRAND: see Epic 18) ───────
brandsRoute.get(
  '/me',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  requirePermission('view_intelligence'),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) {
      return c.json(
        {
          error: 'Brand profile not found',
          message: 'This organization has no brand profile yet. Create one with PATCH /api/brands/me.',
        },
        404,
      );
    }
    return c.json(serializeBrand(brand));
  },
);

// ── PATCH /brands/me — create-or-update (the onboarding wizard's "Brand
// basics" step has no separate create endpoint; PATCH upserts) ────────────
const stringArray = (maxItems: number, maxLen: number) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems);

// Post-verification fix (Epic 2 QA pass): `industry` (singular) replaced
// with `industries`/`categories`/`markets` (plural arrays) and
// `keyDifferentiators` renamed to `differentiators` — docs/06-database/
// SCHEMA.md §2's `brands` DDL specifies all four as arrays, and the
// frontend (`apps/web/src/data/types.ts`) was already built against that
// shape. See packages/database/DECISIONS.md §15.
const patchBrandSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  websiteUrl: httpUrlSchema.nullable().optional(),
  industries: stringArray(20, 100).optional(),
  categories: stringArray(20, 100).optional(),
  markets: stringArray(20, 100).optional(),
  logoUrl: httpUrlSchema.nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(255)).max(20).optional(),
  positioning: z.string().trim().max(2000).nullable().optional(),
  valueProposition: z.string().trim().max(2000).nullable().optional(),
  differentiators: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
});

brandsRoute.patch(
  '/me',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = patchBrandSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const org = c.get('org');
    const user = c.get('user');
    const input = parsed.data;

    const existing = await getBrandForOrg(org.organizationId);

    if (!existing && !input.name) {
      return c.json(
        { error: 'Validation failed', message: '"name" is required to create a brand profile.' },
        422,
      );
    }

    const brand = await withOrgContext(org.organizationId, async (tx) => {
      if (existing) {
        return tx.brands.update({
          where: { id: existing.id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.websiteUrl !== undefined && { website_url: input.websiteUrl }),
            ...(input.industries !== undefined && { industries: input.industries }),
            ...(input.categories !== undefined && { categories: input.categories }),
            ...(input.markets !== undefined && { markets: input.markets }),
            ...(input.logoUrl !== undefined && { logo_url: input.logoUrl }),
            ...(input.aliases !== undefined && { aliases: input.aliases }),
            ...(input.positioning !== undefined && { positioning: input.positioning }),
            ...(input.valueProposition !== undefined && { value_proposition: input.valueProposition }),
            ...(input.differentiators !== undefined && { differentiators: input.differentiators }),
            updated_by: user.id,
            updated_at: new Date(),
          },
        });
      }

      return tx.brands.create({
        data: {
          organization_id: org.organizationId,
          name: input.name as string,
          description: input.description ?? null,
          website_url: input.websiteUrl ?? null,
          industries: input.industries ?? [],
          categories: input.categories ?? [],
          markets: input.markets ?? [],
          logo_url: input.logoUrl ?? null,
          aliases: input.aliases ?? [],
          positioning: input.positioning ?? null,
          value_proposition: input.valueProposition ?? null,
          differentiators: input.differentiators ?? [],
          created_by: user.id,
        },
      });
    });

    await writeManualAuditEvent(c, {
      action: existing ? 'brand.updated' : 'brand.created',
      entityType: 'brand',
      entityId: brand.id,
    });

    return c.json(serializeBrand(brand), existing ? 200 : 201);
  },
);

export default brandsRoute;
