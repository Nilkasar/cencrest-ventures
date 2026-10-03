import { Hono } from 'hono';
import { platformDb } from '@bebest/database/platform';
import { escapeLike } from '../../lib/crm-validation.js';
import { uuidParam } from '../../lib/http-params.js';
import { issueMagicLink } from '../../lib/magic-link.js';
import { writeAuditEvent } from '../../lib/audit.js';
import { clientIp } from '../../lib/client-ip.js';
import type { EmailSender } from '../../lib/email.js';
import type { AppEnv } from '../../types/context.js';
import { isPageError, iso, json, num, pagedQuery, parsePage, platformGuard, searchTerm, SqlParams, type Paginated } from './shared.js';

/**
 * Epic 22 Phase 1 — Users.
 *
 *   GET  /api/platform/users?q&platformRole&limit&offset   (support)
 *   GET  /api/platform/users/:id                           (support)
 *   POST /api/platform/users/:id/magic-link                (admin)
 *
 * The magic link goes through `issueMagicLink` — the same function
 * `POST /api/auth/magic-link` uses — so a staff-sent link is byte-for-byte
 * the link the user would have got by asking for it, and is written by the
 * request role (`bebest_platform` has no INSERT on `magic_link_tokens`).
 * The response never contains the link or token: staff trigger delivery to
 * the user's own inbox, they never hold a credential for the account.
 *
 * `PATCH /users/:id {disabled}` from the epic spec is NOT in Phase 1:
 * `users` has no disabled/suspended column, and adding one is a schema
 * change plus enforcement in `requireAuth` — out of this phase's scope.
 */

export const PLATFORM_ROLES = ['none', 'support', 'admin'] as const;

export interface PlatformUserListItem {
  id: string;
  email: string;
  name: string;
  platformRole: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  membershipCount: number;
}

export interface PlatformUserDetail {
  user: {
    id: string;
    email: string;
    name: string;
    platformRole: string;
    emailVerified: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    deletedAt: string | null;
  };
  memberships: {
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    organizationKind: string;
    organizationStatus: string;
    role: string;
    joinedAt: string;
  }[];
  /** `auth_events` rows (may be empty — the auth routes record logins in audit_events) */
  recentAuthEvents: { id: string; eventType: string; createdAt: string; ipAddress: string | null; userAgent: string | null }[];
  /** last 20 `audit_events` this user performed (auth.login / auth.logout included) */
  recentAudit: { id: string; createdAt: string; action: string; entityType: string; entityId: string | null; organizationId: string | null; result: string }[];
}

export interface MagicLinkSentResponse {
  sent: true;
  userId: string;
  email: string;
}

export function createUsersRoutes(emailSender: EmailSender) {
  const users = new Hono<AppEnv>();

  users.get('/', ...platformGuard('support'), async (c) => {
    const page = parsePage(c);
    if (isPageError(page)) return c.json({ error: page.error }, 422);
    const platformRole = c.req.query('platformRole');
    if (platformRole && !(PLATFORM_ROLES as readonly string[]).includes(platformRole)) {
      return c.json({ error: `platformRole must be one of ${PLATFORM_ROLES.join(', ')}` }, 422);
    }
    const q = searchTerm(c);

    const params = new SqlParams();
    const where = ['deleted_at IS NULL'];
    if (platformRole) where.push(`platform_role = ${params.add(platformRole)}`);
    if (q) {
      const like = params.add(`%${escapeLike(q)}%`);
      where.push(`(email ILIKE ${like} OR name ILIKE ${like})`);
    }

    const { rows, total } = await pagedQuery<{
      id: string;
      email: string;
      name: string;
      platform_role: string;
      email_verified: boolean | null;
      last_login_at: Date | string | null;
      created_at: Date | string;
      membership_count: number;
    }>(platformDb, params, page, {
      filtered: `SELECT id, email, name, platform_role, email_verified, last_login_at, created_at
                   FROM users WHERE ${where.join(' AND ')}`,
      orderBy: 'created_at DESC, id',
      enrich: '(SELECT count(*)::int FROM memberships m WHERE m.user_id = p.id) AS membership_count',
    });

    const items: PlatformUserListItem[] = rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      platformRole: u.platform_role,
      emailVerified: u.email_verified === true,
      lastLoginAt: iso(u.last_login_at),
      createdAt: iso(u.created_at)!,
      membershipCount: num(u.membership_count),
    }));

    return c.json({ items, total, limit: page.limit, offset: page.offset } satisfies Paginated<PlatformUserListItem>);
  });

  users.get('/:id', ...platformGuard('support', { targetUserParam: 'id' }), async (c) => {
    const id = uuidParam(c, 'id');
    if (!id) return c.json({ error: 'User not found' }, 404);

    // One JSON document, one round trip.
    const [row] = await platformDb.$queryRawUnsafe<{ d: unknown }[]>(
      `SELECT json_build_object(
         'user', (SELECT json_build_object('id', id, 'email', email, 'name', name, 'platform_role', platform_role,
                                           'email_verified', email_verified, 'last_login_at', last_login_at,
                                           'created_at', created_at, 'deleted_at', deleted_at)
                    FROM users WHERE id = $1::uuid),
         'memberships', (SELECT COALESCE(json_agg(json_build_object(
                            'organization_id', o.id, 'organization_name', o.name, 'organization_slug', o.slug,
                            'organization_kind', o.kind, 'organization_status', o.status, 'role', m.role,
                            'joined_at', m.created_at) ORDER BY m.created_at), '[]'::json)
                           FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = $1::uuid),
         'auth_events', (SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) FROM (
                           SELECT id, event_type, created_at, host(ip_address) AS ip_address, user_agent
                             FROM auth_events WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 20) r),
         'audit', (SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) FROM (
                     SELECT id, created_at, action, entity_type, entity_id, organization_id, result
                       FROM audit_events WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 20) r)
       ) AS d`,
      id,
    );
    const d = json<{
      user: { id: string; email: string; name: string; platform_role: string; email_verified: boolean | null; last_login_at: string | null; created_at: string; deleted_at: string | null } | null;
      memberships: { organization_id: string; organization_name: string; organization_slug: string; organization_kind: string; organization_status: string; role: string; joined_at: string }[];
      auth_events: { id: string; event_type: string; created_at: string; ip_address: string | null; user_agent: string | null }[];
      audit: { id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; organization_id: string | null; result: string }[];
    }>(row?.d);
    const user = d?.user;
    if (!user) return c.json({ error: 'User not found' }, 404);

    const body: PlatformUserDetail = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platform_role,
        emailVerified: user.email_verified === true,
        lastLoginAt: iso(user.last_login_at),
        createdAt: iso(user.created_at)!,
        deletedAt: iso(user.deleted_at),
      },
      memberships: d.memberships.map((m) => ({
        organizationId: m.organization_id,
        organizationName: m.organization_name,
        organizationSlug: m.organization_slug,
        organizationKind: m.organization_kind,
        organizationStatus: m.organization_status,
        role: m.role,
        joinedAt: iso(m.joined_at)!,
      })),
      recentAuthEvents: d.auth_events.map((e) => ({
        id: e.id,
        eventType: e.event_type,
        createdAt: iso(e.created_at)!,
        ipAddress: e.ip_address,
        userAgent: e.user_agent,
      })),
      recentAudit: d.audit.map((a) => ({
        id: a.id,
        createdAt: iso(a.created_at)!,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        organizationId: a.organization_id,
        result: a.result,
      })),
    };
    return c.json(body);
  });

  users.post('/:id/magic-link', ...platformGuard('admin', { targetUserParam: 'id' }), async (c) => {
    const id = uuidParam(c, 'id');
    if (!id) return c.json({ error: 'User not found' }, 404);

    const target = await platformDb.users.findUnique({
      where: { id },
      select: { id: true, email: true, deleted_at: true },
    });
    if (!target || target.deleted_at) return c.json({ error: 'User not found' }, 404);

    await issueMagicLink(emailSender, target.email);

    const actor = c.get('user');
    await writeAuditEvent({
      userId: actor.id,
      organizationId: null,
      actorType: 'user',
      actorRole: `platform_${c.get('platformRole')}`,
      action: 'platform.magic_link_sent',
      entityType: 'user',
      entityId: target.id,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: 'success',
      details: { via: 'platform', targetUserId: target.id },
    });

    return c.json({ sent: true, userId: target.id, email: target.email } satisfies MagicLinkSentResponse);
  });

  return users;
}
