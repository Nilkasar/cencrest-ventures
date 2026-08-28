import type { role } from '@prisma/client'

export interface AuthUser {
  id: string
  email: string
  name: string
}

export interface OrgContext {
  organizationId: string
  name: string
  slug: string
  role: role
  createdAt: Date
}

export type AppEnv = {
  Variables: {
    requestId: string
    user: AuthUser
    org: OrgContext
  }
}
