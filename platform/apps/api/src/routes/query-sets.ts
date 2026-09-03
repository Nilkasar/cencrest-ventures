import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { checkUsageLimit, EntitlementLimitError } from '../lib/entitlements.js';
import { CATEGORY_META, type QueryTemplateCategory } from '../lib/query-generator.js';
import { activateQuerySetRow, generateQuerySetForBrand } from '../lib/query-sets/generate.js';
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

// Post-verification fix (Epic 5 QA pass — see DECISIONS.md §18):
// `planTier`/`planLimit`/`potentialCount`/`activatedAt`/`archivedAt` are
// genuinely read by the review UI (`QuerySetSummaryCard`'s plan/cap meter
// and lifecycle timestamps, the version-history table) — checked against
// the components before adding, not assumed. `brandId`/`organizationId`
// were checked the same way and found unused by any component, so they are
// deliberately NOT serialized here (the columns still exist on the row for
// tenant scoping, just aren't sent to the client).
function serializeQuerySet(row: query_sets) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    queryCount: row.query_count,
    version: row.version,
    status: row.status,
    planTier: row.plan_tier,
    planLimit: row.plan_limit,
    potentialCount: row.potential_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
    archivedAt: row.archived_at,
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
    // Post-verification fix: genuinely displayed (a "Manual" badge in the
    // review UI) — see the `queries.source` column doc comment.
    source: row.source,
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

  // Epic 12 reuses this exact function (`lib/query-sets/generate.ts`) for
  // its own agents' "generate query universe if none active" step — see
  // that file's header comment.
  const result = await generateQuerySetForBrand(org.organizationId, user.id, parsed.data);
  if ('error' in result) return c.json(NO_BRAND_ERROR, 404);

  await writeManualAuditEvent(c, {
    action: 'query_set.generated',
    entityType: 'query_set',
    entityId: result.querySet.id,
  });

  return c.json(
    { querySet: serializeQuerySet(result.querySet), queries: result.queries.map(serializeQuery) },
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
    const user = c.get('user');

    // Post-verification fix (backend bug #1, preserved by this extraction —
    // see `lib/query-sets/generate.ts`'s `activateQuerySetRow`): the
    // frontend's original fixture layer always archived the brand's
    // previously-active set on activation, but the real route never did,
    // and nothing in the schema prevented two simultaneously-active sets
    // for the same brand. Both writes happen in one `withOrgContext` call
    // (already a single `db.$transaction`), so a concurrent activate on a
    // second draft can't observe a moment where two sets are both `active`.
    // Epic 12 reuses this exact function for its own agents' "activate the
    // generated query universe" step.
    const result = await activateQuerySetRow(org.organizationId, id, user.id);
    if ('error' in result && result.error === 'not_found') return c.json(NO_QUERY_SET_ERROR, 404);
    if ('error' in result) {
      return c.json(
        { error: 'query_set_not_draft', message: `Only a draft query set can be activated (this one is ${result.current.status}).` },
        409,
      );
    }

    return c.json(serializeQuerySet(result.querySet));
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
    const now = new Date();
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.query_sets.update({
        where: { id: querySet.id },
        data: { status: 'archived', archived_at: now, updated_by: user.id, updated_at: now },
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
// Post-verification fix (nullability reconciliation, DECISIONS.md §18):
// `category` is now required, non-nullable — the manual-add dialog's
// Category `<Select>` always has a value, there is no "no category" option,
// so the API contract now matches what the only caller actually sends.
// `intentType` stays optional (not nullable): when the caller omits it, it
// is derived from the chosen category via `CATEGORY_META` below instead of
// being persisted as null, reconciling the frontend's non-nullable
// `Query.intentType` without forcing every caller to compute it themselves.
const queryInputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(1).max(100),
  intentType: z.enum(['informational', 'commercial', 'comparison', 'transactional']).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

/** Falls back to `informational` for a category outside the ten template
 *  values (allowed — `queries.category` is deliberately open, see
 *  DECISIONS.md §16) where `CATEGORY_META` has no mapping. */
function defaultIntentTypeFor(category: string): 'informational' | 'commercial' | 'comparison' | 'transactional' {
  return CATEGORY_META[category as QueryTemplateCategory]?.intentType ?? 'informational';
}

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

    // Post-verification fix (backend bug #2): `POST /generate` correctly
    // caps against `queries_per_query_set`, but this route never checked
    // the cap at all — a user could generate up to the limit, then add
    // unlimited queries manually. Reuses the exact `checkUsageLimit`/
    // `EntitlementLimitError` pattern `routes/competitors.ts` establishes
    // for `competitors_tracked`, scoped to THIS query_set (the entitlement
    // is per generated set, not a cumulative org-wide total — see
    // `lib/entitlements.ts`'s own doc comment on `queries_per_query_set`).
    try {
      await checkUsageLimit(org.organizationId, 'queries_per_query_set', () =>
        withOrgContext(org.organizationId, (tx) =>
          tx.queries.count({
            where: { query_set_id: querySet.id, organization_id: org.organizationId, deleted_at: null },
          }),
        ),
      );
    } catch (err) {
      if (err instanceof EntitlementLimitError) {
        return c.json(
          {
            error: 'query_limit_reached',
            message: `Your ${err.plan} plan allows up to ${err.limit.toLocaleString()} queries per query set (this set has ${err.current.toLocaleString()}).${
              err.upgradeTo ? ` Upgrade to ${err.upgradeTo} to add more.` : ''
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
          intent_type: input.intentType ?? defaultIntentTypeFor(input.category),
          category: input.category,
          tags: input.tags ?? [],
          priority: input.priority ?? 2,
          source: 'manual',
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
