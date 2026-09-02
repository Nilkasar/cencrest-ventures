import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import type { AppEnv } from '../types/context.js';
import type { use_cases } from '@bebest/database';

const useCasesRoute = new Hono<AppEnv>();

function serialize(row: use_cases) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    industries: row.industries,
    companySizes: row.company_sizes,
    painPoints: row.pain_points,
    solutions: row.solutions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

useCasesRoute.get(
  '/',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('view_intelligence'),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const rows = await withOrgContext(org.organizationId, (tx) =>
      tx.use_cases.findMany({
        where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null },
        orderBy: { created_at: 'asc' },
      }),
    );
    return c.json(rows.map(serialize));
  },
);

const stringArray = (maxItems: number, maxLen: number) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems);

const createSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  industries: stringArray(20, 100).optional(),
  companySizes: stringArray(20, 100).optional(),
  painPoints: stringArray(20, 500).optional(),
  solutions: stringArray(20, 500).optional(),
});

useCasesRoute.post(
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
      tx.use_cases.create({
        data: {
          organization_id: org.organizationId,
          brand_id: brand.id,
          title: input.title,
          description: input.description ?? null,
          industries: input.industries ?? [],
          company_sizes: input.companySizes ?? [],
          pain_points: input.painPoints ?? [],
          solutions: input.solutions ?? [],
          created_by: user.id,
        },
      }),
    );

    await writeManualAuditEvent(c, {
      action: 'use_case.created',
      entityType: 'use_case',
      entityId: created.id,
    });

    return c.json(serialize(created), 201);
  },
);

const updateSchema = createSchema.partial();

useCasesRoute.patch(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'use_case.updated', entityType: 'use_case' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.use_cases.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Use case not found' }, 404);

    const input = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.use_cases.update({
        where: { id: existing.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.industries !== undefined && { industries: input.industries }),
          ...(input.companySizes !== undefined && { company_sizes: input.companySizes }),
          ...(input.painPoints !== undefined && { pain_points: input.painPoints }),
          ...(input.solutions !== undefined && { solutions: input.solutions }),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serialize(updated));
  },
);

useCasesRoute.delete(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'use_case.deleted', entityType: 'use_case' }),
  async (c) => {
    const org = c.get('org');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.use_cases.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Use case not found' }, 404);

    await withOrgContext(org.organizationId, (tx) =>
      tx.use_cases.update({ where: { id: existing.id }, data: { deleted_at: new Date() } }),
    );

    return c.json({ success: true });
  },
);

export default useCasesRoute;
