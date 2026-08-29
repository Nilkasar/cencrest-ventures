import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const whiteLabel = new Hono<AppEnv>()

const configSchema = z.object({
  brand_name: z.string().min(1).max(255),
  logo_url: z.string().url().optional(),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  custom_domain: z.string().optional(),
  support_email: z.string().email().optional(),
  hide_powered_by: z.boolean().optional(),
  custom_terms_url: z.string().url().optional(),
  custom_privacy_url: z.string().url().optional(),
  config: z.record(z.unknown()).optional(),
})

// GET / — load config
whiteLabel.get('/', requireAuth, requireOrgRole('owner'), async (c) => {
  const { organizationId } = c.get('org')
  const config = await db.white_label_configs.findFirst({
    where: { agency_org_id: organizationId },
  })
  if (!config) return c.json({ enabled: false, configured: false })
  return c.json(config)
})

// PUT / — upsert config
whiteLabel.put('/', requireAuth, requireOrgRole('owner'), zValidator('json', configSchema), async (c) => {
  const { organizationId } = c.get('org')
  const body = c.req.valid('json')

  const existing = await db.white_label_configs.findFirst({
    where: { agency_org_id: organizationId },
  })

  if (existing) {
    const updated = await db.white_label_configs.update({
      where: { id: existing.id },
      data: { ...body, updated_at: new Date() },
    })
    return c.json(updated)
  }

  const created = await db.white_label_configs.create({
    data: { agency_org_id: organizationId, ...body },
  })
  return c.json(created)
})

// PATCH /toggle — toggle enabled
whiteLabel.patch('/toggle', requireAuth, requireOrgRole('owner'), async (c) => {
  const { organizationId } = c.get('org')
  const config = await db.white_label_configs.findFirst({
    where: { agency_org_id: organizationId },
  })
  if (!config) return c.json({ error: 'Not found' }, 404)

  const updated = await db.white_label_configs.update({
    where: { id: config.id },
    data: { enabled: !config.enabled, updated_at: new Date() },
  })
  return c.json({ enabled: updated.enabled })
})

// DELETE / — hard delete
whiteLabel.delete('/', requireAuth, requireOrgRole('owner'), async (c) => {
  const { organizationId } = c.get('org')
  const config = await db.white_label_configs.findFirst({
    where: { agency_org_id: organizationId },
  })
  if (!config) return c.json({ error: 'Not found' }, 404)

  await db.white_label_configs.delete({ where: { id: config.id } })
  return c.json({ success: true })
})

// GET /preview — public-facing sanitized view
whiteLabel.get('/preview', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const config = await db.white_label_configs.findFirst({
    where: { agency_org_id: organizationId },
  })
  if (!config) {
    return c.json({
      brand_name: null,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      custom_domain: null,
      support_email: null,
      hide_powered_by: false,
      enabled: false,
    })
  }
  return c.json({
    brand_name: config.brand_name,
    logo_url: config.logo_url,
    primary_color: config.primary_color,
    secondary_color: config.secondary_color,
    custom_domain: config.custom_domain,
    support_email: config.support_email,
    hide_powered_by: config.hide_powered_by,
    enabled: config.enabled,
  })
})

export default whiteLabel
