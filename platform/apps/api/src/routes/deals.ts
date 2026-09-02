import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import type { AppEnv } from '../types/context.js';

const deals = new Hono<AppEnv>();

const DEAL_STAGES = ['new', 'qualifying', 'proposal', 'negotiation', 'won', 'lost'] as const;

// ── Create ───────────────────────────────────────────────────────────────
const createDealSchema = z.object({
  title: z.string().min(1).max(255),
  valueCents: z.number().int().min(0).default(0),
  currency: z.string().length(3).default('USD'),
  stage: z.enum(DEAL_STAGES).default('new'),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.coerce.date().optional(),
  ownerId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  accountOrganizationId: z.string().uuid().optional(),
  lostReason: z.string().optional(),
});

deals.post(
  '/',
  requireAuth,
  requireCrmAccess('viewer'),
  requirePermission('manage_deals'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createDealSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const user = c.get('user');
    const internalOrgId = getInternalOrgId();

    const created = await withOrgContext(internalOrgId, async (tx) => {
      let accountOrganizationId = parsed.data.accountOrganizationId ?? null;

      if (parsed.data.leadId) {
        const lead = await tx.leads.findFirst({
          where: { id: parsed.data.leadId, deleted_at: null },
        });
        if (!lead) throw new NotFoundError('leadId does not refer to an existing lead');
        // If the caller didn't say which account this deal belongs to but
        // the lead has already converted, inherit it — a deal against an
        // already-converted lead obviously belongs to that account too.
        if (!accountOrganizationId && lead.converted_organization_id) {
          accountOrganizationId = lead.converted_organization_id;
        }
      }

      return tx.deals.create({
        data: {
          organization_id: internalOrgId,
          lead_id: parsed.data.leadId ?? null,
          account_organization_id: accountOrganizationId,
          title: parsed.data.title,
          value_cents: parsed.data.valueCents,
          currency: parsed.data.currency,
          stage: parsed.data.stage,
          probability: parsed.data.probability ?? null,
          expected_close_date: parsed.data.expectedCloseDate ?? null,
          owner_id: parsed.data.ownerId,
          lost_reason: parsed.data.lostReason ?? null,
          created_by: user.id,
        },
      });
    }).catch((err) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });

    if (!created) return c.json({ error: 'leadId does not refer to an existing lead' }, 404);
    return c.json(serializeDeal(created), 201);
  },
);

// ── List (paginated, filterable by stage/owner) ─────────────────────────
deals.get('/', requireAuth, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const query = z
    .object({
      stage: z.enum(DEAL_STAGES).optional(),
      ownerId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

  if (!query.success) {
    return c.json({ error: 'Validation failed', issues: query.error.issues }, 422);
  }

  const { stage, ownerId, page, limit } = query.data;
  const where = {
    deleted_at: null,
    ...(stage ? { stage } : {}),
    ...(ownerId ? { owner_id: ownerId } : {}),
  };

  const [items, total] = await withOrgContext(internalOrgId, (tx) =>
    Promise.all([
      tx.deals.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.deals.count({ where }),
    ]),
  );

  return c.json({ data: items.map(serializeDeal), page, limit, total });
});

// ── Get one ──────────────────────────────────────────────────────────────
deals.get('/:id', requireAuth, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const id = c.req.param('id');

  const deal = await withOrgContext(internalOrgId, (tx) =>
    tx.deals.findFirst({ where: { id, deleted_at: null } }),
  );
  if (!deal) return c.json({ error: 'Deal not found' }, 404);

  return c.json(serializeDeal(deal));
});

// ── Update (every field EXCEPT stage) ───────────────────────────────────
// Stage transitions always go through POST /:id/stage below so they are
// ALWAYS audited (docs/epics/01-crm.md: "treat 'moved a $65k deal to Won' as
// privileged"). Letting this endpoint also silently accept a `stage` field
// would create an unaudited back door for the exact action the spec calls
// out — `.strict()` below rejects the payload outright if one is sent,
// rather than silently ignoring it, so the mistake is loud, not silent.
const updateDealSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    valueCents: z.number().int().min(0).optional(),
    currency: z.string().length(3).optional(),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    expectedCloseDate: z.coerce.date().nullable().optional(),
    ownerId: z.string().uuid().optional(),
    leadId: z.string().uuid().nullable().optional(),
    accountOrganizationId: z.string().uuid().nullable().optional(),
    lostReason: z.string().nullable().optional(),
  })
  .strict();

deals.patch(
  '/:id',
  requireAuth,
  requireCrmAccess('viewer'),
  requirePermission('manage_deals'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateDealSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const internalOrgId = getInternalOrgId();
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await withOrgContext(internalOrgId, (tx) =>
      tx.deals.findFirst({ where: { id, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Deal not found' }, 404);

    const { leadId, accountOrganizationId, ownerId, ...rest } = parsed.data;
    const updated = await withOrgContext(internalOrgId, (tx) =>
      tx.deals.update({
        where: { id },
        data: {
          ...rest,
          ...(leadId !== undefined ? { lead_id: leadId } : {}),
          ...(accountOrganizationId !== undefined
            ? { account_organization_id: accountOrganizationId }
            : {}),
          ...(ownerId !== undefined ? { owner_id: ownerId } : {}),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serializeDeal(updated));
  },
);

// ── Stage transition (the ONLY way to change stage — always audited) ────
const stageTransitionSchema = z
  .object({
    stage: z.enum(DEAL_STAGES),
    lostReason: z.string().min(1).optional(),
  })
  .refine((d) => d.stage !== 'lost' || Boolean(d.lostReason), {
    message: 'lostReason is required when moving a deal to the lost stage',
    path: ['lostReason'],
  });

deals.post(
  '/:id/stage',
  requireAuth,
  requireCrmAccess('viewer'),
  requirePermission('manage_deals'),
  auditLog({ action: 'deal.stage_changed', entityType: 'deal' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = stageTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const internalOrgId = getInternalOrgId();
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await withOrgContext(internalOrgId, (tx) =>
      tx.deals.findFirst({ where: { id, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Deal not found' }, 404);

    const updated = await withOrgContext(internalOrgId, (tx) =>
      tx.deals.update({
        where: { id },
        data: {
          stage: parsed.data.stage,
          lost_reason: parsed.data.stage === 'lost' ? (parsed.data.lostReason ?? null) : existing.lost_reason,
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serializeDeal(updated));
  },
);

class NotFoundError extends Error {}

function serializeDeal(deal: {
  id: string;
  lead_id: string | null;
  account_organization_id: string | null;
  title: string;
  value_cents: number;
  currency: string;
  stage: string;
  probability: number | null;
  expected_close_date: Date | null;
  owner_id: string;
  lost_reason: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: deal.id,
    leadId: deal.lead_id,
    accountOrganizationId: deal.account_organization_id,
    title: deal.title,
    valueCents: deal.value_cents,
    currency: deal.currency,
    stage: deal.stage,
    probability: deal.probability,
    expectedCloseDate: deal.expected_close_date,
    ownerId: deal.owner_id,
    lostReason: deal.lost_reason,
    createdAt: deal.created_at,
    updatedAt: deal.updated_at,
  };
}

export default deals;
