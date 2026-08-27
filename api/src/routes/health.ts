import { Hono } from 'hono'
import { db } from '../lib/db.js'

const health = new Hono()

health.get('/', async (c) => {
  let dbOk = false
  try {
    await db.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    dbOk = false
  }

  const status = dbOk ? 'ok' : 'degraded'
  const code = dbOk ? 200 : 503

  return c.json(
    {
      status,
      version: process.env.npm_package_version ?? '0.1.0',
      db: dbOk ? 'connected' : 'unreachable',
      env: process.env.NODE_ENV ?? 'unknown',
      uptime: Math.floor(process.uptime()),
    },
    code,
  )
})

export default health
