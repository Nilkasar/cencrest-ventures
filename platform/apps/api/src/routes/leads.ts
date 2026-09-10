import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext, type PrismaTransactionClient } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import { loadUserRefs, userRef, type UserRef } from '../lib/crm-users.js';
import { uuidParam } from '../lib/http-params.js';
import { isSluggable, toSlug } from '../lib/slug.js';
import {
  LIMITS,
  containsInsensitive,
  ReferenceError_,
  assertInternalStaff,
  emailField,
  urlField,
} from '../lib/crm-validation.js';
import type { AppEnv } from '../types/context.js';

const leads = new Hono<AppEnv>();

/**
 * A reference check inside a transaction has to throw to roll the
 * transaction back, but a bad reference is a 422, not a crash. This lets
 * the handler recover it as a value while any other failure keeps
 * propagating to the error middleware untouched.
 */
function rethrowUnlessReference(err: unknown): ReferenceError_ {
  if (err instanceof ReferenceError_) return err;
  throw err;
}

const LEAD_SOURCES = ['free_snapshot', 'apply_form', 'direct', 'referral'] as const;
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;

// ── Create ───────────────────────────────────────────────────────────────
// Every bound below matches the column behind it (see lib/crm-validation.ts)
// — `website` in particular is VARCHAR(500), not the 2048 this schema used
// to allow, which turned a long URL into a 500 rather than a 422.
const createLeadSchema = z.object({
  email: emailField(),
  name: z.string().trim().min(1).max(LIMITS.name),
  company: z.string().trim().max(LIMITS.company).optional(),
  website: urlField(LIMITS.website).optional(),
  category: z.string().trim().max(LIMITS.category).optional(),
  notes: z.string().max(LIMITS.notes).optional(),
  source: z.enum(LEAD_SOURCES).default('direct'),
  sourceUrl: urlField(LIMITS.sourceUrl).optional(),
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

    const created = await withOrgContext(internalOrgId, async (tx) => {
      // A UUID that parses is not a UUID that exists. Unchecked, an unknown
      // assignee reached Postgres and came back as a foreign-key violation
      // — a 500 for what is really "that teammate isn't here".
      await assertInternalStaff(tx, internalOrgId, [parsed.data.assignedTo], 'assignedTo');

      return tx.leads.create({
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
      });
    }).catch(rethrowUnlessReference);

    if (created instanceof ReferenceError_) return c.json({ error: created.detail }, 422);

    const refs = await loadUserRefs([created.assigned_to]);
    return c.json(serializeLead(created, refs), 201);
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
      // Free-text search over the three fields the leads table actually
      // shows. Without this the client had to fetch a whole page and filter
      // it in the browser, which silently searched only the rows it
      // happened to have — a search that misses matches is worse than no
      // search at all.
      q: z.string().trim().min(1).max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

  if (!query.success) {
    return c.json({ error: 'Validation failed', issues: query.error.issues }, 422);
  }

  const { status, source, assignedTo, q, page, limit } = query.data;
  const where = {
    deleted_at: null,
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(assignedTo ? { assigned_to: assignedTo } : {}),
    ...(q
      ? {
          OR: [
            { name: containsInsensitive(q) },
            { company: containsInsensitive(q) },
            { email: containsInsensitive(q) },
          ],
        }
      : {}),
  };

  // The status breakdown is computed here, in the same transaction, rather
  // than left to the client. The leads screen shows "total / needs a
  // response / converted" above the table; counting the rows of the current
  // page produced numbers that were only ever right when every lead fitted
  // on one page. Deliberately ignores the `status` filter (but honours
  // search and the other filters) so the header describes the whole
  // filtered set, not the slice currently selected.
  const countsWhere = { ...where, status: undefined };

  const [items, total, byStatus] = await withOrgContext(internalOrgId, async (tx) => [
    await tx.leads.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    await tx.leads.count({ where }),
    await tx.leads.groupBy({ by: ['status'], where: countsWhere, _count: { _all: true } }),
  ] as const);

  const statusCounts = Object.fromEntries(
    LEAD_STATUSES.map((value) => [
      value,
      byStatus.find((row) => row.status === value)?._count._all ?? 0,
    ]),
  ) as Record<(typeof LEAD_STATUSES)[number], number>;

  // One extra query resolves every assignee on the page (see
  // lib/crm-users.ts) — the alternative was two extra HTTP requests from
  // the client before it could render a single row.
  const refs = await loadUserRefs(items.map((item) => item.assigned_to));
  return c.json({
    data: items.map((item) => serializeLead(item, refs)),
    page,
    limit,
    total,
    statusCounts,
  });
});

// ── Get one ──────────────────────────────────────────────────────────────
leads.get('/:id', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  // A non-UUID can never name a row, and handing one to Postgres produced a
  // 500 rather than a 404 (see lib/http-params.ts).
  const id = uuidParam(c, 'id');
  if (!id) return c.json({ error: 'Lead not found' }, 404);

  const lead = await withOrgContext(internalOrgId, (tx) =>
    tx.leads.findFirst({ where: { id, deleted_at: null } }),
  );
  if (!lead) return c.json({ error: 'Lead not found' }, 404);

  const refs = await loadUserRefs([lead.assigned_to]);
  return c.json(serializeLead(lead, refs));
});

// ── Update ───────────────────────────────────────────────────────────────
const updateLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.name).optional(),
    company: z.string().trim().max(LIMITS.company).nullable().optional(),
    website: urlField(LIMITS.website).nullable().optional(),
    category: z.string().trim().max(LIMITS.category).nullable().optional(),
    notes: z.string().max(LIMITS.notes).nullable().optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    score: z.number().int().min(0).max(100).nullable().optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .strict()
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
    const id = uuidParam(c, 'id');
    if (!id) return c.json({ error: 'Lead not found' }, 404);

    const { assignedTo, ...rest } = parsed.data;

    // Read and write in ONE transaction. Two `withOrgContext` calls meant
    // two BEGIN/COMMIT round trips for a single logical update, and left a
    // window where the row could be soft-deleted in between.
    const updated = await withOrgContext(internalOrgId, async (tx) => {
      const existing = await tx.leads.findFirst({
        where: { id, deleted_at: null },
        select: { id: true },
      });
      if (!existing) return null;

      await assertInternalStaff(tx, internalOrgId, [assignedTo], 'assignedTo');

      return tx.leads.update({
        where: { id },
        data: {
          ...rest,
          ...(assignedTo !== undefined ? { assigned_to: assignedTo } : {}),
          updated_by: user.id,
          updated_at: new Date(),
        },
      });
    }).catch(rethrowUnlessReference);

    if (updated instanceof ReferenceError_) return c.json({ error: updated.detail }, 422);
    if (!updated) return c.json({ error: 'Lead not found' }, 404);
    const refs = await loadUserRefs([updated.assigned_to]);
    return c.json(serializeLead(updated, refs));
  },
);

// ── Convert ──────────────────────────────────────────────────────────────
const convertLeadSchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    // Must yield a usable slug: a name of pure punctuation slugified to ''
    // and created an organization no `:slug` route could ever address.
    organizationName: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine(isSluggable, {
        message: 'Organization name must contain at least one letter or number',
      })
      .optional(),
  })
  .strict()
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
    const id = uuidParam(c, 'id');
    if (!id) return c.json({ error: 'Lead not found' }, 404);

    const now = new Date();

    // The whole conversion — the eligibility checks included — runs in ONE
    // transaction. It used to be a read transaction, then an optional
    // stand-alone org lookup, then a second write transaction: three
    // separate database trips, and a race where the same lead could be
    // converted twice concurrently because the `converted_organization_id`
    // check had already committed and released before the write began.
    const result = await withOrgContext(internalOrgId, async (tx) => {
      // `FOR UPDATE` — not a plain read. Under Postgres's default READ
      // COMMITTED isolation two simultaneous conversions of the same lead
      // BOTH saw `converted_organization_id` still null, and both went on to
      // create an organization: two orgs for one lead, the lead pointing at
      // whichever committed last, and the other one orphaned. Verified
      // against a real database before this lock existed. Taking a row lock
      // here makes the second request wait, then re-read, then correctly
      // answer 409.
      const locked = await tx.$queryRaw<{ id: string; converted_organization_id: string | null }[]>`
        SELECT id, converted_organization_id
          FROM leads
         WHERE id = ${id}::uuid AND deleted_at IS NULL
           FOR UPDATE
      `;
      if (locked.length === 0) return { error: 'not_found' } as const;
      if (locked[0]?.converted_organization_id) return { error: 'already_converted' } as const;

      const lead = await tx.leads.findFirst({ where: { id, deleted_at: null } });
      if (!lead) return { error: 'not_found' } as const;

      if (parsed.data.organizationId) {
        const target = await tx.organizations.findUnique({
          where: { id: parsed.data.organizationId },
        });
        if (!target || target.deleted_at) return { error: 'unknown_organization' } as const;
      }

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

      const updatedLead = await tx.leads.update({
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

      return { organization, lead: updatedLead } as const;
    });

    if ('error' in result) {
      if (result.error === 'not_found') return c.json({ error: 'Lead not found' }, 404);
      if (result.error === 'already_converted') {
        return c.json({ error: 'Lead has already been converted' }, 409);
      }
      return c.json({ error: 'organizationId does not refer to an existing organization' }, 404);
    }

    return c.json({
      leadId: result.lead.id,
      organizationId: result.organization.id,
      organizationName: result.organization.name,
      organizationSlug: result.organization.slug,
      convertedAt: now,
      // The converted lead, in full. Returning it here is what lets the
      // client skip a follow-up `GET /leads/:id` purely to see the status
      // flip to "converted" — one fewer round trip on a flow the UI runs
      // interactively while the user waits.
      lead: serializeLead(result.lead, await loadUserRefs([result.lead.assigned_to])),
    });
  },
);

async function uniqueSlugFor(tx: PrismaTransactionClient, name: string): Promise<string> {
  // `convertLeadSchema` already rejected a name that slugifies to nothing,
  // so `base` is non-empty here.
  const base = toSlug(name);
  let slug = base;
  let n = 1;
  // organizations has no RLS, so this lookup works regardless of tenant
  // context — same reasoning as routes/orgs.ts's create-org slug check.
  // Bounded: a pathological run of collisions must not spin forever inside
  // a transaction that has a timeout.
  while (n < 100 && (await tx.organizations.findUnique({ where: { slug }, select: { id: true } }))) {
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
}, refs: Map<string, UserRef>) {
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
    // Resolved server-side so the client never has to look a staff member
    // up separately. `assignedTo` (the raw id) stays for callers that only
    // need the id.
    assignedToUser: userRef(lead.assigned_to, refs),
    snapshotId: lead.snapshot_id,
    convertedOrganizationId: lead.converted_organization_id,
    convertedAt: lead.converted_at,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
  };
}

export default leads;
