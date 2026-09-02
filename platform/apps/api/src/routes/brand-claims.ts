import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import type { AppEnv } from '../types/context.js';
import type { brand_claims } from '@bebest/database';

const brandClaimsRoute = new Hono<AppEnv>();

function serialize(row: brand_claims) {
  return {
    id: row.id,
    claim: row.claim,
    evidence: row.evidence,
    confidence: row.confidence,
    verified: row.verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

brandClaimsRoute.get(
  '/',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('view_intelligence'),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const rows = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_claims.findMany({
        where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null },
        orderBy: { created_at: 'asc' },
      }),
    );
    return c.json(rows.map(serialize));
  },
);

const createSchema = z.object({
  claim: z.string().trim().min(1).max(2000),
  evidence: z.string().trim().max(5000).nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  verified: z.boolean().optional(),
});

brandClaimsRoute.post(
  '/',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const input = parsed.data;
    const created = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_claims.create({
        data: {
          organization_id: org.organizationId,
          brand_id: brand.id,
          claim: input.claim,
          evidence: input.evidence ?? null,
          confidence: input.confidence ?? 'medium',
          verified: input.verified ?? false,
          created_by: user.id,
        },
      }),
    );

    await writeManualAuditEvent(c, {
      action: 'brand_claim.created',
      entityType: 'brand_claim',
      entityId: created.id,
    });

    return c.json(serialize(created), 201);
  },
);

const updateSchema = createSchema.partial();

brandClaimsRoute.patch(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'brand_claim.updated', entityType: 'brand_claim' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_claims.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Claim not found' }, 404);

    const input = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_claims.update({
        where: { id: existing.id },
        data: {
          ...(input.claim !== undefined && { claim: input.claim }),
          ...(input.evidence !== undefined && { evidence: input.evidence }),
          ...(input.confidence !== undefined && { confidence: input.confidence }),
          ...(input.verified !== undefined && { verified: input.verified }),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serialize(updated));
  },
);

brandClaimsRoute.delete(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'brand_claim.deleted', entityType: 'brand_claim' }),
  async (c) => {
    const org = c.get('org');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_claims.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Claim not found' }, 404);

    await withOrgContext(org.organizationId, (tx) =>
      tx.brand_claims.update({ where: { id: existing.id }, data: { deleted_at: new Date() } }),
    );

    return c.json({ success: true });
  },
);

export default brandClaimsRoute;
