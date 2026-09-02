import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { serializeAiRun, serializeAiRunResponse, serializeAiRunScore } from '../lib/ai-visibility/serialize.js';
import type { AppEnv } from '../types/context.js';

const aiRunDetailsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const NOT_FOUND_ERROR = { error: 'AI run not found' } as const;

/** Scoped by organization_id via BOTH `withOrgContext` (RLS) and an
 * explicit WHERE clause — same belt-and-suspenders pattern
 * `routes/crawl-jobs.ts` uses: an id from another org 404s, never a 403
 * that would confirm the id exists (tenant isolation — see the epic's
 * end-to-end flow step 7). */
async function getAiRun(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.ai_runs.findFirst({ where: { id, organization_id: organizationId } }));
}

// ── GET /:id — status/progress ──────────────────────────────────────────
aiRunDetailsRoute.get('/:id', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const run = await getAiRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  return c.json(serializeAiRun(run));
});

// ── GET /:id/score — the AVS + full formula breakdown ───────────────────
// Always 200, even before AGGREGATE finishes (`computed: false`, all score
// fields null) — a frontend can poll this exactly like it polls run
// status, never needing to distinguish "not ready yet" from a real error.
aiRunDetailsRoute.get('/:id/score', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const run = await getAiRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  return c.json(serializeAiRunScore(run));
});

// ── GET /:id/responses — paginated raw-response explorer ────────────────
// Every response is returned with its (at most one) linked
// `brand_observations` row inline, so a UI can walk
// score -> observation -> raw response in a single request per page,
// per the epic's UI-surface requirement.
aiRunDetailsRoute.get('/:id/responses', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const run = await getAiRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
  const queryId = c.req.query('queryId');
  const provider = c.req.query('provider');
  const extractionStatus = c.req.query('extractionStatus');

  const where = {
    ai_run_id: run.id,
    organization_id: org.organizationId,
    ...(queryId ? { query_id: queryId } : {}),
    ...(provider ? { provider } : {}),
    ...(extractionStatus ? { extraction_status: extractionStatus } : {}),
  };

  const [rows, total] = await withOrgContext(org.organizationId, async (tx) => {
    const [rowsResult, totalResult] = await Promise.all([
      tx.ai_run_responses.findMany({
        where,
        include: { brand_observations: true },
        orderBy: { created_at: 'asc' },
        skip: offset,
        take: limit,
      }),
      tx.ai_run_responses.count({ where }),
    ]);
    return [rowsResult, totalResult];
  });

  return c.json({
    items: rows.map(serializeAiRunResponse),
    total,
    limit,
    offset,
  });
});

export default aiRunDetailsRoute;
