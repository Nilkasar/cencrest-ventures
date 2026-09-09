import { Hono } from 'hono';
import { z } from 'zod';
import { db, withUserContext, withOrgContext } from '@bebest/database';
import { isSluggable, toSlug } from '../lib/slug.js';
import { generateOpaqueToken } from '../lib/tokens.js';
import { hashToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgBySlug } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import type { EmailSender } from '../lib/email.js';
import type { AppEnv } from '../types/context.js';

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
        include: { organizations: { select: { id: true, name: true, slug: true } } },
        take: 100,
      }),
    );

    return c.json(
      memberships.map((m) => ({
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
  const createOrgSchema = z.object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine(isSluggable, {
        message: 'Organization name must contain at least one letter or number',
      }),
  });

  orgs.post('/', requireAuth, authenticatedRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createOrgSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const user = c.get('user');
    const slug = toSlug(parsed.data.name);

    const existing = await db.organizations.findUnique({ where: { slug } });
    if (existing) return c.json({ error: 'Slug already taken' }, 409);

    // Org creation + the creator's owner membership must succeed or fail
    // together. `withUserContext` already runs inside a transaction (see
    // @bebest/database/src/client.ts); `organizations` itself is not RLS'd
    // (see rls.sql), so it's safe to create inside the same transaction that
    // sets `app.current_user` for the membership insert's WITH CHECK.
    const org = await withUserContext(user.id, async (tx) => {
      const created = await tx.organizations.create({
        data: { name: parsed.data.name, slug, created_by: user.id },
      });
      await tx.memberships.create({
        data: { organization_id: created.id, user_id: user.id, role: 'owner' },
      });
      return created;
    });

    return c.json({ id: org.id, name: org.name, slug: org.slug }, 201);
  });

  // ── Get org ──────────────────────────────────────────────────────────────────
  orgs.get('/:slug', requireAuth, authenticatedRateLimit, requireOrgBySlug('viewer'), (c) => {
    const org = c.get('org');
    return c.json({ id: org.organizationId, name: org.name, slug: org.slug, role: org.role });
  });

  // ── Update org ────────────────────────────────────────────────────────────────
  const updateOrgSchema = z.object({ name: z.string().min(2).max(100).optional() });

  orgs.patch(
    '/:slug',
    requireAuth,
    authenticatedRateLimit,
    requireOrgBySlug('admin'),
    auditLog({ action: 'settings.changed', entityType: 'organization' }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = updateOrgSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
      }

      const org = c.get('org');
      const updated = await db.organizations.update({
        where: { id: org.organizationId },
        data: { name: parsed.data.name, updated_at: new Date() },
      });

      return c.json({ id: updated.id, name: updated.name, slug: updated.slug });
    },
  );

  // ── Delete org (owner only, always audited) — soft delete ──────────────────
  orgs.delete(
    '/:slug',
    requireAuth,
    authenticatedRateLimit,
    requireOrgBySlug('viewer'),
    requirePermission('delete_organization'),
    auditLog({ action: 'organization.deleted', entityType: 'organization' }),
    async (c) => {
      const org = c.get('org');
      await db.organizations.update({
        where: { id: org.organizationId },
        data: { deleted_at: new Date() },
      });
      return c.json({ success: true });
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
  orgs.post('/invitations/accept', requireAuth, authenticatedRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ token: z.string().min(1) }).safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid token' }, 400);

    const tokenHash = hashToken(parsed.data.token);
    const invitation = await db.invitations.findFirst({ where: { token_hash: tokenHash } });

    if (!invitation) return c.json({ error: 'Invalid token' }, 404);
    if (invitation.accepted_at) return c.json({ error: 'Already accepted' }, 409);
    if (invitation.revoked_at) return c.json({ error: 'Invitation revoked' }, 410);
    if (invitation.expires_at < new Date()) return c.json({ error: 'Invitation expired' }, 410);

    const user = c.get('user');
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return c.json({ error: 'This invitation was sent to a different email address' }, 403);
    }

    await withUserContext(user.id, async (tx) => {
      await tx.invitations.update({
        where: { id: invitation.id },
        data: { accepted_at: new Date() },
      });
      const existing = await tx.memberships.findFirst({
        where: { organization_id: invitation.organization_id, user_id: user.id },
      });
      if (!existing) {
        await tx.memberships.create({
          data: {
            organization_id: invitation.organization_id,
            user_id: user.id,
            role: invitation.role,
            created_by: invitation.invited_by,
          },
        });
      }
    });

    return c.json({
      success: true,
      organizationId: invitation.organization_id,
      role: invitation.role,
    });
  });

  return orgs;
}
