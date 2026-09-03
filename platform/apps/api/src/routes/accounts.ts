import { Hono } from 'hono';
import { z } from 'zod';
import { db, withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import type { AppEnv } from '../types/context.js';

const accounts = new Hono<AppEnv>();

/**
 * "Accounts" is NOT a table — per docs/epics/01-crm.md's model decision, it
 * is a thin read view assembled here over `organizations` + the `leads` row
 * that converted into it + that lead's `deals`/`activities`. An org only
 * shows up here once a CRM lead has converted into it (see leads.ts's
 * `/convert` endpoint) — an org that signed up some other way (no lead ever
 * involved) is a real `organizations` row but not yet a CRM "account" in
 * this v1 sense; see docs/epics/01-crm.md's model-decision note for why
 * that's deliberate, not a gap.
 */

// ── List accounts (orgs with a converted lead) ──────────────────────────
accounts.get('/', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const query = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

  if (!query.success) {
    return c.json({ error: 'Validation failed', issues: query.error.issues }, 422);
  }
  const { page, limit } = query.data;

  const where = { converted_organization_id: { not: null }, deleted_at: null } as const;
  const [convertedLeads, total] = await withOrgContext(internalOrgId, (tx) =>
    Promise.all([
      tx.leads.findMany({
        where,
        orderBy: { converted_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.leads.count({ where }),
    ]),
  );

  const orgIds = convertedLeads
    .map((l) => l.converted_organization_id)
    .filter((id): id is string => id !== null);
  // `organizations` has no RLS (see @bebest/database rls.sql) — a plain,
  // unscoped read across potentially many different customer orgs is
  // exactly what this internal-staff "list our accounts" view needs.
  const orgs = orgIds.length
    ? await db.organizations.findMany({ where: { id: { in: orgIds } } })
    : [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const data = convertedLeads.map((lead) => {
    const org = lead.converted_organization_id ? orgById.get(lead.converted_organization_id) : undefined;
    return {
      organizationId: lead.converted_organization_id,
      name: org?.name ?? null,
      slug: org?.slug ?? null,
      leadId: lead.id,
      convertedAt: lead.converted_at,
    };
  });

  return c.json({ data, page, limit, total });
});

// ── Get one account (org + its converted lead + deals + activity timeline) ──
accounts.get('/:orgId', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  const orgId = c.req.param('orgId');

  const org = await db.organizations.findUnique({ where: { id: orgId } });
  if (!org || org.deleted_at) return c.json({ error: 'Organization not found' }, 404);

  const lead = await withOrgContext(internalOrgId, (tx) =>
    tx.leads.findFirst({ where: { converted_organization_id: orgId, deleted_at: null } }),
  );
  if (!lead) {
    return c.json(
      { error: 'This organization is not a CRM account (no lead has converted into it)' },
      404,
    );
  }

  const [dealRows, activityRows] = await withOrgContext(internalOrgId, (tx) =>
    Promise.all([
      tx.deals.findMany({
        where: {
          deleted_at: null,
          OR: [{ account_organization_id: orgId }, { lead_id: lead.id }],
        },
        orderBy: { created_at: 'desc' },
        // Epic 19 (Production Hardening), item 6 — this call had no
        // server-side cap (its sibling `activities.findMany` right below
        // it already caps at 50); an account with an unbounded number of
        // deals could return an unbounded response. Same cap as
        // `activities` for consistency on this one detail view.
        take: 50,
      }),
      tx.activities.findMany({
        where: { OR: [{ account_organization_id: orgId }, { lead_id: lead.id }] },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
    ]),
  );

  return c.json({
    organization: { id: org.id, name: org.name, slug: org.slug, createdAt: org.created_at },
    lead: {
      id: lead.id,
      email: lead.email,
      name: lead.name,
      company: lead.company,
      source: lead.source,
      convertedAt: lead.converted_at,
    },
    deals: dealRows.map((d) => ({
      id: d.id,
      title: d.title,
      valueCents: d.value_cents,
      currency: d.currency,
      stage: d.stage,
      ownerId: d.owner_id,
      expectedCloseDate: d.expected_close_date,
    })),
    activities: activityRows.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: a.body,
      actorId: a.actor_id,
      createdAt: a.created_at,
    })),
  });
});

export default accounts;
