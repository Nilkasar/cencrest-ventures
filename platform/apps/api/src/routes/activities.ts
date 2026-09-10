import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext, type Prisma } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { requirePermission } from '../middleware/rbac.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import { loadUserRefs, userRef, type UserRef } from '../lib/crm-users.js';
import { LIMITS } from '../lib/crm-validation.js';
import type { AppEnv } from '../types/context.js';

const activities = new Hono<AppEnv>();

const ACTIVITY_TYPES = ['note', 'email', 'call', 'snapshot_requested', 'signup'] as const;

// ── Create (note/email/call log against a lead, a deal, and/or an org) ──
const createActivitySchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES),
    subject: z.string().trim().max(LIMITS.activitySubject).optional(),
    // TEXT columns, but bounded so one request cannot store an unbounded
    // blob — see lib/crm-validation.ts.
    body: z.string().max(LIMITS.activityBody).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    leadId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    accountOrganizationId: z.string().uuid().optional(),
  })
  .strict()
  .refine((d) => Boolean(d.leadId) || Boolean(d.dealId) || Boolean(d.accountOrganizationId), {
    message: 'At least one of leadId, dealId, or accountOrganizationId is required',
  });

activities.post(
  '/',
  requireAuth,
  authenticatedRateLimit,
  requireCrmAccess('viewer'),
  requirePermission('log_crm_activities'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createActivitySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const user = c.get('user');
    const internalOrgId = getInternalOrgId();

    // The org existence check runs inside the same transaction as the
    // lead/deal checks and the insert, instead of as a separate query
    // before it — one database trip rather than two, and the parent rows
    // can no longer disappear between being validated and being referenced.
    // (`organizations` has no RLS, so reading it inside an org-scoped
    // transaction is the same read it was outside one.)
    const created = await withOrgContext(internalOrgId, async (tx) => {
      if (parsed.data.accountOrganizationId) {
        const org = await tx.organizations.findUnique({
          where: { id: parsed.data.accountOrganizationId },
        });
        if (!org || org.deleted_at) return 'unknown_organization' as const;
      }
      if (parsed.data.leadId) {
        const lead = await tx.leads.findFirst({
          where: { id: parsed.data.leadId, deleted_at: null },
        });
        if (!lead) return null;
      }
      if (parsed.data.dealId) {
        const deal = await tx.deals.findFirst({
          where: { id: parsed.data.dealId, deleted_at: null },
        });
        if (!deal) return null;
      }

      return tx.activities.create({
        data: {
          organization_id: internalOrgId,
          lead_id: parsed.data.leadId ?? null,
          deal_id: parsed.data.dealId ?? null,
          account_organization_id: parsed.data.accountOrganizationId ?? null,
          type: parsed.data.type,
          subject: parsed.data.subject ?? null,
          body: parsed.data.body ?? null,
          metadata: parsed.data.metadata as Prisma.InputJsonValue,
          actor_id: user.id,
        },
      });
    });

    if (created === 'unknown_organization') {
      return c.json(
        { error: 'accountOrganizationId does not refer to an existing organization' },
        404,
      );
    }
    if (!created) return c.json({ error: 'leadId or dealId does not refer to an existing record' }, 404);
    return c.json(serializeActivity(created, await loadUserRefs([created.actor_id])), 201);
  },
);

// ── List (by lead, deal, or org — time-ordered) ─────────────────────────
activities.get('/', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const query = z
    .object({
      leadId: z.string().uuid().optional(),
      dealId: z.string().uuid().optional(),
      accountOrganizationId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

  if (!query.success) {
    return c.json({ error: 'Validation failed', issues: query.error.issues }, 422);
  }

  const { leadId, dealId, accountOrganizationId, page, limit } = query.data;
  if (!leadId && !dealId && !accountOrganizationId) {
    return c.json(
      { error: 'At least one of leadId, dealId, or accountOrganizationId query param is required' },
      422,
    );
  }

  const where = {
    ...(leadId ? { lead_id: leadId } : {}),
    ...(dealId ? { deal_id: dealId } : {}),
    ...(accountOrganizationId ? { account_organization_id: accountOrganizationId } : {}),
  };

  const [items, total] = await withOrgContext(internalOrgId, (tx) =>
    Promise.all([
      tx.activities.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.activities.count({ where }),
    ]),
  );

  // Actors resolved in one query — see lib/crm-users.ts.
  const refs = await loadUserRefs(items.map((item) => item.actor_id));
  return c.json({ data: items.map((item) => serializeActivity(item, refs)), page, limit, total });
});

function serializeActivity(activity: {
  id: string;
  lead_id: string | null;
  deal_id: string | null;
  account_organization_id: string | null;
  type: string;
  subject: string | null;
  body: string | null;
  metadata: unknown;
  actor_id: string | null;
  created_at: Date;
}, refs: Map<string, UserRef>) {
  return {
    id: activity.id,
    leadId: activity.lead_id,
    dealId: activity.deal_id,
    accountOrganizationId: activity.account_organization_id,
    type: activity.type,
    subject: activity.subject,
    body: activity.body,
    metadata: activity.metadata,
    actorId: activity.actor_id,
    // Resolved server-side; `actorId` stays for id-only callers.
    actor: userRef(activity.actor_id, refs),
    createdAt: activity.created_at,
  };
}

export default activities;
