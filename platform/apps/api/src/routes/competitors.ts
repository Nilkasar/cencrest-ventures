import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { checkUsageLimit, EntitlementLimitError } from '../lib/entitlements.js';
import { httpUrlSchema } from '../lib/validation.js';
import type { AppEnv } from '../types/context.js';
import type { competitors } from '@bebest/database';

const competitorsRoute = new Hono<AppEnv>();

function serializeCompetitor(row: competitors) {
  return {
    id: row.id,
    name: row.name,
    websiteUrl: row.website_url,
    description: row.description,
    competitionType: row.competition_type,
    priority: row.priority,
    aliases: row.aliases,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── GET /brands/me/competitors — list ───────────────────────────────────────
competitorsRoute.get(
  '/',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('view_intelligence'),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const rows = await withOrgContext(org.organizationId, (tx) =>
      tx.competitors.findMany({
        where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null },
        orderBy: { created_at: 'asc' },
      }),
    );

    return c.json(rows.map(serializeCompetitor));
  },
);

// ── POST /brands/me/competitors — create (entitlement-checked) ─────────────
const createCompetitorSchema = z.object({
  name: z.string().trim().min(1).max(255),
  websiteUrl: httpUrlSchema.nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  competitionType: z.enum(['direct', 'indirect', 'aspirational']).nullable().optional(),
  priority: z.enum(['primary', 'secondary', 'watch']).optional(),
  aliases: z.array(z.string().trim().min(1).max(255)).max(20).optional(),
});

competitorsRoute.post(
  '/',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createCompetitorSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    // Entitlement check — the load-bearing example the whole
    // checkUsageLimit/PLAN_LIMITS pattern exists for (see lib/entitlements.ts).
    // MULTI-BRAND: see Epic 18 — counts across the org's one brand for now;
    // multi-brand orgs will need this scoped per-brand or per-org depending
    // on how that epic defines the entitlement.
    try {
      await checkUsageLimit(org.organizationId, 'competitors_tracked', () =>
        withOrgContext(org.organizationId, (tx) =>
          tx.competitors.count({
            where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null },
          }),
        ),
      );
    } catch (err) {
      if (err instanceof EntitlementLimitError) {
        return c.json(
          {
            error: 'competitor_limit_reached',
            message: `Your ${err.plan} plan tracks up to ${err.limit} competitors (you have ${err.current}).${
              err.upgradeTo ? ` Upgrade to ${err.upgradeTo} to track more.` : ''
            }`,
            metric: err.metric,
            limit: err.limit,
            current: err.current,
            plan: err.plan,
            upgradeTo: err.upgradeTo,
          },
          402,
        );
      }
      throw err;
    }

    const input = parsed.data;
    const created = await withOrgContext(org.organizationId, (tx) =>
      tx.competitors.create({
        data: {
          organization_id: org.organizationId,
          brand_id: brand.id,
          name: input.name,
          website_url: input.websiteUrl ?? null,
          description: input.description ?? null,
          competition_type: input.competitionType ?? null,
          priority: input.priority ?? 'secondary',
          aliases: input.aliases ?? [],
          created_by: user.id,
        },
      }),
    );

    await writeManualAuditEvent(c, {
      action: 'competitor.created',
      entityType: 'competitor',
      entityId: created.id,
    });

    return c.json(serializeCompetitor(created), 201);
  },
);

// ── PATCH /brands/me/competitors/:id ─────────────────────────────────────────
const updateCompetitorSchema = createCompetitorSchema.partial();

competitorsRoute.patch(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'competitor.updated', entityType: 'competitor' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateCompetitorSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const org = c.get('org');
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.competitors.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Competitor not found' }, 404);

    const input = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.competitors.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.websiteUrl !== undefined && { website_url: input.websiteUrl }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.competitionType !== undefined && { competition_type: input.competitionType }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.aliases !== undefined && { aliases: input.aliases }),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serializeCompetitor(updated));
  },
);

// ── DELETE /brands/me/competitors/:id — soft delete ─────────────────────────
competitorsRoute.delete(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission('create_brand_profile'),
  auditLog({ action: 'competitor.deleted', entityType: 'competitor' }),
  async (c) => {
    const org = c.get('org');
    const id = c.req.param('id');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.competitors.findFirst({ where: { id, organization_id: org.organizationId, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Competitor not found' }, 404);

    await withOrgContext(org.organizationId, (tx) =>
      tx.competitors.update({ where: { id: existing.id }, data: { deleted_at: new Date() } }),
    );

    return c.json({ success: true });
  },
);

export default competitorsRoute;
