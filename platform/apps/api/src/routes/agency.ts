/**
 * Epic 18 (Agency / White Label / Integrations) — `agency_clients` CRUD:
 * invite (agency side, requires consent), accept (client side — the
 * explicit consent step the epic's DoD requires), revoke (either side —
 * the DoD's mandated "immediately blocks a subsequent request" case), list
 * (agency side, with a real per-client summary reusing Epic 4/7/9's own
 * tables, never a duplicate rollup table).
 *
 * BOTH sides of a link go through `withOrgContext`, because both are named
 * on the row's RLS policy (migration 0022).
 *
 * This file previously ran every client-side read and write through the
 * un-scoped `db` client with an explicit `client_org_id = ...` WHERE, on
 * the stated reasoning that the policy only authorized the agency side and
 * that `routes/orgs.ts`'s invitation-accept flow was the precedent for
 * doing it that way.
 *
 * That reasoning had a hole. `invitations` has no RLS at all — which is why
 * the precedent works there — whereas `agency_clients` does, and the
 * un-scoped client is not exempt from a policy, it is merely a session with
 * no `app.current_org` set. Under any role that cannot bypass RLS, the
 * policy therefore matched nothing and the client half of this epic could
 * not run at all: incoming invitations listed empty, accept 404'd, and a
 * client could not revoke an agency's access to its own data — the case the
 * epic's DoD calls its critical path.
 *
 * The policy now names the client org as well as the agency org, which is
 * not a relaxation but a completion: the database enforces what the code
 * always intended, and the explicit `client_org_id === caller's org` checks
 * below remain as defense in depth rather than as the only check.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { db, withOrgContext, type agency_clients } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { checkUsageLimit, EntitlementLimitError } from '../lib/entitlements.js';
import { accessLevelToRole, roleToAccessLevel } from '../lib/agency-access.js';
import { getBrandForOrg } from '../lib/brand-context.js';
import type { AppEnv } from '../types/context.js';

const agency = new Hono<AppEnv>();

const MANAGE = 'manage_agency_clients' as const;
const GRANTABLE_ROLES = ['admin', 'analyst', 'viewer'] as const;

// Link statuses that consume the agency's `client_accounts` entitlement —
// a `pending` invite already reserves a slot (so an agency can't dodge the
// cap by leaving invites permanently unaccepted), `revoked`/`terminated`
// rows do not (the whole point of revoking is to free the slot back up).
const OPEN_STATUSES = ['pending', 'active', 'paused'] as const;

function countOpenLinks(agencyOrgId: string): Promise<number> {
  return withOrgContext(agencyOrgId, (tx) =>
    tx.agency_clients.count({
      where: { agency_org_id: agencyOrgId, status: { in: [...OPEN_STATUSES] }, deleted_at: null },
    }),
  );
}

function serializeLink(row: agency_clients, client: { name: string; slug: string } | null) {
  return {
    id: row.id,
    agencyOrgId: row.agency_org_id,
    clientOrgId: row.client_org_id,
    clientOrgName: client?.name ?? null,
    clientOrgSlug: client?.slug ?? null,
    role: accessLevelToRole(row.access_level),
    status: row.status,
    invitedAt: row.created_at,
    consentedAt: row.consented_at,
    revokedAt: row.revoked_at,
  };
}

// ── POST /agency/clients — invite a client org (agency side) ───────────────
const inviteSchema = z.object({
  clientOrgSlug: z.string().min(1),
  role: z.enum(GRANTABLE_ROLES).default('viewer'),
});

agency.post(
  '/clients',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  requirePermission(MANAGE),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');

    const clientOrg = await db.organizations.findUnique({ where: { slug: parsed.data.clientOrgSlug } });
    if (!clientOrg || clientOrg.deleted_at) {
      return c.json({ error: 'Client organization not found' }, 404);
    }
    if (clientOrg.id === org.organizationId) {
      return c.json({ error: 'cannot_link_self', message: 'An organization cannot be its own agency client.' }, 422);
    }

    const accessLevel = roleToAccessLevel(parsed.data.role);

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.agency_clients.findUnique({
        where: { agency_org_id_client_org_id: { agency_org_id: org.organizationId, client_org_id: clientOrg.id } },
      }),
    );

    if (existing && !existing.deleted_at && (OPEN_STATUSES as readonly string[]).includes(existing.status)) {
      return c.json(
        { error: 'link_already_exists', message: `A ${existing.status} link to this client already exists.`, status: existing.status },
        409,
      );
    }

    // Entitlement check — Epic 16's real checkUsageLimit/client_accounts,
    // the agency tier's documented 20-client cap. Counted BEFORE creating
    // the new (or re-invited) row, same "check, then write" ordering every
    // other entitlement-gated create in this codebase follows.
    try {
      await checkUsageLimit(org.organizationId, 'client_accounts', () => countOpenLinks(org.organizationId));
    } catch (err) {
      if (err instanceof EntitlementLimitError) {
        return c.json(
          {
            error: 'client_limit_reached',
            message: `Your ${err.plan} plan supports up to ${err.limit} client organizations (you have ${err.current}).${
              err.upgradeTo ? ` Upgrade to ${err.upgradeTo} for more.` : ''
            }`,
            metric: err.metric,
            limit: err.limit,
            current: err.current,
            plan: err.plan,
            upgradeTo: err.upgradeTo,
          },
          402,
        );
      }
      throw err;
    }

    const link = await withOrgContext(org.organizationId, (tx) =>
      existing
        ? tx.agency_clients.update({
            where: { id: existing.id },
            data: {
              status: 'pending',
              access_level: accessLevel,
              invited_by: user.id,
              consented_by: null,
              consented_at: null,
              revoked_by: null,
              revoked_at: null,
              updated_at: new Date(),
            },
          })
        : tx.agency_clients.create({
            data: {
              agency_org_id: org.organizationId,
              client_org_id: clientOrg.id,
              access_level: accessLevel,
              status: 'pending',
              invited_by: user.id,
            },
          }),
    );

    await writeManualAuditEvent(c, {
      action: 'agency_client.invited',
      entityType: 'agency_clients',
      entityId: link.id,
    });

    return c.json(serializeLink(link, clientOrg), 201);
  },
);

// ── GET /agency/clients — list (agency side), with a real per-client
// summary (AVS + open-opportunity count) reusing Epic 7/9's own tables. ────
agency.get('/clients', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');

  // Epic 19 (Production Hardening), item 6 — capped server-side (this call
  // had no cap at all before this epic).
  const links = await withOrgContext(org.organizationId, (tx) =>
    tx.agency_clients.findMany({
      where: { agency_org_id: org.organizationId, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
  );

  const results = await Promise.all(
    links.map(async (link) => {
      const clientOrg = await db.organizations.findUnique({
        where: { id: link.client_org_id },
        select: { name: true, slug: true },
      });
      const base = serializeLink(link, clientOrg);

      // Summary is only meaningful (and only readable — see this file's
      // header comment) for an ACTIVE link; a pending/revoked one gets no
      // cross-org read at all.
      if (link.status !== 'active') return { ...base, summary: null };

      const brand = await getBrandForOrg(link.client_org_id);
      if (!brand) return { ...base, summary: { hasBrand: false, aiVisibilityScore: null, openOpportunities: null } };

      const [latestRun, openOpportunities] = await withOrgContext(link.client_org_id, (tx) =>
        Promise.all([
          tx.ai_runs.findFirst({
            where: { organization_id: link.client_org_id, brand_id: brand.id, competitor_id: null, status: 'completed' },
            orderBy: { completed_at: 'desc' },
            select: { ai_visibility_score: true, completed_at: true },
          }),
          tx.unified_opportunities.count({
            where: { organization_id: link.client_org_id, brand_id: brand.id, status: { not: 'dismissed' } },
          }),
        ]),
      );

      return {
        ...base,
        summary: {
          hasBrand: true,
          aiVisibilityScore: latestRun?.ai_visibility_score === null || latestRun?.ai_visibility_score === undefined
            ? null
            : Number(latestRun.ai_visibility_score),
          aiVisibilityScoreAsOf: latestRun?.completed_at ?? null,
          openOpportunities,
        },
      };
    }),
  );

  return c.json(results);
});

// ── GET /agency/clients/incoming — the narrow client-side read path
// (see this file's header comment): "which agencies are inviting/managing
// us," never a blanket RLS grant on this table's client side. ─────────────
agency.get('/clients/incoming', requireAuth, authenticatedRateLimit, requireOrgFromToken('admin'), async (c) => {
  const org = c.get('org');

  // Plain `db`, filtered explicitly by client_org_id — this table's RLS
  // policy only ever authorizes the agency side (see header comment), so a
  // `withOrgContext(org.organizationId, ...)` read here would silently
  // return zero rows even for a real invitation, not a security bug to
  // "fix" by widening RLS (the epic brief: RLS itself must never be
  // relaxed) but the documented reason this one path uses `db` + an
  // explicit WHERE, exactly like `routes/orgs.ts`'s invitation accept flow.
  // Epic 19 (Production Hardening), item 6 — capped server-side (this call
  // had no cap at all before this epic).
  const links = await withOrgContext(org.organizationId, (tx) =>
    tx.agency_clients.findMany({
      where: { client_org_id: org.organizationId, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
  );

  const results = await Promise.all(
    links.map(async (link) => {
      const agencyOrg = await db.organizations.findUnique({
        where: { id: link.agency_org_id },
        select: { name: true, slug: true },
      });
      return {
        id: link.id,
        agencyOrgId: link.agency_org_id,
        agencyOrgName: agencyOrg?.name ?? null,
        agencyOrgSlug: agencyOrg?.slug ?? null,
        role: accessLevelToRole(link.access_level),
        status: link.status,
        invitedAt: link.created_at,
      };
    }),
  );

  return c.json(results);
});

// ── POST /agency/clients/:id/accept — the explicit consent step (client
// side). Only the invited CLIENT org's own admin can accept its own
// invitation — never the agency, never a third org. ────────────────────────
agency.post(
  '/clients/:id/accept',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('admin'),
  auditLog({ action: 'agency_client.consented', entityType: 'agency_clients' }),
  async (c) => {
    const org = c.get('org');
    const user = c.get('user');
    const id = c.req.param('id');

    const link = await withOrgContext(org.organizationId, (tx) =>
      tx.agency_clients.findUnique({ where: { id } }),
    );
    if (!link || link.deleted_at || link.client_org_id !== org.organizationId) {
      // 404, never 403 — do not confirm to a non-target org that a link
      // with this id exists at all (same "don't leak enumerable ids"
      // discipline `routes/snapshot.ts` follows on its public endpoint).
      return c.json({ error: 'Invitation not found' }, 404);
    }
    if (link.status !== 'pending') {
      return c.json({ error: 'not_pending', message: `This invitation is ${link.status}, not pending.` }, 409);
    }

    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.agency_clients.update({
        where: { id: link.id },
        data: { status: 'active', consented_by: user.id, consented_at: new Date(), updated_at: new Date() },
      }),
    );

    return c.json({ id: updated.id, status: updated.status, consentedAt: updated.consented_at });
  },
);

// ── POST /agency/clients/:id/revoke — either side may revoke. This is the
// DoD's critical path: after this call, the very next request that relied
// on this link (via `lib/agency-access.ts`, re-read fresh every time) must
// fail. Nothing here caches or needs to invalidate a cache — there isn't
// one. ──────────────────────────────────────────────────────────────────
agency.post(
  '/clients/:id/revoke',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('admin'),
  auditLog({ action: 'agency_client.revoked', entityType: 'agency_clients' }),
  async (c) => {
    const org = c.get('org');
    const user = c.get('user');
    const id = c.req.param('id');

    // One scoped read serves both sides: the policy now names the agency
    // AND the client org (migration 0022), so whichever party is calling
    // sees the link and nobody else does.
    const link = await withOrgContext(org.organizationId, (tx) =>
      tx.agency_clients.findUnique({ where: { id } }),
    );

    if (!link || link.deleted_at) return c.json({ error: 'Link not found' }, 404);

    const isClientSide = link.client_org_id === org.organizationId;
    const isAgencySide = link.agency_org_id === org.organizationId;
    if (!isClientSide && !isAgencySide) {
      return c.json({ error: 'Link not found' }, 404);
    }
    if (link.status === 'revoked' || link.status === 'terminated') {
      return c.json({ id: link.id, status: link.status }); // already inert — idempotent
    }

    // Identical for both sides now — the branch existed only because the
    // client side could not go through RLS.
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.agency_clients.update({
        where: { id: link.id },
        data: { status: 'revoked', revoked_by: user.id, revoked_at: new Date(), updated_at: new Date() },
      }),
    );

    return c.json({ id: updated.id, status: updated.status, revokedAt: updated.revoked_at });
  },
);

export default agency;
