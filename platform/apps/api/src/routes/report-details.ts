/**
 * Epic 15 (Reporting & Notifications) — `GET /reports/:id`, the spec's
 * literal route, matching exactly: a `reports` row is addressed by its own
 * id, not a brand's, same convention `/api/ai-runs/:id`/`/api/actions/:id`
 * already use. Mounted at its own `/api/reports` base (no sibling router
 * shares it, unlike `/api/opportunities`/`/api/actions`).
 *
 * Returns the FULL immutable `content` snapshot (unlike `routes/
 * reports.ts`'s list, which returns summaries only) — this is the one read
 * path this epic's non-negotiable is about: the content returned here is
 * exactly what `generateReport` wrote, never re-derived from current live
 * data. See `lib/reporting/immutability.test.ts`.
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { serializeReport } from '../lib/reporting/serialize.js';
import type { AppEnv } from '../types/context.js';

const reportDetailsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const NOT_FOUND_ERROR = { error: 'Report not found' } as const;

// Same belt-and-suspenders scoping (`withOrgContext` RLS + explicit WHERE)
// every id-addressed route in this codebase uses — a foreign id 404s,
// never a 403 that would confirm it exists (tenant isolation).
reportDetailsRoute.get('/:id', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const reportId = c.req.param('id');

  const row = await withOrgContext(org.organizationId, (tx) =>
    tx.reports.findFirst({ where: { id: reportId, organization_id: org.organizationId } }),
  );
  if (!row) return c.json(NOT_FOUND_ERROR, 404);

  return c.json({ report: serializeReport(row) });
});

export default reportDetailsRoute;
