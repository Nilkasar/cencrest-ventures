import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import { loadUserRefs, userRef, type UserRef } from '../lib/crm-users.js';
import type { AppEnv } from '../types/context.js';

const deals = new Hono<AppEnv>();

const DEAL_STAGES = ['new', 'qualifying', 'proposal', 'negotiation', 'won', 'lost'] as const;

/**
 * What a deal is attached to, resolved in the same query that reads the
 * deal. The board shows "Northwind Logistics" under each card; without
 * these joins the client had to fetch every lead AND every account just to
 * translate two foreign keys into two names — two whole list requests to
 * label rows it already had.
 */
const DEAL_LINKS = {
  leads: { select: { id: true, name: true, company: true } },
  account_organization: { select: { id: true, name: true, slug: true } },
} as const;

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
  authenticatedRateLimit,
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
        include: DEAL_LINKS,
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
    return c.json(serializeDeal(created, await loadUserRefs([created.owner_id])), 201);
  },
);

// ── List (paginated, filterable by stage/owner) ─────────────────────────
deals.get('/', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const query = z
    .object({
      stage: z.enum(DEAL_STAGES).optional(),
      ownerId: z.string().uuid().optional(),
      // `leadId` / `accountOrganizationId` / `q` exist because the client
      // needs exactly these three views ("deals on this lead", "deals on
      // this account", "search deals") and previously got them by fetching
      // up to 100 deals and filtering in the browser — wrong beyond the
      // first page, and a large response for a handful of rows.
      leadId: z.string().uuid().optional(),
      accountOrganizationId: z.string().uuid().optional(),
      q: z.string().trim().min(1).max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

  if (!query.success) {
    return c.json({ error: 'Validation failed', issues: query.error.issues }, 422);
  }

  const { stage, ownerId, leadId, accountOrganizationId, q, page, limit } = query.data;
  const where = {
    deleted_at: null,
    ...(stage ? { stage } : {}),
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(leadId ? { lead_id: leadId } : {}),
    ...(accountOrganizationId ? { account_organization_id: accountOrganizationId } : {}),
    ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const [items, total] = await withOrgContext(internalOrgId, (tx) =>
    Promise.all([
      tx.deals.findMany({
        include: DEAL_LINKS,
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.deals.count({ where }),
    ]),
  );

  // Owners resolved in one query — see lib/crm-users.ts.
  const refs = await loadUserRefs(items.map((item) => item.owner_id));
  return c.json({ data: items.map((item) => serializeDeal(item, refs)), page, limit, total });
});

// ── Get one ──────────────────────────────────────────────────────────────
deals.get('/:id', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const id = c.req.param('id');

  const deal = await withOrgContext(internalOrgId, (tx) =>
    tx.deals.findFirst({ include: DEAL_LINKS, where: { id, deleted_at: null } }),
  );
  if (!deal) return c.json({ error: 'Deal not found' }, 404);

  return c.json(serializeDeal(deal, await loadUserRefs([deal.owner_id])));
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
  authenticatedRateLimit,
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

    const {
      title,
      valueCents,
      currency,
      probability,
      expectedCloseDate,
      ownerId,
      leadId,
      accountOrganizationId,
      lostReason,
    } = parsed.data;

    // One transaction, not two. The read-then-write used to be two separate
    // `withOrgContext` calls — two BEGIN/COMMIT round trips for one logical
    // operation, with a window in between where the row could be
    // soft-deleted by another request.
    const updated = await withOrgContext(internalOrgId, async (tx) => {
      const existing = await tx.deals.findFirst({
        where: { id, deleted_at: null },
        select: { id: true },
      });
      if (!existing) return null;

      return tx.deals.update({
        include: DEAL_LINKS,
        where: { id },
        data: {
          // Each column is named explicitly, in snake_case. The previous
          // version spread the parsed (camelCase) object straight into
          // `data`, so any request touching `valueCents`, `probability`,
          // `expectedCloseDate` or `lostReason` threw
          // PrismaClientValidationError ("Unknown argument `valueCents`")
          // and surfaced to the client as a 500. The route's unit tests
          // mock `tx.deals.update`, which accepts any shape — only a real
          // database rejects it.
          ...(title !== undefined ? { title } : {}),
          ...(valueCents !== undefined ? { value_cents: valueCents } : {}),
          ...(currency !== undefined ? { currency } : {}),
          ...(probability !== undefined ? { probability } : {}),
          ...(expectedCloseDate !== undefined ? { expected_close_date: expectedCloseDate } : {}),
          ...(lostReason !== undefined ? { lost_reason: lostReason } : {}),
          ...(leadId !== undefined ? { lead_id: leadId } : {}),
          ...(accountOrganizationId !== undefined
            ? { account_organization_id: accountOrganizationId }
            : {}),
          ...(ownerId !== undefined ? { owner_id: ownerId } : {}),
          updated_by: user.id,
          updated_at: new Date(),
        },
      });
    });

    if (!updated) return c.json({ error: 'Deal not found' }, 404);
    return c.json(serializeDeal(updated, await loadUserRefs([updated.owner_id])));
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
  authenticatedRateLimit,
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

    // One transaction for the read and the write — see the PATCH handler
    // above for why (two round trips, and a soft-delete race between them).
    const updated = await withOrgContext(internalOrgId, async (tx) => {
      const existing = await tx.deals.findFirst({
        where: { id, deleted_at: null },
        select: { id: true, lost_reason: true },
      });
      if (!existing) return null;

      return tx.deals.update({
        include: DEAL_LINKS,
        where: { id },
        data: {
          stage: parsed.data.stage,
          lost_reason:
            parsed.data.stage === 'lost' ? (parsed.data.lostReason ?? null) : existing.lost_reason,
          updated_by: user.id,
          updated_at: new Date(),
        },
      });
    });

    if (!updated) return c.json({ error: 'Deal not found' }, 404);
    return c.json(serializeDeal(updated, await loadUserRefs([updated.owner_id])));
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
  leads?: { id: string; name: string; company: string | null } | null;
  account_organization?: { id: string; name: string; slug: string } | null;
}, refs: Map<string, UserRef>) {
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
    // Resolved server-side; `ownerId` stays for id-only callers.
    owner: userRef(deal.owner_id, refs),
    // What this deal hangs off, named. `undefined` (rather than null) when
    // the query didn't ask for the join, so a client can tell "not loaded"
    // apart from "not linked".
    lead: deal.leads
      ? { id: deal.leads.id, name: deal.leads.name, company: deal.leads.company }
      : (deal.leads ?? null),
    account: deal.account_organization
      ? {
          id: deal.account_organization.id,
          name: deal.account_organization.name,
          slug: deal.account_organization.slug,
        }
      : (deal.account_organization ?? null),
    lostReason: deal.lost_reason,
    createdAt: deal.created_at,
    updatedAt: deal.updated_at,
  };
}

export default deals;
