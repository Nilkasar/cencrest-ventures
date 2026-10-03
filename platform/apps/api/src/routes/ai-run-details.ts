import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
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
aiRunDetailsRoute.get('/:id', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const run = await getAiRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  return c.json(serializeAiRun(run));
});

// ── GET /:id/score — the AVS + full formula breakdown ───────────────────
// Always 200, even before AGGREGATE finishes (`computed: false`, all score
// fields null) — a frontend can poll this exactly like it polls run
// status, never needing to distinguish "not ready yet" from a real error.
aiRunDetailsRoute.get('/:id/score', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
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
aiRunDetailsRoute.get('/:id/responses', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
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

// ── GET /:id/provider-summary — per-model observation counts ────────────
// Read-only aggregate for the Overview dashboard's per-model nodes. The
// same numbers are derivable client-side from `/responses`, but that means
// paging every raw response body (thousands of rows of model prose on a
// Pro-tier run) just to count four booleans per provider. This selects only
// the handful of scalar columns it counts — no `raw_response` — and returns
// one row per provider in the run's own `providers` order (providers with
// no responses yet still get a zeroed row, so a running run never loses a
// model). Rates are over EXTRACTED responses only — a response whose
// observation hasn't landed can't honestly count as "not mentioned".
aiRunDetailsRoute.get('/:id/provider-summary', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const run = await getAiRun(org.organizationId, c.req.param('id'));
  if (!run) return c.json(NOT_FOUND_ERROR, 404);

  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.ai_run_responses.findMany({
      where: { ai_run_id: run.id, organization_id: org.organizationId },
      select: {
        provider: true,
        latency_ms: true,
        brand_observations: { select: { brand_mentioned: true, brand_recommended: true, brand_first_position: true } },
      },
    }),
  );

  interface Acc {
    responses: number;
    extracted: number;
    mentioned: number;
    recommended: number;
    positions: number[];
    latencies: number[];
  }
  const order: string[] = [...run.providers];
  const byProvider = new Map<string, Acc>(order.map((p) => [p, { responses: 0, extracted: 0, mentioned: 0, recommended: 0, positions: [], latencies: [] }]));
  for (const row of rows) {
    let acc = byProvider.get(row.provider);
    if (!acc) {
      acc = { responses: 0, extracted: 0, mentioned: 0, recommended: 0, positions: [], latencies: [] };
      byProvider.set(row.provider, acc);
      order.push(row.provider);
    }
    acc.responses += 1;
    if (row.latency_ms !== null) acc.latencies.push(row.latency_ms);
    const obs = row.brand_observations;
    if (!obs) continue;
    acc.extracted += 1;
    if (obs.brand_mentioned) acc.mentioned += 1;
    if (obs.brand_recommended) acc.recommended += 1;
    if (obs.brand_first_position !== null) acc.positions.push(Number(obs.brand_first_position));
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

  return c.json({
    runId: run.id,
    providers: order.map((provider) => {
      const acc = byProvider.get(provider)!;
      const avgPos = mean(acc.positions);
      const avgLatency = mean(acc.latencies);
      return {
        provider,
        responses: acc.responses,
        extracted: acc.extracted,
        mentioned: acc.mentioned,
        recommended: acc.recommended,
        mentionRatePct: acc.extracted > 0 ? round1((acc.mentioned / acc.extracted) * 100) : null,
        recommendationRatePct: acc.extracted > 0 ? round1((acc.recommended / acc.extracted) * 100) : null,
        avgFirstPosition: avgPos === null ? null : Math.round(avgPos * 1000) / 1000,
        avgLatencyMs: avgLatency === null ? null : Math.round(avgLatency),
      };
    }),
  });
});

export default aiRunDetailsRoute;
