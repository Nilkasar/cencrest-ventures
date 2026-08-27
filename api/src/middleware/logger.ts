import type { MiddlewareHandler } from 'hono'
import { randomUUID } from 'crypto'

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const requestId = randomUUID()
  const start = Date.now()

  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)

  await next()

  const ms = Date.now() - start
  console.log(
    JSON.stringify({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms,
    }),
  )
}
