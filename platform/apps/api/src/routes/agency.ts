/**
 * Epic 18 (Agency / White Label / Integrations) — `agency_clients` CRUD:
 * invite (agency side, requires consent), accept (client side — the
 * explicit consent step the epic's DoD requires), revoke (either side —
 * the DoD's mandated "immediately blocks a subsequent request" case), list
 * (agency side, with a real per-client summary reusing Epic 4/7/9's own
 * tables, never a duplicate rollup table).
 *
 * Two distinct read/write paths on the SAME table, by design (see
 * `@bebest/database` DECISIONS.md's Epic 18 section and rls.sql's "Special
 * case — agency_clients"):
 *   - AGENCY side (`agency_org_id = the caller's org`): RLS-backed, via
 *     `withOrgContext(agencyOrgId, ...)`, exactly like every other tenant
 *     table in this codebase.
 *   - CLIENT side (`client_org_id = the caller's org`): RLS on this table
 *     scopes visibility to the agency side ONLY (a client org cannot see
 *     "who manages us" through the standard policy) — same reasoning as
 *     `invitations` (see DECISIONS.md §7b): the row's own `id`, handed back
 *     out-of-band (email/UI notification — a real notification delivery is
 *     out of this build's scope, same "console.log stand-in" precedent
 *     `routes/orgs.ts`'s invitation email already establishes), IS the
 *     access control for this path, backed by an explicit
 *     `client_org_id === caller's org` check in application code rather
 *     than a second, blanket RLS grant. Plain `db`, not `withOrgContext`,
 *     for exactly these client-side reads/writes — mirrors
 *     `routes/orgs.ts`'s invitation accept flow precisely.
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
  const links = await db.agency_clients.findMany({
    where: { client_org_id: org.organizationId, deleted_at: null },
    orderBy: { created_at: 'desc' },
    take: 100,
  });

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

    const link = await db.agency_clients.findUnique({ where: { id } });
    if (!link || link.deleted_at || link.client_org_id !== org.organizationId) {
      // 404, never 403 — do not confirm to a non-target org that a link
      // with this id exists at all (same "don't leak enumerable ids"
      // discipline `routes/snapshot.ts` follows on its public endpoint).
      return c.json({ error: 'Invitation not found' }, 404);
    }
    if (link.status !== 'pending') {
      return c.json({ error: 'not_pending', message: `This invitation is ${link.status}, not pending.` }, 409);
    }

    const updated = await db.agency_clients.update({
      where: { id: link.id },
      data: { status: 'active', consented_by: user.id, consented_at: new Date(), updated_at: new Date() },
    });

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

    // Same client-side narrow path as /accept for a client-initiated
    // revoke; the agency-initiated case additionally tries the RLS-backed
    // `withOrgContext` read further below.
    const link =
      (await db.agency_clients.findUnique({ where: { id } })) ?? null;

    if (!link || link.deleted_at) return c.json({ error: 'Link not found' }, 404);

    const isClientSide = link.client_org_id === org.organizationId;
    const isAgencySide = link.agency_org_id === org.organizationId;
    if (!isClientSide && !isAgencySide) {
      return c.json({ error: 'Link not found' }, 404);
    }
    if (link.status === 'revoked' || link.status === 'terminated') {
      return c.json({ id: link.id, status: link.status }); // already inert — idempotent
    }

    const updated = isAgencySide
      ? await withOrgContext(org.organizationId, (tx) =>
          tx.agency_clients.update({
            where: { id: link.id },
            data: { status: 'revoked', revoked_by: user.id, revoked_at: new Date(), updated_at: new Date() },
          }),
        )
      : await db.agency_clients.update({
          where: { id: link.id },
          data: { status: 'revoked', revoked_by: user.id, revoked_at: new Date(), updated_at: new Date() },
        });

    return c.json({ id: updated.id, status: updated.status, revokedAt: updated.revoked_at });
  },
);

export default agency;
