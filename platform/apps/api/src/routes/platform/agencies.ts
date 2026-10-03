import { Hono } from 'hono';
import { platformDb } from '@bebest/database/platform';
import { escapeLike } from '../../lib/crm-validation.js';
import { uuidParam } from '../../lib/http-params.js';
import type { AppEnv } from '../../types/context.js';
import { isPageError, iso, json, num, pagedQuery, parsePage, platformGuard, searchTerm, SqlParams, type Paginated } from './shared.js';

/**
 * Epic 22 Phase 1 — Agencies (support).
 *
 *   GET /api/platform/agencies?q&limit&offset
 *   GET /api/platform/agencies/:id/clients?status&limit&offset
 *
 * An agency is `organizations.kind = 'agency'` (DECISIONS.md §30 — the
 * column is the source of truth). `/agencies/:id/clients` lists the links
 * of ANY org id, kind notwithstanding: a link can exist before (or after)
 * an org's kind says agency, and staff investigating one should see it.
 */

export const AGENCY_LINK_STATUSES = ['pending', 'active', 'paused', 'terminated', 'revoked'] as const;

export interface PlatformAgencyListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  memberCount: number;
  createdAt: string;
  /** count of non-deleted agency_clients links by link status (only statuses present appear) */
  clientCounts: Record<string, number>;
  totalClients: number;
}

export interface PlatformAgencyClient {
  linkId: string;
  status: string;
  accessLevel: string;
  relationshipType: string;
  consentedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  client: { id: string; name: string; slug: string; kind: string; status: string; deletedAt: string | null };
}

export interface PlatformAgencyClientsResponse extends Paginated<PlatformAgencyClient> {
  agency: { id: string; name: string; slug: string; kind: string };
}

const agencies = new Hono<AppEnv>();

agencies.get('/', ...platformGuard('support'), async (c) => {
  const page = parsePage(c);
  if (isPageError(page)) return c.json({ error: page.error }, 422);
  const q = searchTerm(c);

  const params = new SqlParams();
  const where = ["o.kind = 'agency'", 'o.deleted_at IS NULL'];
  if (q) {
    const like = params.add(`%${escapeLike(q)}%`);
    where.push(`(o.name ILIKE ${like} OR o.slug ILIKE ${like})`);
  }

  const { rows, total } = await pagedQuery<{
    id: string;
    name: string;
    slug: string;
    status: string;
    created_at: Date | string;
    plan: string | null;
    member_count: number;
    client_counts: unknown;
  }>(platformDb, params, page, {
    filtered: `SELECT o.id, o.name, o.slug, o.status, o.created_at, s.plan
                 FROM organizations o LEFT JOIN subscriptions s ON s.organization_id = o.id
                WHERE ${where.join(' AND ')}`,
    orderBy: 'created_at DESC, id',
    enrich: `(SELECT count(*)::int FROM memberships m WHERE m.organization_id = p.id) AS member_count,
             (SELECT COALESCE(json_object_agg(status, n), '{}'::json) FROM (
                SELECT status, count(*)::int AS n FROM agency_clients
                 WHERE agency_org_id = p.id AND deleted_at IS NULL GROUP BY status) g) AS client_counts`,
  });

  const items: PlatformAgencyListItem[] = rows.map((r) => {
    const clientCounts = json<Record<string, number>>(r.client_counts) ?? {};
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      plan: r.plan,
      memberCount: num(r.member_count),
      createdAt: iso(r.created_at)!,
      clientCounts,
      totalClients: Object.values(clientCounts).reduce((a, b) => a + b, 0),
    };
  });

  return c.json({ items, total, limit: page.limit, offset: page.offset } satisfies Paginated<PlatformAgencyListItem>);
});

agencies.get('/:id/clients', ...platformGuard('support', { targetOrgParam: 'id' }), async (c) => {
  const id = uuidParam(c, 'id');
  if (!id) return c.json({ error: 'Agency not found' }, 404);
  const page = parsePage(c);
  if (isPageError(page)) return c.json({ error: page.error }, 422);
  const status = c.req.query('status');
  if (status && !(AGENCY_LINK_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: `status must be one of ${AGENCY_LINK_STATUSES.join(', ')}` }, 422);
  }

  const params = new SqlParams();
  const idP = params.add(id);
  const where = [`l.agency_org_id = ${idP}::uuid`, 'l.deleted_at IS NULL'];
  if (status) where.push(`l.status = ${params.add(status)}`);

  type Row = {
    id: string;
    status: string;
    access_level: string;
    relationship_type: string;
    consented_at: Date | string | null;
    revoked_at: Date | string | null;
    created_at: Date | string;
    client_id: string;
    client_name: string;
    client_slug: string;
    client_kind: string;
    client_status: string;
    client_deleted_at: Date | string | null;
  };

  // Page + agency lookup in parallel: one wave.
  const [agency, { rows, total }] = await Promise.all([
    platformDb.organizations.findUnique({ where: { id }, select: { id: true, name: true, slug: true, kind: true } }),
    pagedQuery<Row>(platformDb, params, page, {
      filtered: `SELECT l.id, l.status, l.access_level, l.relationship_type, l.consented_at, l.revoked_at, l.created_at,
                        o.id AS client_id, o.name AS client_name, o.slug AS client_slug, o.kind AS client_kind,
                        o.status AS client_status, o.deleted_at AS client_deleted_at
                   FROM agency_clients l JOIN organizations o ON o.id = l.client_org_id
                  WHERE ${where.join(' AND ')}`,
      orderBy: 'created_at DESC, id',
    }),
  ]);
  if (!agency) return c.json({ error: 'Agency not found' }, 404);

  const items: PlatformAgencyClient[] = rows.map((l) => ({
    linkId: l.id,
    status: l.status,
    accessLevel: l.access_level,
    relationshipType: l.relationship_type,
    consentedAt: iso(l.consented_at),
    revokedAt: iso(l.revoked_at),
    createdAt: iso(l.created_at)!,
    client: {
      id: l.client_id,
      name: l.client_name,
      slug: l.client_slug,
      kind: l.client_kind,
      status: l.client_status,
      deletedAt: iso(l.client_deleted_at),
    },
  }));

  return c.json({ agency, items, total, limit: page.limit, offset: page.offset } satisfies PlatformAgencyClientsResponse);
});

export default agencies;
