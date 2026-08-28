import type { role } from '@prisma/client'

const ROLE_RANK: Record<role, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
}

export function hasRole(userRole: role, required: role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required]
}

export function isAtLeast(userRole: role, minRole: role): boolean {
  return hasRole(userRole, minRole)
}
