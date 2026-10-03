import { Hono } from 'hono';
import { platformDb } from '@bebest/database/platform';
import type { AppEnv } from '../../types/context.js';
import { isPageError, iso, num, parsePage, platformGuard, SqlParams, type Paginated } from './shared.js';

/**
 * Epic 22 Phase 1 — Growth: free-snapshot requests (support).
 *
 *   GET /api/platform/growth/snapshots?status&limit&offset
 *
 * `snapshot_requests` is a pre-signup public table (no tenant) joined to the
 * CRM lead created from it (`leads.snapshot_id`, internal org). Only the
 * headline numbers are pulled out of `result_json` in SQL — the full report
 * stays where it is (`GET /api/snapshot/:token`). The requester's IP is
 * deliberately not returned.
 */

export const SNAPSHOT_STATUSES = ['pending', 'processing', 'complete', 'failed'] as const;

export interface PlatformSnapshotRequest {
  id: string;
  domain: string;
  email: string;
  status: string;
  marketingConsent: boolean;
  /** result_json.aiVisibility.score (complete only) */
  aiVisibilityScore: number | null;
  /** result_json.error (failed only) */
  error: string | null;
  convertedToOrgId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lead: { id: string; name: string; email: string; company: string | null; status: string; createdAt: string } | null;
}

interface Row {
  id: string;
  domain: string;
  email: string;
  status: string;
  marketing_consent: boolean;
  score: string | number | null;
  error: string | null;
  converted_to_org_id: string | null;
  converted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string;
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_company: string | null;
  lead_status: string | null;
  lead_created_at: Date | string | null;
}

const growth = new Hono<AppEnv>();

growth.get('/snapshots', ...platformGuard('support'), async (c) => {
  const page = parsePage(c);
  if (isPageError(page)) return c.json({ error: page.error }, 422);
  const status = c.req.query('status');
  if (status && !(SNAPSHOT_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: `status must be one of ${SNAPSHOT_STATUSES.join(', ')}` }, 422);
  }

  const params = new SqlParams();
  const where = status ? `WHERE s.status::text = ${params.add(status)}` : '';
  const filterValues = [...params.values];
  const limitP = params.add(page.limit);
  const offsetP = params.add(page.offset);

  const [rows, countRows] = await Promise.all([
    platformDb.$queryRawUnsafe<Row[]>(
      `SELECT s.id, s.domain, s.email, s.status::text AS status, s.marketing_consent,
              (CASE WHEN s.status = 'complete' THEN s.result_json->'aiVisibility'->>'score' END) AS score,
              (CASE WHEN s.status = 'failed' THEN s.result_json->>'error' END) AS error,
              s.converted_to_org_id, s.converted_at, s.created_at, s.updated_at, s.expires_at,
              l.id AS lead_id, l.name AS lead_name, l.email AS lead_email, l.company AS lead_company,
              l.status::text AS lead_status, l.created_at AS lead_created_at
         FROM snapshot_requests s
         LEFT JOIN LATERAL (
           SELECT id, name, email, company, status, created_at FROM leads
            WHERE snapshot_id = s.id AND deleted_at IS NULL
            ORDER BY created_at LIMIT 1
         ) l ON true
        ${where}
        ORDER BY s.created_at DESC, s.id
        LIMIT ${limitP} OFFSET ${offsetP}`,
      ...params.values,
    ),
    platformDb.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM snapshot_requests s ${where}`, ...filterValues),
  ]);

  const items: PlatformSnapshotRequest[] = rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    email: r.email,
    status: r.status,
    marketingConsent: r.marketing_consent,
    aiVisibilityScore: r.score === null || r.score === '' ? null : Number(r.score),
    error: r.error,
    convertedToOrgId: r.converted_to_org_id,
    convertedAt: iso(r.converted_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    expiresAt: iso(r.expires_at)!,
    lead: r.lead_id
      ? {
          id: r.lead_id,
          name: r.lead_name ?? '',
          email: r.lead_email ?? '',
          company: r.lead_company,
          status: r.lead_status ?? 'new',
          createdAt: iso(r.lead_created_at)!,
        }
      : null,
  }));

  return c.json({ items, total: num(countRows[0]?.n), limit: page.limit, offset: page.offset } satisfies Paginated<PlatformSnapshotRequest>);
});

export default growth;
