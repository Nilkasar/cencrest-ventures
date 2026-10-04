import { Hono } from 'hono';
import { z } from 'zod';
import { db, withUserContext, withOrgContext } from '@bebest/database';
import { isSluggable } from '../lib/slug.js';
import { createOrganizationWithUniqueSlug, ORG_SLUG_PATTERN, OrgSlugTakenError } from '../lib/org-slug.js';
import { generateOpaqueToken } from '../lib/tokens.js';
import { hashToken } from '../lib/jwt.js';
import { writeAuditEvent } from '../lib/audit.js';
import { clientIp } from '../lib/client-ip.js';
import { notify } from '../lib/notifications/notify.js';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit, publicRateLimit } from '../middleware/rate-limit.js';
import { requireOrgBySlug } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import type { EmailSender } from '../lib/email.js';
import type { AppEnv } from '../types/context.js';

/** "john.smith@acme.example" → "j***@acme.example". Enough for the invitee
 * to recognise their own address on the public accept page, not enough to
 * harvest addresses from a leaked link. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** The one answer the public preview gives for every token that does not
 * name a live invitation — unknown, revoked, or for a deleted org — so the
 * endpoint cannot be used to tell those cases apart. */
const INVITATION_NOT_FOUND = {
  error: 'invitation_not_found',
  message: 'This invitation link is not valid. Ask the person who invited you to send a new one.',
} as const;

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Factory, matching routes/auth.ts's own `createAuthRoutes(emailSender)`
// pattern -- the invite handler below needs the same swappable-provider
// EmailSender (console today, a real Resend implementation later, zero
// route changes) instead of the raw `console.log` it used to call
// directly.
export function createOrgsRoutes(emailSender: EmailSender) {
  const orgs = new Hono<AppEnv>();

  // ── List orgs for the current user ─────────────────────────────────────────
  orgs.get('/', requireAuth, authenticatedRateLimit, async (c) => {
    const user = c.get('user');
    // Epic 19 (Production Hardening), item 6 — capped server-side for
    // consistency with every other list endpoint in this codebase, though
    // this one is naturally small (memberships for a single user).
    const memberships = await withUserContext(user.id, (tx) =>
      tx.memberships.findMany({
        where: { user_id: user.id },
        include: { organizations: { select: { id: true, name: true, slug: true, deleted_at: true } } },
        take: 100,
      }),
    );

    // A soft-deleted org keeps its memberships (nothing is hard-deleted),
    // so it must be filtered here — same rule as `/auth/me`.
    return c.json(
      memberships.filter((m) => !m.organizations.deleted_at).map((m) => ({
        id: m.organizations.id,
        name: m.organizations.name,
        slug: m.organizations.slug,
        role: m.role,
      })),
    );
  });

  // ── Create org (the creator becomes owner) ──────────────────────────────────
  // The name must yield a usable slug: one made only of punctuation
  // slugified to the empty string and created an organization that no
  // `:slug` route could address — and that collided with the next such name
  // on the unique index. See lib/slug.ts.
  //
  // Epic 22 Phase 2: the slug is made unique server-side. A collision is
  // resolved with a numeric suffix (`john` → `john-2`) instead of the old
  // 409, which stranded the second "john@…" user on first login (the web
  // derives the name from the email prefix). An explicit `slug` is still
  // accepted and gets the same treatment; `strictSlug: true` restores
  // "exactly this slug or 409". See lib/org-slug.ts.
  const createOrgSchema = z.object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine(isSluggable, {
        message: 'Organization name must contain at least one letter or number',
      }),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(60)
      .regex(ORG_SLUG_PATTERN, 'Slug may contain only lowercase letters, numbers and single hyphens')
      .optional(),
    strictSlug: z.boolean().optional(),
  });

  orgs.post('/', requireAuth, authenticatedRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createOrgSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const user = c.get('user');

    // Org creation + the creator's owner membership must succeed or fail
    // together. `withUserContext` already runs inside a transaction (see
    // @bebest/database/src/client.ts); `organizations` itself is not RLS'd
    // (see rls.sql), so it's safe to create inside the same transaction that
    // sets `app.current_user` for the membership insert's WITH CHECK. The
    // slug insert uses ON CONFLICT DO NOTHING, so a lost race never aborts
    // this transaction (lib/org-slug.ts).
    let org;
    try {
      org = await withUserContext(user.id, async (tx) => {
        const created = await createOrganizationWithUniqueSlug(tx, {
          name: parsed.data.name,
          slug: parsed.data.slug,
          strict: parsed.data.strictSlug === true,
          createdBy: user.id,
        });
        await tx.memberships.create({
          data: { organization_id: created.id, user_id: user.id, role: 'owner' },
        });
        return created;
      });
    } catch (err) {
      if (err instanceof OrgSlugTakenError) {
        return c.json({ error: 'Slug already taken', code: 'slug_taken', slug: err.slug }, 409);
      }
      throw err;
    }

    await writeAuditEvent({
      userId: user.id,
      organizationId: org.id,
      actorType: 'user',
      actorRole: 'owner',
      action: 'organization.created',
      entityType: 'organization',
      entityId: org.id,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: 'success',
      details: { name: org.name, slug: org.slug, requestedSlug: parsed.data.slug ?? null },
    });

    return c.json({ id: org.id, name: org.name, slug: org.slug }, 201);
  });

  // ── Invitation preview (PUBLIC) ─────────────────────────────────────────
  // Backs the web's `/invitations/accept?token=…` page before the visitor
  // has signed in: whose org, who invited them, which role, and whether the
  // link is still usable. Registered before `/:slug` so the literal segment
  // wins. Public-rate-limited (30/min/IP); the token is 32 random bytes and
  // only its SHA-256 is stored, so there is nothing to enumerate — and every
  // dead token gets the same 404 (INVITATION_NOT_FOUND).
  orgs.get('/invitations/preview', publicRateLimit, async (c) => {
    const token = c.req.query('token');
    if (!token || token.length > 512) return c.json(INVITATION_NOT_FOUND, 404);

    const invitation = await db.invitations.findFirst({
      where: { token_hash: hashToken(token) },
      include: {
        organizations: { select: { name: true, deleted_at: true } },
        users: { select: { name: true } },
      },
    });
    if (!invitation || invitation.revoked_at || invitation.organizations.deleted_at) {
      return c.json(INVITATION_NOT_FOUND, 404);
    }

    return c.json({
      organizationName: invitation.organizations.name,
      inviterName: invitation.users.name,
      role: invitation.role,
      email: maskEmail(invitation.email),
      expired: invitation.expires_at < new Date(),
      accepted: invitation.accepted_at !== null,
    });
  });

  // ── Get org ──────────────────────────────────────────────────────────────────
  orgs.get('/:slug', requireAuth, authenticatedRateLimit, requireOrgBySlug('viewer'), (c) => {
    const org = c.get('org');
    return c.json({ id: org.organizationId, name: org.name, slug: org.slug, role: org.role });
  });

  // ── Update org ────────────────────────────────────────────────────────────────
  //
  // Epic 22 Phase 2: rename only. The slug is IMMUTABLE in Phase 2 — it is
  // the address every `:slug` route, every persisted web selection and
  // every outstanding token refresh uses, and changing it safely needs a
  // redirect/alias story that does not exist yet. A body carrying a
  // different `slug` is rejected (422 `slug_immutable`) rather than
  // silently ignored, so a client can't believe it renamed the address.
  // Audited as `settings.changed` with the old and new name.
  const updateOrgSchema = z.object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine(isSluggable, { message: 'Organization name must contain at least one letter or number' }),
    slug: z.string().optional(),
  });

  orgs.patch('/:slug', requireAuth, authenticatedRateLimit, requireOrgBySlug('admin'), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateOrgSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const org = c.get('org');
    if (parsed.data.slug !== undefined && parsed.data.slug !== org.slug) {
      return c.json(
        { error: 'slug_immutable', message: 'An organization’s URL slug cannot be changed. Only the name can.' },
        422,
      );
    }

    if (parsed.data.name === org.name) {
      return c.json({ id: org.organizationId, name: org.name, slug: org.slug });
    }

    const updated = await db.organizations.update({
      where: { id: org.organizationId },
      data: { name: parsed.data.name, updated_at: new Date() },
    });

    const user = c.get('user');
    await writeAuditEvent({
      userId: user.id,
      organizationId: org.organizationId,
      actorType: 'user',
      actorRole: org.role,
      action: 'settings.changed',
      entityType: 'organization',
      entityId: org.organizationId,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: 'success',
      oldValue: { name: org.name },
      newValue: { name: updated.name },
      details: { field: 'name', viaAgencyOrgId: org.viaAgencyOrgId ?? null },
    });

    return c.json({ id: updated.id, name: updated.name, slug: updated.slug });
  });

  // ── Delete org (owner only, always audited) — soft delete ──────────────────
  //
  // Epic 22 Phase 2: requires a typed confirmation — `{ confirmName }` must
  // equal the organization's current name exactly (after trimming) — so a
  // stray DELETE cannot remove a workspace. Soft delete only (`deleted_at`);
  // nothing is destroyed. What that means for everything hanging off it:
  //   - memberships are KEPT (history), but every read path filters the org
  //     out: `/auth/me`, `GET /orgs`, `select-org` and `/refresh` refuse it,
  //     and `requireOrgBySlug`/`requireOrgFromToken` 403/404 it — so a token
  //     already minted for it stops working on its very next request;
  //   - pending invitations are revoked (their links stop working);
  //   - sessions are user-level, not org-level, so nobody is signed out —
  //     members of other orgs keep working there.
  // The internal ops org (`kind = 'internal'`, CRM_INTERNAL_ORG_ID) cannot
  // be deleted from here: every CRM route depends on it.
  const deleteOrgSchema = z.object({ confirmName: z.string().max(200) });

  orgs.delete(
    '/:slug',
    requireAuth,
    authenticatedRateLimit,
    requireOrgBySlug('viewer'),
    requirePermission('delete_organization'),
    auditLog({
      action: 'organization.deleted',
      entityType: 'organization',
      getEntityId: (c) => c.get('org')?.organizationId,
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = deleteOrgSchema.safeParse(body);
      const org = c.get('org');
      if (!parsed.success || parsed.data.confirmName.trim() !== org.name.trim()) {
        return c.json(
          {
            error: 'confirmation_mismatch',
            message: 'Type the organization’s exact name in `confirmName` to delete it.',
          },
          422,
        );
      }

      const row = await db.organizations.findUnique({ where: { id: org.organizationId }, select: { kind: true } });
      if (row?.kind === 'internal') {
        return c.json(
          { error: 'internal_org', message: 'The internal BeBest operations organization cannot be deleted.' },
          409,
        );
      }

      const now = new Date();
      await db.$transaction([
        db.organizations.updateMany({
          where: { id: org.organizationId, deleted_at: null },
          data: { deleted_at: now, updated_at: now },
        }),
        db.invitations.updateMany({
          where: { organization_id: org.organizationId, accepted_at: null, revoked_at: null },
          data: { revoked_at: now },
        }),
      ]);
      return c.json({ success: true, deletedAt: now });
    },
  );

  // ── List members ──────────────────────────────────────────────────────────
  orgs.get('/:slug/members', requireAuth, authenticatedRateLimit, requireOrgBySlug('viewer'), async (c) => {
    const org = c.get('org');
    // memberships' RLS policy is an OR of user-scoped and org-scoped
    // clauses (see @bebest/database rls.sql) — reading every member of this
    // org (not just the caller's own row) requires `withOrgContext`, not
    // `withUserContext`. See @bebest/database DECISIONS.md §7a.
    // Epic 19 (Production Hardening), item 6 — capped server-side (this call
    // had no cap at all before this epic).
    const members = await withOrgContext(org.organizationId, (tx) =>
      tx.memberships.findMany({
        where: { organization_id: org.organizationId },
        include: { users: { select: { id: true, email: true, name: true } } },
        orderBy: { created_at: 'asc' },
        take: 200,
      }),
    );

    return c.json(
      members.map((m) => ({
        userId: m.user_id,
        email: m.users.email,
        name: m.users.name,
        role: m.role,
        joinedAt: m.created_at,
      })),
    );
  });

  // ── Change member role (always audited — SECURITY.md) ───────────────────────
  const changeRoleSchema = z.object({
    role: z.enum(['admin', 'analyst', 'editor', 'viewer']),
  });

  orgs.patch(
    '/:slug/members/:userId',
    requireAuth,
    authenticatedRateLimit,
    requireOrgBySlug('viewer'),
    requirePermission('manage_team'),
    auditLog({ action: 'membership.role_changed', entityType: 'membership' }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = changeRoleSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
      }

      const org = c.get('org');
      const targetUserId = c.req.param('userId');

      const target = await withOrgContext(org.organizationId, (tx) =>
        tx.memberships.findFirst({
          where: { organization_id: org.organizationId, user_id: targetUserId },
        }),
      );
      if (!target) return c.json({ error: 'Member not found' }, 404);
      if (target.role === 'owner') return c.json({ error: 'Cannot change owner role' }, 403);

      await withOrgContext(org.organizationId, (tx) =>
        tx.memberships.update({
          where: { id: target.id },
          data: { role: parsed.data.role, updated_at: new Date() },
        }),
      );

      return c.json({ success: true });
    },
  );

  // ── Remove member ─────────────────────────────────────────────────────────
  orgs.delete(
    '/:slug/members/:userId',
    requireAuth,
    authenticatedRateLimit,
    requireOrgBySlug('viewer'),
    requirePermission('manage_team'),
    auditLog({ action: 'membership.removed', entityType: 'membership' }),
    async (c) => {
      const org = c.get('org');
      const targetUserId = c.req.param('userId');

      const target = await withOrgContext(org.organizationId, (tx) =>
        tx.memberships.findFirst({
          where: { organization_id: org.organizationId, user_id: targetUserId },
        }),
      );
      if (!target) return c.json({ error: 'Member not found' }, 404);
      if (target.role === 'owner') return c.json({ error: 'Cannot remove owner' }, 403);

      await withOrgContext(org.organizationId, (tx) => tx.memberships.delete({ where: { id: target.id } }));
      return c.json({ success: true });
    },
  );

  // ── Send invitation ───────────────────────────────────────────────────────
  const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'analyst', 'editor', 'viewer']).default('viewer'),
  });

  orgs.post(
    '/:slug/invitations',
    requireAuth,
    authenticatedRateLimit,
    requireOrgBySlug('viewer'),
    requirePermission('manage_team'),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = inviteSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
      }

      const org = c.get('org');
      const user = c.get('user');
      const { token, hash } = generateOpaqueToken(32);
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

      // `invitations` is deliberately NOT RLS-protected (see
      // @bebest/database rls.sql's "Special case — invitations") because
      // redeeming one happens before the caller has any org context to
      // prove — so plain `db`, not `withOrgContext`, is correct here too,
      // not just at the accept step below.
      // Cancel any existing pending invite for this email+org first.
      await db.invitations.deleteMany({
        where: { organization_id: org.organizationId, email: parsed.data.email, accepted_at: null },
      });

      await db.invitations.create({
        data: {
          organization_id: org.organizationId,
          invited_by: user.id,
          email: parsed.data.email,
          role: parsed.data.role,
          token_hash: hash,
          expires_at: expiresAt,
        },
      });

      // Epic 21 (Final Audit) follow-up: this used to call `console.log`
      // directly instead of going through `EmailSender`, the swappable
      // provider abstraction every other email in this codebase uses (see
      // routes/auth.ts's identical `createAuthRoutes(emailSender)`
      // pattern). Same URL convention as auth.ts's magic link — there is
      // no frontend invite-accept page yet (a separate, larger, already
      // pre-existing gap — see apps/web/src/app/(app)/settings/page.tsx's
      // own "invites are stubbed" note), so this link isn't renderable
      // today, but the email-delivery mechanism itself is now the real
      // abstraction instead of a hardcoded console.log call site.
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      await emailSender.sendInvitation({
        to: parsed.data.email,
        organizationName: org.name,
        inviteUrl: `${appUrl}/invitations/accept?token=${token}`,
      });

      return c.json({ success: true, expiresAt }, 201);
    },
  );

  // ── Accept invitation ─────────────────────────────────────────────────────
  //
  // Epic 22 Phase 2. Every refusal keeps its original status and `error`
  // text (existing clients match on them) and adds a machine `code`:
  //   400 invalid_request · 404 invalid_token · 410 organization_deleted |
  //   revoked | expired · 409 already_accepted · 403 email_mismatch.
  // The accept is a conditional UPDATE (`accepted_at IS NULL`), so two
  // concurrent accepts of one token produce exactly one membership and one
  // 409. A caller who is ALREADY a member gets 200 with
  // `alreadyMember: true` and their existing role untouched — accepting
  // must never silently change someone's role. The response carries the
  // org slug so the web can call `/auth/select-org` next.
  orgs.post('/invitations/accept', requireAuth, authenticatedRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ token: z.string().min(1).max(512) }).safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid token', code: 'invalid_request' }, 400);

    const tokenHash = hashToken(parsed.data.token);
    const invitation = await db.invitations.findFirst({
      where: { token_hash: tokenHash },
      include: { organizations: { select: { id: true, name: true, slug: true, deleted_at: true } } },
    });

    if (!invitation) return c.json({ error: 'Invalid token', code: 'invalid_token' }, 404);
    const organization = invitation.organizations;
    if (organization.deleted_at) {
      return c.json({ error: 'This organization no longer exists', code: 'organization_deleted' }, 410);
    }
    if (invitation.accepted_at) return c.json({ error: 'Already accepted', code: 'already_accepted' }, 409);
    if (invitation.revoked_at) return c.json({ error: 'Invitation revoked', code: 'revoked' }, 410);
    if (invitation.expires_at < new Date()) return c.json({ error: 'Invitation expired', code: 'expired' }, 410);

    const user = c.get('user');
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return c.json(
        {
          error: 'This invitation was sent to a different email address',
          code: 'email_mismatch',
          message: `This invitation was sent to ${maskEmail(invitation.email)}. Sign in with that address to accept it.`,
        },
        403,
      );
    }

    const outcome = await withUserContext(user.id, async (tx) => {
      const claimed = await tx.invitations.updateMany({
        where: { id: invitation.id, accepted_at: null, revoked_at: null },
        data: { accepted_at: new Date() },
      });
      if (claimed.count === 0) return { kind: 'already_accepted' } as const;

      const existing = await tx.memberships.findFirst({
        where: { organization_id: invitation.organization_id, user_id: user.id },
      });
      if (existing) return { kind: 'ok', role: existing.role, alreadyMember: true } as const;

      await tx.memberships.create({
        data: {
          organization_id: invitation.organization_id,
          user_id: user.id,
          role: invitation.role,
          created_by: invitation.invited_by,
        },
      });
      return { kind: 'ok', role: invitation.role, alreadyMember: false } as const;
    });

    if (outcome.kind === 'already_accepted') {
      return c.json({ error: 'Already accepted', code: 'already_accepted' }, 409);
    }

    await writeAuditEvent({
      userId: user.id,
      organizationId: invitation.organization_id,
      actorType: 'user',
      actorRole: outcome.role,
      action: 'invitation.accepted',
      entityType: 'invitation',
      entityId: invitation.id,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: 'success',
      details: { role: outcome.role, alreadyMember: outcome.alreadyMember, invitedBy: invitation.invited_by },
    });

    // Tell the inviter — only a newly-created membership is news, and only
    // while the inviter is still a member (a removed inviter can no longer
    // see the org's notifications). A notification failure never fails the
    // accept: the membership is already committed.
    if (!outcome.alreadyMember && invitation.invited_by !== user.id) {
      try {
        const inviterStillMember = await withOrgContext(invitation.organization_id, (tx) =>
          tx.memberships.findFirst({
            where: { organization_id: invitation.organization_id, user_id: invitation.invited_by },
            select: { id: true },
          }),
        );
        if (inviterStillMember) {
          await notify(
            {
              organizationId: invitation.organization_id,
              userId: invitation.invited_by,
              type: 'invitation_accepted',
              title: `${user.name || user.email} joined ${organization.name}`,
              body: `${user.email} accepted your invitation and joined as ${outcome.role}.`,
              actionUrl: '/settings?tab=team',
            },
            { emailSender },
          );
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'invitation_accepted_notify_failed',
            invitationId: invitation.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    return c.json({
      success: true,
      organizationId: invitation.organization_id,
      organizationSlug: organization.slug,
      organizationName: organization.name,
      role: outcome.role,
      alreadyMember: outcome.alreadyMember,
    });
  });

  return orgs;
}
