/**
 * Epic 9 (Opportunity Engine) — brand-scoped routes
 * (`docs/epics/09-opportunity-engine.md`'s "API surface"):
 *
 *   POST /brands/me/opportunities/recompute — runs the SEO+GEO merge.
 *   GET  /brands/me/opportunities           — list, sortable/filterable.
 *
 * The id-addressed `GET /opportunities/:id` and `PATCH /opportunities/:id`
 * live in `routes/opportunity-details.ts`, same split Epic 7 uses
 * (`routes/ai-runs.ts` vs. `routes/ai-run-details.ts`).
 *
 * ── The merge, end to end ────────────────────────────────────────────────
 * 1. `loadCompetitiveDataset` (Epic 8's own data-loading function — not
 *    re-implemented) resolves the brand's ACTIVE query set (Epic 5's
 *    "Query Universe") plus the brand's and every competitor's most recent
 *    COMPLETED run on it. `dataset.queries` IS the intent universe this
 *    epic's spec says to iterate.
 * 2. Epic 4's `seo_keywords` (via their owning `keyword_groups.brand_id`)
 *    are matched against each query's `text`, case-insensitively and
 *    trimmed (documented v1 limitation — no fuzzy matching — in
 *    `@bebest/database` DECISIONS.md's Epic 9 section: the two tables have
 *    no shared key). The matched keyword's most recent `seo_opportunities`
 *    row (if `POST /keyword-groups/generate` already produced one) is
 *    preferred over recomputing from scratch.
 * 3. Epic 8's `classifyIntentGaps` (not re-implemented) runs once over
 *    every query in the set, keyed by `queries.id` directly — no matching
 *    needed on this side.
 * 4. `buildMergeResult` (`lib/opportunities/merge-scoring.ts`) turns
 *    whichever signal(s) are present into one `unified_opportunities` row
 *    plus its evidence, or `null` when neither is present (skipped).
 * 5. Idempotent upsert keyed on `(organization_id, brand_id, query_id)` —
 *    see the handler below for the exact dismissed-row / material-change
 *    handling this epic's DoD calls out by name.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { recomputeOpportunitiesForBrand } from '../lib/opportunities/recompute.js';
import { serializeOpportunity } from '../lib/opportunities/serialize.js';
import type { AppEnv } from '../types/context.js';
import type { unified_opportunity_type } from '@bebest/database';

const opportunitiesRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const MUTATE = 'create_brand_profile' as const;

const NO_ACTIVE_QUERY_SET_ERROR = {
  error: 'no_active_query_set',
  message: 'This brand has no active query set. Generate and activate one first via /api/brands/me/query-sets.',
} as const;

// ── POST /recompute ───────────────────────────────────────────────────────
// The merge algorithm itself (`loadCompetitiveDataset` -> SEO keyword match
// -> `classifyIntentGaps` -> `buildMergeResult` -> idempotent upsert) now
// lives in `lib/opportunities/recompute.ts` — extracted (behavior
// unchanged) so Epic 12's agents can call the exact same function instead
// of reimplementing it; see that file's header comment.

opportunitiesRoute.post('/recompute', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(MUTATE), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const result = await recomputeOpportunitiesForBrand(org.organizationId);
  if ('error' in result) return c.json(NO_ACTIVE_QUERY_SET_ERROR, 404);

  await writeManualAuditEvent(c, { action: 'opportunity.recomputed', entityType: 'brand', entityId: brand.id });

  return c.json({
    querySetId: result.querySetId,
    summary: result.summary,
    opportunities: result.opportunities.map(serializeOpportunity),
  });
});

// ── GET / — list, sortable by opportunity_score, filterable by
// type/status/priority ────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.enum(['new', 'in_progress', 'completed', 'dismissed']).optional(),
  type: z.enum(['seo', 'geo', 'unified', 'content', 'technical']).optional(),
  priority: z.coerce.number().int().min(1).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

opportunitiesRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  const { status, type, priority, limit, offset } = parsed.data;

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const where = {
    organization_id: org.organizationId,
    brand_id: brand.id,
    ...(status ? { status } : {}),
    ...(type ? { type: type as unified_opportunity_type } : {}),
    ...(priority ? { priority } : {}),
  };

  const [total, rows] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.unified_opportunities.count({ where }),
      tx.unified_opportunities.findMany({
        where,
        orderBy: [{ opportunity_score: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ]),
  );

  return c.json({
    opportunities: rows.map(serializeOpportunity),
    pagination: { total, limit, offset },
  });
});

export default opportunitiesRoute;
