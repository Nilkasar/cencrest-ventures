import { Hono } from 'hono';
import { platformDb } from '@bebest/database/platform';
import { escapeLike } from '../../lib/crm-validation.js';
import { isUuid } from '../../lib/http-params.js';
import type { AppEnv } from '../../types/context.js';
import { isPageError, iso, num, parsePage, platformGuard, SqlParams, type Paginated } from './shared.js';

/**
 * Epic 22 Phase 1 — `GET /api/platform/audit` (support).
 *
 *   ?orgId&userId&action&source=app|platform&from&to&limit&offset
 *
 * One time-ordered feed over the two audit trails:
 *   - `audit_events` (source `app`): what people and agents DID — customer
 *     actions, auth, and staff mutations made from the Platform view
 *     (`platform.job_cancelled`, `platform.magic_link_sent`).
 *   - `platform_access_events` (source `platform`): every Platform API call,
 *     reads included — who looked at what.
 * `orgId` matches `audit_events.organization_id` / `platform_access_events
 * .target_org_id`; `userId` matches the ACTOR on both. `action` is a
 * case-insensitive substring (LIKE metacharacters escaped). `from`/`to`
 * are ISO-8601 instants, `from` inclusive, `to` exclusive.
 *
 * Each branch is ordered and cut to `offset + limit` before the merge, so a
 * page never sorts more than that many rows per table.
 */

export const AUDIT_SOURCES = ['app', 'platform'] as const;

export interface PlatformAuditItem {
  source: 'app' | 'platform';
  id: string;
  createdAt: string;
  /** the actor */
  userId: string | null;
  userEmail: string | null;
  /** app: audit_events.organization_id · platform: target_org_id */
  organizationId: string | null;
  organizationName: string | null;
  /** app: e.g. "auth.login" · platform: "<METHOD> <route pattern>" */
  action: string;
  /** app-only fields (null for platform rows) */
  entityType: string | null;
  entityId: string | null;
  actorType: string | null;
  actorRole: string | null;
  result: string | null;
  details: Record<string, unknown> | null;
  /** platform-only fields (null for app rows) */
  platformRole: string | null;
  method: string | null;
  path: string | null;
  targetUserId: string | null;
}

interface AuditRow {
  source: 'app' | 'platform';
  id: string;
  created_at: Date | string;
  user_id: string | null;
  user_email: string | null;
  organization_id: string | null;
  org_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_type: string | null;
  actor_role: string | null;
  result: string | null;
  details: unknown;
  platform_role: string | null;
  method: string | null;
  path: string | null;
  target_user_id: string | null;
}

function parseInstant(value: string | undefined): Date | null | 'invalid' {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 'invalid' : new Date(t);
}

const audit = new Hono<AppEnv>();

audit.get('/', ...platformGuard('support'), async (c) => {
  const page = parsePage(c);
  if (isPageError(page)) return c.json({ error: page.error }, 422);

  const orgId = c.req.query('orgId');
  const userId = c.req.query('userId');
  const action = c.req.query('action')?.trim().slice(0, 200);
  const source = c.req.query('source');
  const from = parseInstant(c.req.query('from'));
  const to = parseInstant(c.req.query('to'));
  if (orgId && !isUuid(orgId)) return c.json({ error: 'orgId must be a UUID' }, 422);
  if (userId && !isUuid(userId)) return c.json({ error: 'userId must be a UUID' }, 422);
  if (source && !(AUDIT_SOURCES as readonly string[]).includes(source)) {
    return c.json({ error: `source must be one of ${AUDIT_SOURCES.join(', ')}` }, 422);
  }
  if (from === 'invalid' || to === 'invalid') return c.json({ error: 'from/to must be ISO-8601 timestamps' }, 422);

  const params = new SqlParams();
  const p = {
    org: orgId ? params.add(orgId) : null,
    user: userId ? params.add(userId) : null,
    action: action ? params.add(`%${escapeLike(action)}%`) : null,
    from: from ? params.add(from.toISOString()) : null,
    to: to ? params.add(to.toISOString()) : null,
  };
  const filterValues = [...params.values];

  function where(orgCol: string): string {
    const w: string[] = [];
    if (p.org) w.push(`${orgCol} = ${p.org}::uuid`);
    if (p.user) w.push(`user_id = ${p.user}::uuid`);
    if (p.action) w.push(`action ILIKE ${p.action}`);
    if (p.from) w.push(`created_at >= ${p.from}::timestamptz`);
    if (p.to) w.push(`created_at < ${p.to}::timestamptz`);
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }

  const appBranch = `SELECT 'app'::text AS source, id, created_at, user_id, organization_id, action::text AS action,
       entity_type::text AS entity_type, entity_id, actor_type::text AS actor_type, actor_role::text AS actor_role,
       result::text AS result, details::jsonb AS details,
       NULL::text AS platform_role, NULL::text AS method, NULL::text AS path, NULL::uuid AS target_user_id
  FROM audit_events ${where('organization_id')}`;
  const platformBranch = `SELECT 'platform'::text AS source, id, created_at, user_id, target_org_id AS organization_id, action::text AS action,
       NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::jsonb,
       platform_role::text, method::text, request_path, target_user_id
  FROM platform_access_events ${where('target_org_id')}`;

  const branches = [
    ...(source !== 'platform' ? [appBranch] : []),
    ...(source !== 'app' ? [platformBranch] : []),
  ];

  const cut = params.add(page.offset + page.limit);
  const limitP = params.add(page.limit);
  const offsetP = params.add(page.offset);

  const pageSql = `SELECT e.*, u.email AS user_email, o.name AS org_name
    FROM (${branches.map((b) => `(${b} ORDER BY created_at DESC, id LIMIT ${cut})`).join(' UNION ALL ')}) e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN organizations o ON o.id = e.organization_id
   ORDER BY e.created_at DESC, e.id
   LIMIT ${limitP} OFFSET ${offsetP}`;
  const countSql = `SELECT (${branches.map((b) => `(SELECT count(*) FROM (${b}) x)`).join(' + ')})::int AS n`;

  const [rows, countRows] = await Promise.all([
    platformDb.$queryRawUnsafe<AuditRow[]>(pageSql, ...params.values),
    platformDb.$queryRawUnsafe<{ n: number }[]>(countSql, ...filterValues),
  ]);

  const items: PlatformAuditItem[] = rows.map((r) => ({
    source: r.source,
    id: r.id,
    createdAt: iso(r.created_at)!,
    userId: r.user_id,
    userEmail: r.user_email,
    organizationId: r.organization_id,
    organizationName: r.org_name,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorType: r.actor_type,
    actorRole: r.actor_role,
    result: r.result,
    details: (typeof r.details === 'string' ? JSON.parse(r.details) : r.details) as Record<string, unknown> | null,
    platformRole: r.platform_role,
    method: r.method,
    path: r.path,
    targetUserId: r.target_user_id,
  }));

  return c.json({ items, total: num(countRows[0]?.n), limit: page.limit, offset: page.offset } satisfies Paginated<PlatformAuditItem>);
});

export default audit;
