import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types/context.js'
import type { role } from '@prisma/client'
import { db } from '../lib/db.js'
import { isAtLeast } from '../lib/rbac.js'
import { verifyAccessToken } from '../lib/jwt.js'

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('authorization')

  // Dev convenience: X-User-Id header bypasses JWT (non-production only)
  if (process.env.NODE_ENV !== 'production' && c.req.header('x-user-id')) {
    const userId = c.req.header('x-user-id')!
    const user = await db.users.findUnique({ where: { id: userId } })
    if (user && !user.deleted_at) {
      c.set('user', { id: user.id, email: user.email, name: user.name })
      return next()
    }
  }

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  try {
    const payload = await verifyAccessToken(authHeader.slice(7))
    const user = await db.users.findUnique({ where: { id: payload.sub } })
    if (!user || user.deleted_at) return c.json({ error: 'Authentication required' }, 401)
    c.set('user', { id: user.id, email: user.email, name: user.name })
    return next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

/**
 * Resolves org from :slug param and asserts the user is a member
 * with at least `minRole`. Must run after requireAuth.
 */
export function requireOrgRole(minRole: role = 'viewer'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const slug = c.req.param('slug')
    const user = c.get('user')

    const org = await db.organizations.findUnique({ where: { slug } })
    if (!org || org.deleted_at) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const membership = await db.memberships.findFirst({
      where: { organization_id: org.id, user_id: user.id },
    })

    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    if (!isAtLeast(membership.role, minRole)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    c.set('org', { organizationId: org.id, name: org.name, slug: org.slug, role: membership.role, createdAt: org.created_at })
    return next()
  }
}
