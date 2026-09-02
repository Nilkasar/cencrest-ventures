import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import type { AppEnv } from '../types/context.js';
import type { brand_entities } from '@bebest/database';

const brandEntitiesRoute = new Hono<AppEnv>();

function serialize(row: brand_entities) {
  return {
    id: row.id,
    name: row.name,
    schemaType: row.schema_type,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

brandEntitiesRoute.get(
  '/',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('view_intelligence'),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const rows = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_entities.findMany({
        where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null },
        orderBy: { created_at: 'asc' },
      }),
    );
    return c.json(rows.map(serialize));
  },
);

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  schemaType: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
});

brandEntitiesRoute.post(
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
      tx.brand_entities.create({
        data: {
          organization_id: org.organizationId,
          brand_id: brand.id,
          name: input.name,
          schema_type: input.schemaType ?? null,
          description: input.description ?? null,
          created_by: user.id,
        },
      }),
    );

    await writeManualAuditEvent(c, {
      action: 'brand_entity.created',
      entityType: 'brand_entity',
      entityId: created.id,
    });

    return c.json(serialize(created), 201);
  },
);

const updateSchema = createSchema.partial();

brandEntitiesRoute.patch(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'brand_entity.updated', entityType: 'brand_entity' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_entities.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Entity not found' }, 404);

    const input = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_entities.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.schemaType !== undefined && { schema_type: input.schemaType }),
          ...(input.description !== undefined && { description: input.description }),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serialize(updated));
  },
);

brandEntitiesRoute.delete(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'brand_entity.deleted', entityType: 'brand_entity' }),
  async (c) => {
    const org = c.get('org');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_entities.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Entity not found' }, 404);

    await withOrgContext(org.organizationId, (tx) =>
      tx.brand_entities.update({ where: { id: existing.id }, data: { deleted_at: new Date() } }),
    );

    return c.json({ success: true });
  },
);

export default brandEntitiesRoute;
