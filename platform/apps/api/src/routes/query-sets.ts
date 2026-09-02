import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { resolvePlanLimits } from '../lib/entitlements.js';
import { generateQueryUniverse, type QueryGeneratorBrandProfile } from '../lib/query-generator.js';
import type { AppEnv } from '../types/context.js';
import type { query_sets, queries } from '@bebest/database';

const querySetsRoute = new Hono<AppEnv>();

// Mutations on `query_sets`/`queries` reuse `create_brand_profile` — the
// same RBAC action every other brand-profile-adjacent write uses
// (competitors, use_cases, brand_claims, brand_entities). The epic spec
// does not define a new RBAC action for the query universe, and this data
// is exactly the same kind of thing (owner/admin/analyst-curated brand
// intelligence), so a new action would just be a second name for the same
// permission set — see apps/api/src/lib/rbac.ts.
const VIEW = 'view_intelligence' as const;
const MUTATE = 'create_brand_profile' as const;

function serializeQuerySet(row: query_sets) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    queryCount: row.query_count,
    version: row.version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeQuery(row: queries) {
  return {
    id: row.id,
    querySetId: row.query_set_id,
    text: row.text,
    intentType: row.intent_type,
    category: row.category,
    tags: row.tags,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const NO_QUERY_SET_ERROR = { error: 'Query set not found' } as const;

/**
 * Loads a query_set scoped to the org (and, implicitly, the org's one
 * brand — every query_set already carries `brand_id`, so no extra brand
 * filter is needed once the caller is confirmed to have a brand at all).
 */
async function getQuerySet(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.query_sets.findFirst({ where: { id, organization_id: organizationId, deleted_at: null } }),
  );
}

const NOT_DRAFT_ERROR = {
  error: 'query_set_not_draft',
  message: 'This query set is no longer a draft. Activated/archived query sets cannot be edited — see step 4 of the epic flow: a frozen version must not be silently mutated.',
} as const;

// ── GET / — list the brand's query sets ─────────────────────────────────────
querySetsRoute.get('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.query_sets.findMany({
      where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null },
      orderBy: { created_at: 'desc' },
    }),
  );

  return c.json(rows.map(serializeQuerySet));
});

// ── GET /:id — get one query set ────────────────────────────────────────────
querySetsRoute.get('/:id', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const querySet = await getQuerySet(org.organizationId, c.req.param('id'));
  if (!querySet) return c.json(NO_QUERY_SET_ERROR, 404);

  return c.json(serializeQuerySet(querySet));
});

// ── POST /generate — template-based generator, entitlement-capped ──────────
const generateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
});

querySetsRoute.post('/generate', requireAuth, requireOrgFromToken('viewer'), requirePermission(MUTATE), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = generateSchema.safeParse(body ?? {});
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

  const org = c.get('org');
  const user = c.get('user');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  // Load the exact Epic 2 profile fields the generator reads from — done
  // BEFORE any row is written, and the plan limit is resolved BEFORE the
  // candidate list is even sliced, so a capped generation never touches
  // the database for the queries it isn't going to keep (the epic's step
  // 2: "check the cap going in," not generate-then-truncate).
  const [useCases, competitors, { limits }] = await Promise.all([
    withOrgContext(org.organizationId, (tx) =>
      tx.use_cases.findMany({ where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null } }),
    ),
    withOrgContext(org.organizationId, (tx) =>
      tx.competitors.findMany({ where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null } }),
    ),
    resolvePlanLimits(org.organizationId),
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

  const generated = generateQueryUniverse(profile, limits.queries_per_query_set);
  const input = parsed.data;

  const created = await withOrgContext(org.organizationId, (tx) =>
    tx.query_sets.create({
      data: {
        organization_id: org.organizationId,
        brand_id: brand.id,
        name: input.name ?? `${brand.name} Query Universe`,
        description: input.description ?? null,
        query_count: generated.length,
        version: 1,
        status: 'draft',
        created_by: user.id,
        queries: {
          create: generated.map((q) => ({
            organization_id: org.organizationId,
            text: q.text,
            intent_type: q.intentType,
            category: q.category,
            tags: q.tags,
            priority: q.priority,
            created_by: user.id,
          })),
        },
      },
    }),
  );

  await writeManualAuditEvent(c, {
    action: 'query_set.generated',
    entityType: 'query_set',
    entityId: created.id,
  });

  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.queries.findMany({ where: { query_set_id: created.id, deleted_at: null }, orderBy: { created_at: 'asc' } }),
  );

  return c.json(
    { querySet: serializeQuerySet(created), queries: rows.map(serializeQuery) },
    201,
  );
});

// ── PATCH /:id/activate — draft -> active, freezes version ──────────────────
querySetsRoute.patch(
  '/:id/activate',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'query_set.activated', entityType: 'query_set' }),
  async (c) => {
    const org = c.get('org');
    const id = c.req.param('id');
    const querySet = await getQuerySet(org.organizationId, id);
    if (!querySet) return c.json(NO_QUERY_SET_ERROR, 404);

    if (querySet.status !== 'draft') {
      return c.json(
        { error: 'query_set_not_draft', message: `Only a draft query set can be activated (this one is ${querySet.status}).` },
        409,
      );
    }

    const user = c.get('user');
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.query_sets.update({
        where: { id: querySet.id },
        data: { status: 'active', updated_by: user.id, updated_at: new Date() },
      }),
    );

    return c.json(serializeQuerySet(updated));
  },
);

// ── PATCH /:id/archive — draft|active -> archived ───────────────────────────
querySetsRoute.patch(
  '/:id/archive',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'query_set.archived', entityType: 'query_set' }),
  async (c) => {
    const org = c.get('org');
    const id = c.req.param('id');
    const querySet = await getQuerySet(org.organizationId, id);
    if (!querySet) return c.json(NO_QUERY_SET_ERROR, 404);

    if (querySet.status === 'archived') {
      return c.json({ error: 'query_set_already_archived' }, 409);
    }

    const user = c.get('user');
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.query_sets.update({
        where: { id: querySet.id },
        data: { status: 'archived', updated_by: user.id, updated_at: new Date() },
      }),
    );

    return c.json(serializeQuerySet(updated));
  },
);

// ── GET /:id/queries — list, filterable by intent_type/category ────────────
querySetsRoute.get(
  '/:id/queries',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(VIEW),
  async (c) => {
    const org = c.get('org');
    const querySet = await getQuerySet(org.organizationId, c.req.param('id'));
    if (!querySet) return c.json(NO_QUERY_SET_ERROR, 404);

    const intentType = c.req.query('intentType');
    const category = c.req.query('category');

    const rows = await withOrgContext(org.organizationId, (tx) =>
      tx.queries.findMany({
        where: {
          query_set_id: querySet.id,
          deleted_at: null,
          ...(intentType ? { intent_type: intentType } : {}),
          ...(category ? { category } : {}),
        },
        orderBy: { created_at: 'asc' },
      }),
    );

    return c.json(rows.map(serializeQuery));
  },
);

// ── POST /:id/queries — manual add (draft only) ─────────────────────────────
const queryInputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  intentType: z.enum(['informational', 'commercial', 'comparison', 'transactional']).nullable().optional(),
  category: z.string().trim().min(1).max(100).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

querySetsRoute.post(
  '/:id/queries',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = queryInputSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const querySet = await getQuerySet(org.organizationId, c.req.param('id'));
    if (!querySet) return c.json(NO_QUERY_SET_ERROR, 404);
    if (querySet.status !== 'draft') return c.json(NOT_DRAFT_ERROR, 409);

    const input = parsed.data;
    // `withOrgContext` already runs its callback inside one
    // `db.$transaction`, so both writes here are already atomic — no
    // nested `tx.$transaction` (Prisma's TransactionClient doesn't expose
    // one; sequential awaits on the same `tx` is the correct pattern).
    const created = await withOrgContext(org.organizationId, async (tx) => {
      const row = await tx.queries.create({
        data: {
          organization_id: org.organizationId,
          query_set_id: querySet.id,
          text: input.text,
          intent_type: input.intentType ?? null,
          category: input.category ?? null,
          tags: input.tags ?? [],
          priority: input.priority ?? 2,
          created_by: user.id,
        },
      });
      await tx.query_sets.update({
        where: { id: querySet.id },
        data: { query_count: { increment: 1 } },
      });
      return row;
    });

    await writeManualAuditEvent(c, { action: 'query.created', entityType: 'query', entityId: created.id });

    return c.json(serializeQuery(created), 201);
  },
);

// ── PATCH /:id/queries/:queryId — manual edit (draft only) ─────────────────
const queryUpdateSchema = queryInputSchema.partial();

querySetsRoute.patch(
  '/:id/queries/:queryId',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'query.updated', entityType: 'query', getEntityId: (c) => c.req.param('queryId') ?? 'unknown' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = queryUpdateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const querySet = await getQuerySet(org.organizationId, c.req.param('id'));
    if (!querySet) return c.json(NO_QUERY_SET_ERROR, 404);
    if (querySet.status !== 'draft') return c.json(NOT_DRAFT_ERROR, 409);

    const queryId = c.req.param('queryId');
    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.queries.findFirst({
        where: { id: queryId, query_set_id: querySet.id, organization_id: org.organizationId, deleted_at: null },
      }),
    );
    if (!existing) return c.json({ error: 'Query not found' }, 404);

    const user = c.get('user');
    const input = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.queries.update({
        where: { id: existing.id },
        data: {
          ...(input.text !== undefined && { text: input.text }),
          ...(input.intentType !== undefined && { intent_type: input.intentType }),
          ...(input.category !== undefined && { category: input.category }),
          ...(input.tags !== undefined && { tags: input.tags }),
          ...(input.priority !== undefined && { priority: input.priority }),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serializeQuery(updated));
  },
);

// ── DELETE /:id/queries/:queryId — manual remove (draft only, soft delete) ─
querySetsRoute.delete(
  '/:id/queries/:queryId',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'query.deleted', entityType: 'query', getEntityId: (c) => c.req.param('queryId') ?? 'unknown' }),
  async (c) => {
    const org = c.get('org');
    const querySet = await getQuerySet(org.organizationId, c.req.param('id'));
    if (!querySet) return c.json(NO_QUERY_SET_ERROR, 404);
    if (querySet.status !== 'draft') return c.json(NOT_DRAFT_ERROR, 409);

    const queryId = c.req.param('queryId');
    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.queries.findFirst({
        where: { id: queryId, query_set_id: querySet.id, organization_id: org.organizationId, deleted_at: null },
      }),
    );
    if (!existing) return c.json({ error: 'Query not found' }, 404);

    await withOrgContext(org.organizationId, async (tx) => {
      await tx.queries.update({ where: { id: existing.id }, data: { deleted_at: new Date() } });
      await tx.query_sets.update({
        where: { id: querySet.id },
        data: { query_count: { decrement: 1 } },
      });
    });

    return c.json({ success: true });
  },
);

export default querySetsRoute;
