import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types/context.js'
import type { role } from '@prisma/client'
import { db } from '../lib/db.js'
import { isAtLeast } from '../lib/rbac.js'

/**
 * Resolves the authenticated user from the request.
 * STUB: Epic 3 will replace this with real JWT verification.
 * For now, reads X-User-Id header (dev only, never in production).
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Authentication required' }, 401)
  }

  const userId = c.req.header('x-user-id')
  if (!userId) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  const user = await db.users.findUnique({ where: { id: userId } })
  if (!user || user.deleted_at) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  c.set('user', { id: user.id, email: user.email, name: user.name })
  return next()
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
