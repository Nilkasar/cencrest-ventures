import type { MiddlewareHandler } from 'hono'

export const requestId: MiddlewareHandler = async (c, next) => {
  const id = c.req.header('x-request-id') ?? crypto.randomUUID()
  c.header('x-request-id', id)
  return next()
}
