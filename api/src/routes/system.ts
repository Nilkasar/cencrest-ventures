import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { requireAuth } from '../middleware/auth.js'
import { deepHealthCheck, getSystemMetrics } from '../lib/health.js'
import { db } from '../lib/db.js'

const system = new Hono<AppEnv>()

system.get('/health', async (c) => {
  const health = await deepHealthCheck()
  const code = health.status === 'error' ? 503 : 200
  return c.json(health, code)
})

system.get('/health/ready', async (c) => {
  try {
    await db.$queryRaw`SELECT 1`
    return c.json({ ready: true }, 200)
  } catch {
    return c.json({ ready: false }, 503)
  }
})

system.get('/metrics', requireAuth, async (c) => {
  const metrics = await getSystemMetrics()
  return c.json(metrics)
})

system.get('/openapi', (c) => {
  return c.json({
    openapi: '3.0.0',
    info: {
      title: 'BeBest API',
      version: '1.0.0',
      description: 'Recommendation Intelligence API',
    },
    servers: [{ url: '/api' }],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: { '200': { description: 'OK' } },
        },
      },
      '/system/health/ready': {
        get: {
          summary: 'Readiness check',
          responses: { '200': { description: 'Ready' }, '503': { description: 'Not ready' } },
        },
      },
      '/orgs/{slug}/brands': {
        get: {
          summary: 'List brands',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/orgs/{slug}/brands/{brandId}/runs': {
        get: {
          summary: 'List runs',
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'brandId', in: 'path', required: true, schema: { type: 'string' } },
          ],
        },
      },
      '/orgs/{slug}/brands/{brandId}/keywords': {
        get: {
          summary: 'List keywords',
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'brandId', in: 'path', required: true, schema: { type: 'string' } },
          ],
        },
      },
    },
  })
})

export default system
