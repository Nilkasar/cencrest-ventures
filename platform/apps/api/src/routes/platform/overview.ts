import { Hono } from 'hono';
import { platformDb } from '@bebest/database/platform';
import { getInternalOrgId } from '../../lib/internal-org.js';
import type { AppEnv } from '../../types/context.js';
import { JOB_SPECS, JOB_TYPES, STUCK_AFTER_MINUTES, stuckPredicate, type JobType } from './jobs.js';
import { json, num, platformGuard } from './shared.js';

/**
 * Epic 22 Phase 1 — `GET /api/platform/overview` (support).
 *
 * The Platform view's landing KPIs, computed in ONE round trip: a single
 * statement of independent scalar subqueries folded into one JSON row. On
 * a remote database every round trip is the dominant cost (~260ms to the
 * dev Neon instance), and the platform pool is deliberately small (3), so
 * "eight queries in parallel" would still be three serial waves; one
 * statement is one wave. Every subquery is an aggregate — no N+1, no rows
 * shipped back to be counted in JS.
 *
 * Windows are rolling (`now() - interval`), except "today", which is the
 * current UTC calendar day — every timestamp in this schema is timestamptz
 * and the platform reports in UTC.
 */

export interface StatusCounts {
  [status: string]: number;
}

export interface PlatformOverview {
  generatedAt: string;
  organizations: {
    total: number;
    byKind: Record<string, number>;
    /** Subscription plan slug; `none` = no subscriptions row (treated as free by entitlements). */
    byPlan: Record<string, number>;
    byStatus: Record<string, number>;
    new7d: number;
  };
  users: {
    total: number;
    /** users.last_login_at within the window */
    active7d: number;
    active30d: number;
    new7d: number;
    platformStaff: number;
  };
  aiRuns: {
    today: number;
    todayFailed: number;
    last7d: number;
    byStatus7d: StatusCounts;
    /** failed / finished (completed + failed + cancelled) over runs created in the last 7 days, 0–1, 4 dp; null when none finished. */
    failureRate7d: number | null;
  };
  agentRuns: { last7d: number; byStatus7d: StatusCounts; failureRate7d: number | null };
  crawlJobs: { last7d: number; byStatus7d: StatusCounts; failureRate7d: number | null };
  stuckJobs: {
    /** active status (queued/running, or pending/processing for snapshots) for more than this many minutes */
    thresholdMinutes: number;
    total: number;
    byType: Record<JobType, number>;
  };
  /** CRM leads in the internal org created in the last 7 days; null when CRM_INTERNAL_ORG_ID is not configured. */
  leads: { new7d: number; bySource7d: StatusCounts } | null;
  snapshots: { last7d: number; byStatus7d: StatusCounts };
}

const overview = new Hono<AppEnv>();

function statusAgg(table: string, statusExpr = 'status::text'): string {
  return `(SELECT COALESCE(json_object_agg(s, n), '{}'::json) FROM (
            SELECT ${statusExpr} AS s, count(*)::int AS n FROM ${table}
             WHERE created_at >= now() - interval '7 days' GROUP BY 1) t)`;
}

function failureRate(byStatus: StatusCounts): number | null {
  const failed = byStatus.failed ?? 0;
  const finished = failed + (byStatus.completed ?? 0) + (byStatus.cancelled ?? 0) + (byStatus.complete ?? 0);
  return finished === 0 ? null : Math.round((failed / finished) * 10_000) / 10_000;
}

function sum(counts: StatusCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

overview.get('/', ...platformGuard('support'), async (c) => {
  let internalOrgId: string | null = null;
  try {
    internalOrgId = getInternalOrgId();
  } catch {
    internalOrgId = null;
  }

  const stuckSelects = JOB_TYPES.map(
    (t) => `'${t}', (SELECT count(*)::int FROM ${JOB_SPECS[t].table} WHERE ${stuckPredicate(t)})`,
  ).join(', ');

  const sql = `
    WITH org_rows AS (
      SELECT o.kind, o.status, COALESCE(s.plan, 'none') AS plan, o.created_at
        FROM organizations o
        LEFT JOIN subscriptions s ON s.organization_id = o.id
       WHERE o.deleted_at IS NULL
    )
    SELECT json_build_object(
      'orgTotal',   (SELECT count(*)::int FROM org_rows),
      'orgNew7d',   (SELECT count(*)::int FROM org_rows WHERE created_at >= now() - interval '7 days'),
      'orgByKind',  (SELECT COALESCE(json_object_agg(kind, n), '{}'::json) FROM (SELECT kind, count(*)::int n FROM org_rows GROUP BY 1) t),
      'orgByPlan',  (SELECT COALESCE(json_object_agg(plan, n), '{}'::json) FROM (SELECT plan, count(*)::int n FROM org_rows GROUP BY 1) t),
      'orgByStatus',(SELECT COALESCE(json_object_agg(status, n), '{}'::json) FROM (SELECT status, count(*)::int n FROM org_rows GROUP BY 1) t),
      'users', (SELECT json_build_object(
                  'total', count(*)::int,
                  'active7d', count(*) FILTER (WHERE last_login_at >= now() - interval '7 days')::int,
                  'active30d', count(*) FILTER (WHERE last_login_at >= now() - interval '30 days')::int,
                  'new7d', count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int,
                  'staff', count(*) FILTER (WHERE platform_role <> 'none')::int)
                  FROM users WHERE deleted_at IS NULL),
      'aiToday', (SELECT json_build_object(
                  'total', count(*)::int,
                  'failed', count(*) FILTER (WHERE status = 'failed')::int)
                  FROM ai_runs WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),
      'ai7d', ${statusAgg('ai_runs')},
      'agent7d', ${statusAgg('agent_runs')},
      'crawl7d', ${statusAgg('crawl_jobs')},
      'snap7d', ${statusAgg('snapshot_requests')},
      'stuck', json_build_object(${stuckSelects}),
      'leads7d', CASE WHEN $1::uuid IS NULL THEN NULL ELSE
                 (SELECT COALESCE(json_object_agg(source, n), '{}'::json) FROM (
                    SELECT source::text AS source, count(*)::int n FROM leads
                     WHERE organization_id = $1::uuid AND deleted_at IS NULL
                       AND created_at >= now() - interval '7 days' GROUP BY 1) t) END
    ) AS kpis`;

  const [row] = await platformDb.$queryRawUnsafe<{ kpis: unknown }[]>(sql, internalOrgId);
  const k = json<{
    orgTotal: number;
    orgNew7d: number;
    orgByKind: Record<string, number>;
    orgByPlan: Record<string, number>;
    orgByStatus: Record<string, number>;
    users: { total: number; active7d: number; active30d: number; new7d: number; staff: number };
    aiToday: { total: number; failed: number };
    ai7d: StatusCounts;
    agent7d: StatusCounts;
    crawl7d: StatusCounts;
    snap7d: StatusCounts;
    stuck: Record<JobType, number>;
    leads7d: StatusCounts | null;
  }>(row?.kpis);

  const stuckByType = Object.fromEntries(JOB_TYPES.map((t) => [t, num(k.stuck[t])])) as Record<JobType, number>;

  const body: PlatformOverview = {
    generatedAt: new Date().toISOString(),
    organizations: {
      total: num(k.orgTotal),
      byKind: k.orgByKind,
      byPlan: k.orgByPlan,
      byStatus: k.orgByStatus,
      new7d: num(k.orgNew7d),
    },
    users: {
      total: num(k.users.total),
      active7d: num(k.users.active7d),
      active30d: num(k.users.active30d),
      new7d: num(k.users.new7d),
      platformStaff: num(k.users.staff),
    },
    aiRuns: {
      today: num(k.aiToday.total),
      todayFailed: num(k.aiToday.failed),
      last7d: sum(k.ai7d),
      byStatus7d: k.ai7d,
      failureRate7d: failureRate(k.ai7d),
    },
    agentRuns: { last7d: sum(k.agent7d), byStatus7d: k.agent7d, failureRate7d: failureRate(k.agent7d) },
    crawlJobs: { last7d: sum(k.crawl7d), byStatus7d: k.crawl7d, failureRate7d: failureRate(k.crawl7d) },
    stuckJobs: {
      thresholdMinutes: STUCK_AFTER_MINUTES,
      total: sum(stuckByType),
      byType: stuckByType,
    },
    leads: k.leads7d ? { new7d: sum(k.leads7d), bySource7d: k.leads7d } : null,
    snapshots: { last7d: sum(k.snap7d), byStatus7d: k.snap7d },
  };

  return c.json(body);
});

export default overview;
