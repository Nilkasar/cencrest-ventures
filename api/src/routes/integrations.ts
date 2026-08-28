import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { isPrivateIp } from '../lib/meta-fetch.js'

// TODO: Replace with shared AES-256-GCM module once src/lib/ai-provider.ts encryption is available.
// For now, store config as plaintext JSON in config_enc field.
function encodeConfig(config: object): object {
  return config
}

const VALID_TYPES = ['ga4', 'gsc', 'slack', 'hubspot', 'salesforce', 'zapier', 'webhook'] as const
type IntegrationType = typeof VALID_TYPES[number]

function validateHttpsUrl(raw: string): { ok: boolean; hostname?: string } {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return { ok: false }
    if (isPrivateIp(url.hostname)) return { ok: false }
    return { ok: true, hostname: url.hostname }
  } catch {
    return { ok: false }
  }
}

const integrations = new Hono<AppEnv>()

// GET / — list integrations (viewer)
integrations.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const rows = await db.integrations.findMany({
    where: { organization_id: organizationId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      integration_type: true,
      status: true,
      last_synced_at: true,
    },
  })

  return c.json(rows)
})

// POST /:type/connect — create/update integration (admin)
integrations.post('/:type/connect', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const type = c.req.param('type') as IntegrationType

  if (!VALID_TYPES.includes(type)) {
    return c.json({ error: 'Invalid integration type' }, 400)
  }

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }

  let configToStore: object

  if (type === 'slack') {
    const webhookUrl = body.webhook_url as string | undefined
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return c.json({ error: 'webhook_url is required' }, 422)
    }
    const check = validateHttpsUrl(webhookUrl)
    if (!check.ok) {
      return c.json({ error: 'webhook_url must be a valid HTTPS URL and not a private IP' }, 422)
    }
    configToStore = encodeConfig({ webhook_url: webhookUrl })
  } else if (type === 'webhook') {
    const url = body.url as string | undefined
    const events = body.events as string[] | undefined
    if (!url || typeof url !== 'string') {
      return c.json({ error: 'url is required' }, 422)
    }
    if (!events || !Array.isArray(events)) {
      return c.json({ error: 'events is required' }, 422)
    }
    const check = validateHttpsUrl(url)
    if (!check.ok) {
      return c.json({ error: 'url must be a valid HTTPS URL and not a private IP' }, 422)
    }
    const secret = randomBytes(32).toString('hex')
    configToStore = encodeConfig({ url, events, secret })
  } else if (type === 'ga4') {
    const propertyId = body.property_id as string | undefined
    const credentials = body.credentials as object | undefined
    if (!propertyId) return c.json({ error: 'property_id is required' }, 422)
    if (!credentials) return c.json({ error: 'credentials is required' }, 422)
    configToStore = encodeConfig({ property_id: propertyId, credentials })
  } else if (type === 'gsc') {
    const siteUrl = body.site_url as string | undefined
    const credentials = body.credentials as object | undefined
    if (!siteUrl) return c.json({ error: 'site_url is required' }, 422)
    if (!credentials) return c.json({ error: 'credentials is required' }, 422)
    configToStore = encodeConfig({ site_url: siteUrl, credentials })
  } else {
    const config = body.config as object | undefined
    configToStore = encodeConfig(config ?? {})
  }

  const existing = await db.integrations.findFirst({
    where: { organization_id: organizationId, integration_type: type },
  })

  let record
  if (existing) {
    record = await db.integrations.update({
      where: { id: existing.id },
      data: {
        config_enc: configToStore,
        status: 'connected',
        updated_at: new Date(),
      },
      select: { id: true, integration_type: true, status: true, last_synced_at: true, created_at: true, updated_at: true },
    })
  } else {
    record = await db.integrations.create({
      data: {
        organization_id: organizationId,
        integration_type: type,
        config_enc: configToStore,
        status: 'connected',
      },
      select: { id: true, integration_type: true, status: true, last_synced_at: true, created_at: true, updated_at: true },
    })
  }

  return c.json(record, 201)
})

// DELETE /:integrationId — soft-disconnect (admin)
integrations.delete('/:integrationId', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const integrationId = c.req.param('integrationId')

  const existing = await db.integrations.findFirst({
    where: { id: integrationId, organization_id: organizationId },
  })
  if (!existing) return c.json({ error: 'Integration not found' }, 404)

  await db.integrations.update({
    where: { id: integrationId },
    data: { status: 'disconnected', updated_at: new Date() },
  })

  return c.json({ success: true })
})

// POST /webhooks — create custom webhook integration (admin)
integrations.post('/webhooks', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const url = body.url as string | undefined
  const events = body.events as string[] | undefined
  const description = body.description as string | undefined

  if (!url || typeof url !== 'string') {
    return c.json({ error: 'url is required' }, 422)
  }
  if (!events || !Array.isArray(events)) {
    return c.json({ error: 'events is required' }, 422)
  }

  const check = validateHttpsUrl(url)
  if (!check.ok) {
    return c.json({ error: 'url must be a valid HTTPS URL and not a private IP' }, 422)
  }

  const secret = randomBytes(32).toString('hex')
  const config = encodeConfig({ url, events, secret, description: description ?? null })

  const existing = await db.integrations.findFirst({
    where: { organization_id: organizationId, integration_type: 'webhook' },
  })

  let record
  if (existing) {
    record = await db.integrations.update({
      where: { id: existing.id },
      data: { config_enc: config, status: 'connected', updated_at: new Date() },
      select: { id: true },
    })
  } else {
    record = await db.integrations.create({
      data: {
        organization_id: organizationId,
        integration_type: 'webhook',
        config_enc: config,
        status: 'connected',
      },
      select: { id: true },
    })
  }

  return c.json({ id: record.id, url, events, secret }, 201)
})

// GET /webhooks/:webhookId/log — delivery log (viewer)
integrations.get('/webhooks/:webhookId/log', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const webhookId = c.req.param('webhookId')

  const integration = await db.integrations.findFirst({
    where: { id: webhookId, organization_id: organizationId, integration_type: 'webhook' },
  })
  if (!integration) return c.json({ error: 'Webhook integration not found' }, 404)

  const deliveries = await db.webhook_deliveries.findMany({
    where: { integration_id: webhookId },
    orderBy: { delivered_at: 'desc' },
    take: 100,
  })

  return c.json(deliveries)
})

export default integrations
