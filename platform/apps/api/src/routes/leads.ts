import { Hono } from 'hono';
import { z } from 'zod';
import { db, withOrgContext, type PrismaTransactionClient } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import { isSafePublicHttpUrl } from '../lib/ssrf-guard.js';
import type { AppEnv } from '../types/context.js';

const leads = new Hono<AppEnv>();

const LEAD_SOURCES = ['free_snapshot', 'apply_form', 'direct', 'referral'] as const;
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;

const urlField = () =>
  z
    .string()
    .url()
    .max(2048)
    .refine(isSafePublicHttpUrl, { message: 'Must be a public http(s) URL' });

// ── Create ───────────────────────────────────────────────────────────────
const createLeadSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  company: z.string().max(255).optional(),
  website: urlField().optional(),
  category: z.string().max(100).optional(),
  notes: z.string().optional(),
  source: z.enum(LEAD_SOURCES).default('direct'),
  sourceUrl: urlField().optional(),
  assignedTo: z.string().uuid().optional(),
  snapshotId: z.string().uuid().optional(),
});

leads.post(
  '/',
  requireAuth,
  authenticatedRateLimit,
  requireCrmAccess('viewer'),
  requirePermission('manage_leads'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const user = c.get('user');
    const internalOrgId = getInternalOrgId();

    const created = await withOrgContext(internalOrgId, (tx) =>
      tx.leads.create({
        data: {
          organization_id: internalOrgId,
          email: parsed.data.email,
          name: parsed.data.name,
          company: parsed.data.company ?? null,
          website: parsed.data.website ?? null,
          category: parsed.data.category ?? null,
          notes: parsed.data.notes ?? null,
          source: parsed.data.source,
          source_url: parsed.data.sourceUrl ?? null,
          assigned_to: parsed.data.assignedTo ?? null,
          snapshot_id: parsed.data.snapshotId ?? null,
          created_by: user.id,
        },
      }),
    );

    return c.json(serializeLead(created), 201);
  },
);

// ── List (paginated, filterable) ────────────────────────────────────────
leads.get('/', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const query = z
    .object({
      status: z.enum(LEAD_STATUSES).optional(),
      source: z.enum(LEAD_SOURCES).optional(),
      assignedTo: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

  if (!query.success) {
    return c.json({ error: 'Validation failed', issues: query.error.issues }, 422);
  }

  const { status, source, assignedTo, page, limit } = query.data;
  const where = {
    deleted_at: null,
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(assignedTo ? { assigned_to: assignedTo } : {}),
  };

  const [items, total] = await withOrgContext(internalOrgId, (tx) =>
    Promise.all([
      tx.leads.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.leads.count({ where }),
    ]),
  );

  return c.json({ data: items.map(serializeLead), page, limit, total });
});

// ── Get one ──────────────────────────────────────────────────────────────
leads.get('/:id', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const id = c.req.param('id');

  const lead = await withOrgContext(internalOrgId, (tx) =>
    tx.leads.findFirst({ where: { id, deleted_at: null } }),
  );
  if (!lead) return c.json({ error: 'Lead not found' }, 404);

  return c.json(serializeLead(lead));
});

// ── Update ───────────────────────────────────────────────────────────────
const updateLeadSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    company: z.string().max(255).nullable().optional(),
    website: urlField().nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    notes: z.string().nullable().optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    score: z.number().int().min(0).max(100).nullable().optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.status !== 'converted', {
    message: 'Use POST /leads/:id/convert to convert a lead — status cannot be set directly',
    path: ['status'],
  });

leads.patch(
  '/:id',
  requireAuth,
  authenticatedRateLimit,
  requireCrmAccess('viewer'),
  requirePermission('manage_leads'),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const internalOrgId = getInternalOrgId();
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await withOrgContext(internalOrgId, (tx) =>
      tx.leads.findFirst({ where: { id, deleted_at: null } }),
    );
    if (!existing) return c.json({ error: 'Lead not found' }, 404);

    const { assignedTo, ...rest } = parsed.data;
    const updated = await withOrgContext(internalOrgId, (tx) =>
      tx.leads.update({
        where: { id },
        data: {
          ...rest,
          ...(assignedTo !== undefined ? { assigned_to: assignedTo } : {}),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serializeLead(updated));
  },
);

// ── Convert ──────────────────────────────────────────────────────────────
const convertLeadSchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    organizationName: z.string().min(2).max(100).optional(),
  })
  .refine((d) => Boolean(d.organizationId) !== Boolean(d.organizationName), {
    message: 'Provide exactly one of organizationId (link an existing org) or organizationName (create a new one)',
  });

leads.post(
  '/:id/convert',
  requireAuth,
  authenticatedRateLimit,
  requireCrmAccess('viewer'),
  requirePermission('manage_leads'),
  auditLog({ action: 'lead.converted', entityType: 'lead' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = convertLeadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const internalOrgId = getInternalOrgId();
    const user = c.get('user');
    const id = c.req.param('id');

    const lead = await withOrgContext(internalOrgId, (tx) =>
      tx.leads.findFirst({ where: { id, deleted_at: null } }),
    );
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    if (lead.converted_organization_id) {
      return c.json({ error: 'Lead has already been converted' }, 409);
    }

    if (parsed.data.organizationId) {
      const target = await db.organizations.findUnique({
        where: { id: parsed.data.organizationId },
      });
      if (!target || target.deleted_at) {
        return c.json({ error: 'organizationId does not refer to an existing organization' }, 404);
      }
    }

    const now = new Date();
    const result = await withOrgContext(internalOrgId, async (tx) => {
      // `organizations` has no RLS (queried before any tenant context
      // exists — see @bebest/database rls.sql), so creating/reading it
      // inside this internal-org-scoped transaction is safe and keeps the
      // whole conversion atomic.
      const organization = parsed.data.organizationId
        ? await tx.organizations.findUniqueOrThrow({ where: { id: parsed.data.organizationId } })
        : await tx.organizations.create({
            data: {
              name: parsed.data.organizationName as string,
              slug: await uniqueSlugFor(tx, parsed.data.organizationName as string),
              created_by: user.id,
            },
          });

      await tx.leads.update({
        where: { id: lead.id },
        data: {
          converted_organization_id: organization.id,
          converted_at: now,
          status: 'converted',
          updated_by: user.id,
          updated_at: now,
        },
      });

      // Preserve history (spec: "does not delete the lead record" / keeps
      // existing activities) while re-linking anything that was hanging off
      // this lead pre-conversion to the now-known account, so the Accounts
      // view (routes/accounts.ts) can find it without a lead_id fallback.
      await tx.deals.updateMany({
        where: { lead_id: lead.id, account_organization_id: null },
        data: { account_organization_id: organization.id },
      });
      await tx.activities.updateMany({
        where: { lead_id: lead.id, account_organization_id: null },
        data: { account_organization_id: organization.id },
      });

      return organization;
    });

    return c.json({
      leadId: lead.id,
      organizationId: result.id,
      organizationName: result.name,
      convertedAt: now,
    });
  },
);

async function uniqueSlugFor(tx: PrismaTransactionClient, name: string): Promise<string> {
  const { toSlug } = await import('../lib/slug.js');
  const base = toSlug(name);
  let slug = base;
  let n = 1;
  // organizations has no RLS, so this lookup works regardless of tenant
  // context — same reasoning as routes/orgs.ts's create-org slug check.
  while (await tx.organizations.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

function serializeLead(lead: {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  company: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  source: string;
  source_url: string | null;
  status: string;
  score: number | null;
  assigned_to: string | null;
  snapshot_id: string | null;
  converted_organization_id: string | null;
  converted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: lead.id,
    email: lead.email,
    name: lead.name,
    company: lead.company,
    website: lead.website,
    category: lead.category,
    notes: lead.notes,
    source: lead.source,
    sourceUrl: lead.source_url,
    status: lead.status,
    score: lead.score,
    assignedTo: lead.assigned_to,
    snapshotId: lead.snapshot_id,
    convertedOrganizationId: lead.converted_organization_id,
    convertedAt: lead.converted_at,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
  };
}

export default leads;
