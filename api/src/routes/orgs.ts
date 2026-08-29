import { Hono } from 'hono'
import { z } from 'zod'
import { randomBytes, createHash } from 'crypto'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { toSlug } from '../lib/slug.js'
import type { AppEnv } from '../types/context.js'
import agency from './agency.js'

const orgs = new Hono<AppEnv>()

orgs.route('/:slug/agency', agency)

// ── List orgs for current user ───────────────────────────────────────────────
orgs.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const memberships = await db.memberships.findMany({
    where: { user_id: user.id },
    include: { organizations: { select: { id: true, name: true, slug: true } } },
  })
  return c.json(memberships.map(m => ({
    id: m.organizations.id,
    name: m.organizations.name,
    slug: m.organizations.slug,
    role: m.role,
  })))
})

// ── Create org ───────────────────────────────────────────────────────────────
const createOrgSchema = z.object({
  name: z.string().min(2).max(100),
})

orgs.post('/', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = createOrgSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422)

  const user = c.get('user')
  const slug = toSlug(parsed.data.name)

  const existing = await db.organizations.findUnique({ where: { slug } })
  if (existing) return c.json({ error: 'Slug already taken' }, 409)

  const org = await db.organizations.create({
    data: {
      name: parsed.data.name,
      slug,
      created_by: user.id,
    },
  })

  await db.memberships.create({
    data: { user_id: user.id, organization_id: org.id, role: 'owner' },
  })

  return c.json({ id: org.id, name: org.name, slug: org.slug }, 201)
})

// ── Get org ──────────────────────────────────────────────────────────────────
orgs.get('/:slug', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId, name, slug, createdAt } = c.get('org')
  return c.json({ id: organizationId, name, slug, createdAt })
})

// ── Update org ────────────────────────────────────────────────────────────────
const updateOrgSchema = z.object({ name: z.string().min(2).max(100).optional() })

orgs.patch('/:slug', requireAuth, requireOrgRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = updateOrgSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422)

  const { organizationId } = c.get('org')
  const org = await db.organizations.update({
    where: { id: organizationId },
    data: { name: parsed.data.name, updated_at: new Date() },
  })

  return c.json({ id: org.id, name: org.name, slug: org.slug })
})

// ── List members ──────────────────────────────────────────────────────────────
orgs.get('/:slug/members', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const members = await db.memberships.findMany({
    where: { organization_id: organizationId },
    include: { users: { select: { id: true, email: true, name: true } } },
    orderBy: { created_at: 'asc' },
  })

  return c.json(members.map((m) => ({
    userId: m.user_id,
    email: m.users.email,
    name: m.users.name,
    role: m.role,
    joinedAt: m.created_at,
  })))
})

// ── Change member role ────────────────────────────────────────────────────────
const changeRoleSchema = z.object({ role: z.enum(['admin', 'member', 'viewer']) })

orgs.patch('/:slug/members/:userId', requireAuth, requireOrgRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = changeRoleSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422)

  const { organizationId } = c.get('org')
  const targetUserId = c.req.param('userId')

  const target = await db.memberships.findFirst({
    where: { organization_id: organizationId, user_id: targetUserId },
  })
  if (!target) return c.json({ error: 'Member not found' }, 404)
  if (target.role === 'owner') return c.json({ error: 'Cannot change owner role' }, 403)

  await db.memberships.update({
    where: { id: target.id },
    data: { role: parsed.data.role, updated_at: new Date() },
  })

  return c.json({ success: true })
})

// ── Remove member ─────────────────────────────────────────────────────────────
orgs.delete('/:slug/members/:userId', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const targetUserId = c.req.param('userId')
  const currentUser = c.get('user')

  const target = await db.memberships.findFirst({
    where: { organization_id: organizationId, user_id: targetUserId },
  })
  if (!target) return c.json({ error: 'Member not found' }, 404)
  if (target.role === 'owner') return c.json({ error: 'Cannot remove owner' }, 403)

  await db.memberships.delete({ where: { id: target.id } })

  return c.json({ success: true })
})

// ── Send invitation ───────────────────────────────────────────────────────────
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
})

orgs.post('/:slug/invitations', requireAuth, requireOrgRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422)

  const { organizationId } = c.get('org')
  const user = c.get('user')

  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  // Upsert: cancel any existing pending invite for this email+org
  await db.invitations.deleteMany({
    where: { organization_id: organizationId, email: parsed.data.email, accepted_at: null },
  })

  await db.invitations.create({
    data: {
      organization_id: organizationId,
      invited_by: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
  })

  // TODO Epic 3+: send invitation email via Resend with magic link containing `token`
  // The raw token (not the hash) goes in the email. Never stored in DB.
  console.log(`[DEV] Invitation token for ${parsed.data.email}: ${token}`)

  return c.json({ success: true, expiresAt }, 201)
})

// ── Accept invitation ─────────────────────────────────────────────────────────
const acceptSchema = z.object({ token: z.string().length(64) })

orgs.post('/invitations/accept', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = acceptSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid token' }, 400)

  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex')
  const invitation = await db.invitations.findFirst({ where: { token_hash: tokenHash } })

  if (!invitation) return c.json({ error: 'Invalid token' }, 404)
  if (invitation.accepted_at) return c.json({ error: 'Already accepted' }, 409)
  if (invitation.expires_at < new Date()) return c.json({ error: 'Invitation expired' }, 410)

  await db.invitations.update({
    where: { id: invitation.id },
    data: { accepted_at: new Date() },
  })

  // TODO Epic 3: create or link user account, create membership
  return c.json({
    success: true,
    organizationId: invitation.organization_id,
    email: invitation.email,
    role: invitation.role,
  })
})

export default orgs
