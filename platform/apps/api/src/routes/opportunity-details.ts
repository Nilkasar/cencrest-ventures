/**
 * Epic 9 (Opportunity Engine) — id-addressed routes: `GET /opportunities/:id`
 * (full detail + evidence trail) and `PATCH /opportunities/:id` (status
 * transitions). Same brand-agnostic, org-scoped-by-id split
 * `routes/ai-run-details.ts`/`routes/crawl-jobs.ts` already use for a row
 * addressed by its own id rather than a brand's.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import { serializeOpportunityDetail } from '../lib/opportunities/serialize.js';
import type { AppEnv } from '../types/context.js';

const opportunityDetailsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const MUTATE = 'create_brand_profile' as const;
const NOT_FOUND_ERROR = { error: 'Opportunity not found' } as const;

/** Scoped by organization_id via BOTH `withOrgContext` (RLS) and an
 * explicit WHERE clause — same belt-and-suspenders pattern
 * `routes/ai-run-details.ts`/`routes/crawl-jobs.ts` use: an id from
 * another org 404s, never a 403 that would confirm the id exists (tenant
 * isolation — this epic's end-to-end flow step 6). */
async function getOpportunity(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.unified_opportunities.findFirst({
      where: { id, organization_id: organizationId },
      include: { opportunity_evidence: { orderBy: { created_at: 'asc' } } },
    }),
  );
}

// ── GET /:id — full detail, evidence trail inlined ───────────────────────
opportunityDetailsRoute.get('/:id', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const row = await getOpportunity(org.organizationId, c.req.param('id'));
  if (!row) return c.json(NOT_FOUND_ERROR, 404);

  return c.json(serializeOpportunityDetail(row));
});

// ── PATCH /:id — status transitions (open -> in_progress -> completed/
// dismissed), audit-logged (docs/08-security/SECURITY.md's "moved a
// $65k-relevant decision" — this epic's spec calls this out by name). ────
const patchSchema = z
  .object({
    status: z.enum(['new', 'in_progress', 'completed', 'dismissed']).optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    dismissalReason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined, {
    message: 'At least one of status or priority is required',
  })
  .refine((v) => v.status !== 'dismissed' || !!v.dismissalReason, {
    message: 'dismissalReason is required when status is set to "dismissed"',
    path: ['dismissalReason'],
  });

opportunityDetailsRoute.patch(
  '/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'opportunity.status_changed', entityType: 'unified_opportunity' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.unified_opportunities.findFirst({ where: { id: c.req.param('id'), organization_id: org.organizationId } }),
    );
    if (!existing) return c.json(NOT_FOUND_ERROR, 404);

    const input = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.unified_opportunities.update({
        where: { id: existing.id },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.priority !== undefined && { priority: input.priority }),
          // Only a transition TO 'dismissed' sets the reason; transitioning
          // away from it (e.g. back to 'new') clears any stale reason —
          // same "don't leave a reason attached to a status it no longer
          // describes" instinct `deals.ts`'s `lost_reason` handling uses.
          dismissal_reason: input.status === 'dismissed' ? (input.dismissalReason ?? existing.dismissal_reason) : input.status !== undefined ? null : existing.dismissal_reason,
          updated_by: user.id,
          updated_at: new Date(),
        },
        include: { opportunity_evidence: { orderBy: { created_at: 'asc' } } },
      }),
    );

    return c.json(serializeOpportunityDetail(updated));
  },
);

export default opportunityDetailsRoute;
