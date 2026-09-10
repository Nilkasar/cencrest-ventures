import { Hono } from 'hono';
import { z } from 'zod';
import { db, withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import { loadUserRefs, userRef } from '../lib/crm-users.js';
import { uuidParam } from '../lib/http-params.js';
import { containsInsensitive } from '../lib/crm-validation.js';
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
      // Searches the converting lead's name/company/email. An account's
      // display name comes from `organizations.name`, which for a converted
      // lead is that lead's company — so this is the same text the list
      // shows, matched server-side rather than over one fetched page.
      q: z.string().trim().min(1).max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

  if (!query.success) {
    return c.json({ error: 'Validation failed', issues: query.error.issues }, 422);
  }
  const { q, page, limit } = query.data;

  const where = {
    converted_organization_id: { not: null },
    deleted_at: null,
    ...(q
      ? {
          OR: [
            { company: containsInsensitive(q) },
            { name: containsInsensitive(q) },
            { email: containsInsensitive(q) },
          ],
        }
      : {}),
  };
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
      // The converting lead's own name/company/email travel with the row.
      // They are already in hand here; without them the client had to fetch
      // the entire leads list a second time just to label these accounts.
      leadName: lead.name,
      leadEmail: lead.email,
      leadCompany: lead.company,
    };
  });

  return c.json({ data, page, limit, total });
});

// ── Get one account (org + its converted lead + deals + activity timeline) ──
accounts.get('/:orgId', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();
  // A non-UUID can never name an organization; handing one to Postgres
  // returned a 500 instead of a 404 (see lib/http-params.ts).
  const orgId = uuidParam(c, 'orgId');
  if (!orgId) return c.json({ error: 'Organization not found' }, 404);

  // The `organizations` read (no RLS) is issued alongside the whole
  // tenant-scoped half rather than before it, and the lead / deals /
  // activities reads share ONE transaction instead of two. This detail
  // view used to cost an org query, a full BEGIN/COMMIT for the lead, and
  // a second full BEGIN/COMMIT for its children — three database trips for
  // one screen.
  const [org, scoped] = await Promise.all([
    db.organizations.findUnique({ where: { id: orgId } }),
    withOrgContext(internalOrgId, async (tx) => {
      const lead = await tx.leads.findFirst({
        where: { converted_organization_id: orgId, deleted_at: null },
      });
      if (!lead) return null;

      const dealRows = await tx.deals.findMany({
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
      });
      const activityRows = await tx.activities.findMany({
        where: { OR: [{ account_organization_id: orgId }, { lead_id: lead.id }] },
        orderBy: { created_at: 'desc' },
        take: 50,
      });

      return { lead, dealRows, activityRows };
    }),
  ]);

  if (!org || org.deleted_at) return c.json({ error: 'Organization not found' }, 404);
  if (!scoped) {
    return c.json(
      { error: 'This organization is not a CRM account (no lead has converted into it)' },
      404,
    );
  }
  const { lead, dealRows, activityRows } = scoped;

  // Every person named on this screen — the lead's assignee, each deal's
  // owner, each activity's actor — resolved in a single query. See
  // lib/crm-users.ts for why this moved off the client.
  const refs = await loadUserRefs([
    lead.assigned_to,
    ...dealRows.map((d) => d.owner_id),
    ...activityRows.map((a) => a.actor_id),
  ]);

  return c.json({
    organization: { id: org.id, name: org.name, slug: org.slug, createdAt: org.created_at },
    lead: {
      id: lead.id,
      email: lead.email,
      name: lead.name,
      company: lead.company,
      source: lead.source,
      convertedAt: lead.converted_at,
      assignedToUser: userRef(lead.assigned_to, refs),
    },
    deals: dealRows.map((d) => ({
      id: d.id,
      title: d.title,
      valueCents: d.value_cents,
      currency: d.currency,
      stage: d.stage,
      ownerId: d.owner_id,
      owner: userRef(d.owner_id, refs),
      expectedCloseDate: d.expected_close_date,
    })),
    activities: activityRows.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: a.body,
      actorId: a.actor_id,
      actor: userRef(a.actor_id, refs),
      createdAt: a.created_at,
    })),
  });
});

export default accounts;
