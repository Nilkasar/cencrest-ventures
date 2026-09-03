/**
 * Epic 15 (Reporting & Notifications) — `GET /brands/:id/reports` and
 * `POST /brands/:id/reports/generate`, the spec's literal routes, adapted
 * to `/brands/me/reports`, the same single-brand-per-org convention every
 * Epic 2+ route in `app.ts` already uses.
 *
 * `createReportsRoutes(emailSender)` — a factory, not a bare default export
 * — because `POST /generate` calls the shared `notify()` function, which
 * needs a real `EmailSender` for the email channel; same "factory takes
 * the app's one EmailSender" precedent `routes/auth.ts`/`routes/
 * snapshot.ts` already establish (see `app.ts`'s "Single EmailSender
 * construction site" comment).
 *
 * `POST /generate` accepts all four report types (`weekly|monthly|custom|
 * baseline_comparison`) — see `lib/reporting/generate-report.ts`'s own
 * header comment for why one manual-trigger endpoint covers types the spec
 * describes as "automated" too: this codebase has no live scheduler yet.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { generateReport } from '../lib/reporting/generate-report.js';
import { notifyForGeneratedReport } from '../lib/reporting/notify-for-report.js';
import { serializeReport, serializeReportSummary } from '../lib/reporting/serialize.js';
import type { EmailSender } from '../lib/email.js';
import type { AppEnv } from '../types/context.js';

const VIEW = 'view_intelligence' as const;
// Report generation is a compute/write action over already-computed data —
// same permission `POST /brands/me/opportunities/recompute` (Epic 9) uses
// for the identical shape of "trigger an aggregation, not a content edit."
const MUTATE = 'create_brand_profile' as const;

const REPORT_TYPES = ['weekly', 'monthly', 'custom', 'baseline_comparison'] as const;

const listQuerySchema = z.object({
  type: z.enum(REPORT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const generateBodySchema = z
  .object({
    type: z.enum(REPORT_TYPES),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
  })
  .refine((data) => data.type !== 'custom' || (data.periodStart && data.periodEnd), {
    message: 'periodStart and periodEnd are required for a custom report.',
    path: ['periodStart'],
  });

export function createReportsRoutes(emailSender: EmailSender) {
  const reportsRoute = new Hono<AppEnv>();

  reportsRoute.get('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    const { type, limit, offset } = parsed.data;

    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const where = { organization_id: org.organizationId, brand_id: brand.id, ...(type ? { type } : {}) };

    const [total, rows] = await withOrgContext(org.organizationId, (tx) =>
      Promise.all([
        tx.reports.count({ where }),
        tx.reports.findMany({ where, orderBy: { generated_at: 'desc' }, skip: offset, take: limit }),
      ]),
    );

    return c.json({ items: rows.map(serializeReportSummary), total, limit, offset });
  });

  reportsRoute.post('/generate', requireAuth, requireOrgFromToken('viewer'), requirePermission(MUTATE), async (c) => {
    const parsed = generateBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    const { type, periodStart, periodEnd } = parsed.data;

    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const row = await generateReport({
      organizationId: org.organizationId,
      brandId: brand.id,
      type,
      periodStart: periodStart ? new Date(periodStart) : undefined,
      periodEnd: periodEnd ? new Date(periodEnd) : undefined,
      createdBy: user.id,
    });

    await notifyForGeneratedReport(row, { emailSender });

    return c.json({ report: serializeReport(row) }, 201);
  });

  return reportsRoute;
}

export default createReportsRoutes;
