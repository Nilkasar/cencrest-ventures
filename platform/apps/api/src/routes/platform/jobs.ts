import { Hono } from 'hono';
import { platformDb } from '@bebest/database/platform';
import { writeAuditEvent } from '../../lib/audit.js';
import { clientIp } from '../../lib/client-ip.js';
import { isUuid } from '../../lib/http-params.js';
import type { AppEnv } from '../../types/context.js';
import { isPageError, iso, num, parsePage, platformGuard, SqlParams, type Paginated } from './shared.js';

/**
 * Epic 22 Phase 1 — Operations: one job list across the four tables that
 * hold background work, and a staff cancel.
 *
 *   GET  /api/platform/jobs?type&status&orgId&stuck=true&limit&offset   (support)
 *   POST /api/platform/jobs/:type/:id/cancel                             (admin)
 *
 * STATUS VOCABULARIES (from the schema, not invented here)
 *   crawl_jobs.status        enum crawl_status: queued|running|completed|failed|cancelled
 *   ai_runs.status           CHECK chk_ai_runs_status: queued|running|completed|failed
 *   agent_runs.status        CHECK chk_agent_runs_status: queued|running|completed|failed
 *   snapshot_requests.status enum snapshot_status: pending|processing|complete|failed
 * Only `crawl_jobs` can say `cancelled`. Elsewhere a cancel is `failed` with
 * the reason recorded where that table keeps one (`error`, or
 * `result_json.error` for snapshots — the orchestrator's own failure shape).
 *
 * "STUCK" = an active status whose run began (or, never started, was
 * created) more than 30 minutes ago. `updated_at` is not used: nothing in
 * the workers bumps it on progress, so it would say nothing extra.
 *
 * WHAT A CANCEL DOES AND DOES NOT DO
 * It moves the ROW to a terminal status (conditionally — only from an
 * active status, so a job that finished meanwhile is left alone and the
 * caller gets 409). It cannot stop a worker that is genuinely still
 * running: the queue is in-process (`InMemoryJobQueue`) and has no cancel
 * hook, so a live worker's final unconditional write could still land
 * afterwards. In practice the jobs staff cancel are the ones whose worker
 * died with its serverless instance — which is exactly why they are stuck.
 * RETRY is out of scope for Phase 1 for the same reason: re-enqueueing on a
 * non-durable queue has no reliable semantics (see DECISIONS.md §31).
 *
 * The UPDATE goes through `platformDb` (cross-tenant, column-level UPDATE
 * grants only — scripts/create-platform-role.sql); the `audit_events` row
 * goes through the normal writer, attributed to the job's org.
 */

export const JOB_TYPES = ['crawl', 'ai_run', 'agent_run', 'snapshot'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const STUCK_AFTER_MINUTES = 30;
export const CANCEL_REASON = 'Cancelled by platform staff';

interface JobTypeSpec {
  table: string;
  activeStatuses: readonly string[];
  allStatuses: readonly string[];
  cancelStatus: string;
  /** SELECT list producing the unified row shape (see `UNIFIED_COLUMNS`). */
  select: string;
  /** Column holding the owning org (nullable for snapshots). */
  orgColumn: string;
  /** Expression for "when did this start being active". */
  activeSince: string;
}

export const JOB_SPECS: Record<JobType, JobTypeSpec> = {
  crawl: {
    table: 'crawl_jobs',
    activeStatuses: ['queued', 'running'],
    allStatuses: ['queued', 'running', 'completed', 'failed', 'cancelled'],
    cancelStatus: 'cancelled',
    orgColumn: 'organization_id',
    activeSince: 'COALESCE(started_at, created_at)',
    select: `SELECT 'crawl'::text AS type, id, organization_id, status::text AS status, root_url::text AS label, error,
       created_at, started_at, completed_at,
       pages_crawled AS done, pages_found AS total, pages_failed AS failed,
       COALESCE(started_at, created_at) AS active_since
  FROM crawl_jobs`,
  },
  ai_run: {
    table: 'ai_runs',
    activeStatuses: ['queued', 'running'],
    allStatuses: ['queued', 'running', 'completed', 'failed'],
    cancelStatus: 'failed',
    orgColumn: 'organization_id',
    activeSince: 'COALESCE(started_at, created_at)',
    select: `SELECT 'ai_run'::text AS type, id, organization_id, status::text AS status,
       (CASE WHEN competitor_id IS NULL THEN 'brand' ELSE 'competitor' END) || ': ' || array_to_string(providers, ', ') AS label,
       error, created_at, started_at, completed_at,
       completed_jobs AS done, total_jobs AS total, failed_jobs AS failed,
       COALESCE(started_at, created_at) AS active_since
  FROM ai_runs`,
  },
  agent_run: {
    table: 'agent_runs',
    activeStatuses: ['queued', 'running'],
    allStatuses: ['queued', 'running', 'completed', 'failed'],
    cancelStatus: 'failed',
    orgColumn: 'organization_id',
    activeSince: 'COALESCE(started_at, created_at)',
    select: `SELECT 'agent_run'::text AS type, id, organization_id, status::text AS status, agent_name::text AS label,
       error, created_at, started_at, completed_at,
       steps_completed AS done, total_steps AS total, NULL::int AS failed,
       COALESCE(started_at, created_at) AS active_since
  FROM agent_runs`,
  },
  snapshot: {
    table: 'snapshot_requests',
    activeStatuses: ['pending', 'processing'],
    allStatuses: ['pending', 'processing', 'complete', 'failed'],
    cancelStatus: 'failed',
    orgColumn: 'converted_to_org_id',
    activeSince: 'created_at',
    select: `SELECT 'snapshot'::text AS type, id, converted_to_org_id AS organization_id, status::text AS status, domain::text AS label,
       (CASE WHEN status = 'failed' THEN result_json->>'error' END) AS error,
       created_at, NULL::timestamptz AS started_at,
       (CASE WHEN status IN ('complete', 'failed') THEN updated_at END) AS completed_at,
       NULL::int AS done, NULL::int AS total, NULL::int AS failed,
       created_at AS active_since
  FROM snapshot_requests`,
  },
};

const ALL_STATUSES = [...new Set(Object.values(JOB_SPECS).flatMap((s) => s.allStatuses))];

function sqlList(values: readonly string[]): string {
  // Constants from JOB_SPECS only — never user input.
  return values.map((v) => `'${v}'`).join(', ');
}

/** The "is stuck" predicate for one job type, as SQL over that table. */
export function stuckPredicate(type: JobType): string {
  const spec = JOB_SPECS[type];
  return `status::text IN (${sqlList(spec.activeStatuses)}) AND ${spec.activeSince} < now() - interval '${STUCK_AFTER_MINUTES} minutes'`;
}

export interface PlatformJob {
  type: JobType;
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  status: string;
  /** crawl: root URL · ai_run: "brand|competitor: providers" · agent_run: agent name · snapshot: domain */
  label: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** crawl: pages crawled/found/failed · ai_run: jobs completed/total/failed · agent_run: steps done/total · snapshot: null */
  progress: { done: number; total: number | null; failed: number | null } | null;
  stuck: boolean;
  cancellable: boolean;
}

interface JobRow {
  type: JobType;
  id: string;
  organization_id: string | null;
  org_name: string | null;
  org_slug: string | null;
  status: string;
  label: string | null;
  error: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  done: number | null;
  total: number | null;
  failed: number | null;
  stuck: boolean;
}

function toJob(row: JobRow): PlatformJob {
  const spec = JOB_SPECS[row.type];
  return {
    type: row.type,
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.org_name,
    organizationSlug: row.org_slug,
    status: row.status,
    label: row.label,
    error: row.error,
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    progress: row.done === null ? null : { done: num(row.done), total: row.total === null ? null : num(row.total), failed: row.failed === null ? null : num(row.failed) },
    stuck: row.stuck,
    cancellable: spec.activeStatuses.includes(row.status),
  };
}

const jobs = new Hono<AppEnv>();

jobs.get('/', ...platformGuard('support'), async (c) => {
  const page = parsePage(c);
  if (isPageError(page)) return c.json({ error: page.error }, 422);

  const type = c.req.query('type');
  if (type && !(JOB_TYPES as readonly string[]).includes(type)) {
    return c.json({ error: `type must be one of ${JOB_TYPES.join(', ')}` }, 422);
  }
  const status = c.req.query('status');
  if (status && !ALL_STATUSES.includes(status)) {
    return c.json({ error: `status must be one of ${ALL_STATUSES.join(', ')}` }, 422);
  }
  const orgId = c.req.query('orgId');
  if (orgId && !isUuid(orgId)) return c.json({ error: 'orgId must be a UUID' }, 422);
  const stuck = c.req.query('stuck') === 'true';

  const params = new SqlParams();
  const statusParam = status ? params.add(status) : null;
  const orgParam = orgId ? params.add(orgId) : null;

  const types = (type ? [type] : JOB_TYPES) as JobType[];
  const branches = types
    .filter((t) => !status || JOB_SPECS[t].allStatuses.includes(status))
    .map((t) => {
      const spec = JOB_SPECS[t];
      const where: string[] = [];
      if (statusParam) where.push(`status::text = ${statusParam}`);
      if (orgParam) where.push(`${spec.orgColumn} = ${orgParam}::uuid`);
      if (stuck) where.push(stuckPredicate(t));
      // `stuck` is computed on the branch's unified row (status +
      // active_since), the filter above on the table's own columns.
      return `SELECT b_${t}.*, (${unifiedStuck(t)}) AS stuck FROM (${spec.select}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}) b_${t}`;
    });

  if (branches.length === 0) {
    return c.json({ items: [], total: 0, limit: page.limit, offset: page.offset } satisfies Paginated<PlatformJob>);
  }

  const unified = branches.join('\nUNION ALL\n');

  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);

  const [rows, countRows] = await Promise.all([
    platformDb.$queryRawUnsafe<JobRow[]>(
      `SELECT u.*, o.name AS org_name, o.slug AS org_slug
         FROM (${unified}) u
         LEFT JOIN organizations o ON o.id = u.organization_id
        ORDER BY u.created_at DESC, u.id
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      ...params.values,
    ),
    platformDb.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM (${unified}) u`,
      ...params.values.slice(0, params.values.length - 2),
    ),
  ]);

  return c.json({
    items: rows.map(toJob),
    total: num(countRows[0]?.n),
    limit: page.limit,
    offset: page.offset,
  } satisfies Paginated<PlatformJob>);
});

/** Stuck predicate over the unified row's `status`/`active_since`. */
function unifiedStuck(type: JobType): string {
  return `status IN (${sqlList(JOB_SPECS[type].activeStatuses)}) AND active_since < now() - interval '${STUCK_AFTER_MINUTES} minutes'`;
}

export interface CancelJobResponse {
  type: JobType;
  id: string;
  previousStatus: string;
  status: string;
  error: string;
}

jobs.post('/:type/:id/cancel', ...platformGuard('admin'), async (c) => {
  const type = c.req.param('type') as JobType;
  const id = c.req.param('id');
  if (!(JOB_TYPES as readonly string[]).includes(type) || !isUuid(id)) {
    return c.json({ error: 'Job not found' }, 404);
  }
  const spec = JOB_SPECS[type];
  const now = new Date();

  const current = await loadJob(type, id);
  if (!current) return c.json({ error: 'Job not found' }, 404);
  if (!spec.activeStatuses.includes(current.status)) {
    return c.json({ error: 'Only a queued or running job can be cancelled', status: current.status }, 409);
  }

  const active = spec.activeStatuses;
  let updated: number;
  switch (type) {
    case 'crawl':
      updated = (
        await platformDb.crawl_jobs.updateMany({
          where: { id, status: { in: active as ('queued' | 'running')[] } },
          data: { status: 'cancelled', error: CANCEL_REASON, completed_at: now, updated_at: now },
        })
      ).count;
      break;
    case 'ai_run':
      updated = (
        await platformDb.ai_runs.updateMany({
          where: { id, status: { in: [...active] } },
          data: { status: 'failed', error: CANCEL_REASON, completed_at: now, updated_at: now },
        })
      ).count;
      break;
    case 'agent_run':
      updated = (
        await platformDb.agent_runs.updateMany({
          where: { id, status: { in: [...active] } },
          data: { status: 'failed', error: CANCEL_REASON, completed_at: now, updated_at: now },
        })
      ).count;
      break;
    case 'snapshot':
      updated = (
        await platformDb.snapshot_requests.updateMany({
          where: { id, status: { in: active as ('pending' | 'processing')[] } },
          data: { status: 'failed', result_json: { error: CANCEL_REASON }, updated_at: now },
        })
      ).count;
      break;
  }

  if (updated === 0) {
    // Finished (or was cancelled by someone else) between the read and the write.
    const after = await loadJob(type, id);
    return c.json({ error: 'Only a queued or running job can be cancelled', status: after?.status ?? null }, 409);
  }

  const user = c.get('user');
  await writeAuditEvent({
    userId: user.id,
    organizationId: current.organizationId,
    actorType: 'user',
    actorRole: `platform_${c.get('platformRole')}`,
    action: 'platform.job_cancelled',
    entityType: spec.table,
    entityId: id,
    ipAddress: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
    result: 'success',
    oldValue: { status: current.status },
    newValue: { status: spec.cancelStatus, error: CANCEL_REASON },
    details: { via: 'platform', jobType: type },
  });

  return c.json({
    type,
    id,
    previousStatus: current.status,
    status: spec.cancelStatus,
    error: CANCEL_REASON,
  } satisfies CancelJobResponse);
});

async function loadJob(type: JobType, id: string): Promise<{ status: string; organizationId: string | null } | null> {
  switch (type) {
    case 'crawl': {
      const row = await platformDb.crawl_jobs.findUnique({ where: { id }, select: { status: true, organization_id: true } });
      return row && { status: row.status, organizationId: row.organization_id };
    }
    case 'ai_run': {
      const row = await platformDb.ai_runs.findUnique({ where: { id }, select: { status: true, organization_id: true } });
      return row && { status: row.status, organizationId: row.organization_id };
    }
    case 'agent_run': {
      const row = await platformDb.agent_runs.findUnique({ where: { id }, select: { status: true, organization_id: true } });
      return row && { status: row.status, organizationId: row.organization_id };
    }
    case 'snapshot': {
      const row = await platformDb.snapshot_requests.findUnique({
        where: { id },
        select: { status: true, converted_to_org_id: true },
      });
      return row && { status: row.status, organizationId: row.converted_to_org_id };
    }
  }
}

export default jobs;
