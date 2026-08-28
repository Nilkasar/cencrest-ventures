import { Hono } from 'hono'
import { z } from 'zod'
import * as argon2 from 'argon2'
import { randomBytes, createHash } from 'crypto'
import { db } from '../lib/db.js'
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashToken, refreshTokenExpiry } from '../lib/jwt.js'
import { rateLimit } from '../middleware/ratelimit.js'
import type { AppEnv } from '../types/context.js'

const auth = new Hono<AppEnv>()

const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4 }
const BRUTE_FORCE_LIMIT = rateLimit({ max: 10, windowMs: 15 * 60 * 1000 })

async function logAuthEvent(userId: string | null, eventType: string, ip: string, ua: string, metadata?: object) {
  await db.auth_events.create({ data: { user_id: userId, event_type: eventType, ip_address: ip, user_agent: ua, metadata } }).catch(() => {})
}

// ── Register ─────────────────────────────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
})

auth.post('/register', BRUTE_FORCE_LIMIT, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422)

  const { email, password, name } = parsed.data
  const ip = c.req.header('x-forwarded-for') ?? 'unknown'
  const ua = c.req.header('user-agent') ?? ''

  const existing = await db.users.findUnique({ where: { email } })
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS)

  const user = await db.users.create({
    data: { email, password_hash: passwordHash, name, email_verified: false },
  })

  await logAuthEvent(user.id, 'register', ip, ua)

  const accessToken = await signAccessToken({ sub: user.id, email: user.email })
  const { token: refreshToken, hash: rtHash } = generateRefreshToken()

  await db.refresh_tokens.create({
    data: { user_id: user.id, token: rtHash, expires_at: refreshTokenExpiry() },
  })

  return c.json({ accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name } }, 201)
})

// ── Login ─────────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

auth.post('/login', BRUTE_FORCE_LIMIT, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid credentials' }, 401)

  const { email, password } = parsed.data
  const ip = c.req.header('x-forwarded-for') ?? 'unknown'
  const ua = c.req.header('user-agent') ?? ''

  const user = await db.users.findUnique({ where: { email } })
  if (!user || user.deleted_at) {
    await logAuthEvent(null, 'login_failed', ip, ua, { email })
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await argon2.verify(user.password_hash, password)
  if (!valid) {
    await logAuthEvent(user.id, 'login_failed', ip, ua)
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  await db.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } })
  await logAuthEvent(user.id, 'login', ip, ua)

  const accessToken = await signAccessToken({ sub: user.id, email: user.email })
  const { token: refreshToken, hash: rtHash } = generateRefreshToken()

  await db.refresh_tokens.create({
    data: { user_id: user.id, token: rtHash, expires_at: refreshTokenExpiry() },
  })

  return c.json({ accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name } })
})

// ── Refresh token ─────────────────────────────────────────────────────────────
auth.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null)
  const token = body?.refreshToken
  if (!token || typeof token !== 'string') return c.json({ error: 'Refresh token required' }, 400)

  const hash = hashToken(token)
  const rt = await db.refresh_tokens.findUnique({ where: { token: hash } })

  if (!rt || rt.revoked_at || rt.expires_at < new Date()) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401)
  }

  const user = await db.users.findUnique({ where: { id: rt.user_id } })
  if (!user || user.deleted_at) return c.json({ error: 'User not found' }, 401)

  // Rotate: revoke old, issue new
  await db.refresh_tokens.update({ where: { id: rt.id }, data: { revoked_at: new Date() } })

  const { token: newRefresh, hash: newHash } = generateRefreshToken()
  await db.refresh_tokens.create({
    data: { user_id: user.id, token: newHash, expires_at: refreshTokenExpiry() },
  })

  const accessToken = await signAccessToken({ sub: user.id, email: user.email })
  return c.json({ accessToken, refreshToken: newRefresh })
})

// ── Logout ────────────────────────────────────────────────────────────────────
auth.post('/logout', async (c) => {
  const body = await c.req.json().catch(() => null)
  const token = body?.refreshToken
  if (token) {
    const hash = hashToken(token)
    await db.refresh_tokens.updateMany({ where: { token: hash }, data: { revoked_at: new Date() } }).catch(() => {})
  }
  return c.json({ success: true })
})

// ── Magic link send ───────────────────────────────────────────────────────────
const magicLinkSchema = z.object({ email: z.string().email() })

auth.post('/magic-link', BRUTE_FORCE_LIMIT, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = magicLinkSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Valid email required' }, 422)

  const { email } = parsed.data
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min

  await db.magic_link_tokens.create({ data: { email, token_hash: tokenHash, expires_at: expiresAt } })

  // TODO Epic 3+: send email via Resend
  // Link: ${APP_URL}/auth/magic?token=${rawToken}
  console.log(`[DEV] Magic link token for ${email}: ${rawToken}`)

  return c.json({ success: true })
})

// ── Magic link verify ─────────────────────────────────────────────────────────
auth.get('/magic-link/verify', async (c) => {
  const rawToken = c.req.query('token')
  if (!rawToken) return c.json({ error: 'Token required' }, 400)

  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const mlt = await db.magic_link_tokens.findFirst({ where: { token_hash: tokenHash } })

  if (!mlt) return c.json({ error: 'Invalid token' }, 404)
  if (mlt.used_at) return c.json({ error: 'Token already used' }, 400)
  if (mlt.expires_at < new Date()) return c.json({ error: 'Token expired' }, 410)

  await db.magic_link_tokens.update({ where: { id: mlt.id }, data: { used_at: new Date() } })

  let user = await db.users.findUnique({ where: { email: mlt.email } })
  if (!user) {
    user = await db.users.create({
      data: { email: mlt.email, password_hash: '', name: mlt.email.split('@')[0], email_verified: true },
    })
  } else if (!user.email_verified) {
    await db.users.update({ where: { id: user.id }, data: { email_verified: true } })
  }

  const accessToken = await signAccessToken({ sub: user.id, email: user.email })
  const { token: refreshToken, hash: rtHash } = generateRefreshToken()
  await db.refresh_tokens.create({ data: { user_id: user.id, token: rtHash, expires_at: refreshTokenExpiry() } })

  return c.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } })
})

// ── Password reset request ────────────────────────────────────────────────────
auth.post('/password-reset/request', BRUTE_FORCE_LIMIT, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = magicLinkSchema.safeParse(body)
  if (!parsed.success) return c.json({ success: true }) // don't reveal whether email exists

  const user = await db.users.findUnique({ where: { email: parsed.data.email } })
  if (!user) return c.json({ success: true }) // silent — don't enumerate users

  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  await db.password_reset_tokens.create({
    data: { user_id: user.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 60 * 60 * 1000) },
  })

  // TODO: send reset email via Resend
  console.log(`[DEV] Password reset token for ${parsed.data.email}: ${rawToken}`)
  return c.json({ success: true })
})

// ── Password reset confirm ────────────────────────────────────────────────────
const resetConfirmSchema = z.object({
  token: z.string().length(64),
  password: z.string().min(8).max(128),
})

auth.post('/password-reset/confirm', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = resetConfirmSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422)

  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex')
  const prt = await db.password_reset_tokens.findFirst({ where: { token_hash: tokenHash } })

  if (!prt) return c.json({ error: 'Invalid token' }, 404)
  if (prt.used_at) return c.json({ error: 'Token already used' }, 400)
  if (prt.expires_at < new Date()) return c.json({ error: 'Token expired' }, 410)

  const passwordHash = await argon2.hash(parsed.data.password, ARGON2_OPTIONS)

  await db.users.update({ where: { id: prt.user_id }, data: { password_hash: passwordHash, updated_at: new Date() } })
  await db.password_reset_tokens.update({ where: { id: prt.id }, data: { used_at: new Date() } })
  // Revoke all existing refresh tokens
  await db.refresh_tokens.updateMany({ where: { user_id: prt.user_id, revoked_at: null }, data: { revoked_at: new Date() } })

  return c.json({ success: true })
})

// ── /me ───────────────────────────────────────────────────────────────────────
auth.get('/me', async (c) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)

  const token = authHeader.slice(7)
  let payload: { sub: string; email: string }
  try {
    payload = await verifyAccessToken(token)
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  const user = await db.users.findUnique({ where: { id: payload.sub } })
  if (!user || user.deleted_at) return c.json({ error: 'User not found' }, 401)

  const memberships = await db.memberships.findMany({
    where: { user_id: user.id },
    include: { organizations: { select: { id: true, name: true, slug: true } } },
  })

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.email_verified,
    organizations: memberships.map((m) => ({
      id: m.organizations.id,
      name: m.organizations.name,
      slug: m.organizations.slug,
      role: m.role,
    })),
  })
})

export default auth
