import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { addClient, removeClient, listClients, getClientSummary } from '../lib/agency.js'

const agency = new Hono<AppEnv>()

// GET /clients
agency.get('/clients', requireAuth, requireOrgRole('owner'), async (c) => {
  const { organizationId } = c.get('org')
  const clients = await listClients(organizationId)
  return c.json(clients)
})

// POST /clients
const addClientSchema = z.object({
  client_org_id: z.string().uuid(),
  relationship_type: z.enum(['managed', 'white_label', 'referral']).optional(),
  access_level: z.enum(['full', 'read_only', 'limited']).optional(),
  monthly_fee: z.number().positive().optional(),
  contract_start: z.string().datetime().optional(),
  contract_end: z.string().datetime().optional(),
  notes: z.string().optional(),
})

agency.post('/clients', requireAuth, requireOrgRole('owner'), zValidator('json', addClientSchema), async (c) => {
  const { organizationId } = c.get('org')
  const body = c.req.valid('json')
  const { client_org_id, ...rest } = body
  const data = {
    ...rest,
    contract_start: rest.contract_start ? new Date(rest.contract_start) : undefined,
    contract_end: rest.contract_end ? new Date(rest.contract_end) : undefined,
  }
  const client = await addClient(organizationId, client_org_id, data)
  return c.json(client, 201)
})

// DELETE /clients/:clientOrgId
agency.delete('/clients/:clientOrgId', requireAuth, requireOrgRole('owner'), async (c) => {
  const { organizationId } = c.get('org')
  const clientOrgId = c.req.param('clientOrgId')
  await removeClient(organizationId, clientOrgId)
  return c.json({ success: true })
})

// GET /clients/:clientOrgId
agency.get('/clients/:clientOrgId', requireAuth, requireOrgRole('owner'), async (c) => {
  const { organizationId } = c.get('org')
  const clientOrgId = c.req.param('clientOrgId')
  const record = await db.agency_clients.findFirst({
    where: { agency_org_id: organizationId, client_org_id: clientOrgId, deleted_at: null },
  })
  if (!record) return c.json({ error: 'Not found' }, 404)
  return c.json(record)
})

// PATCH /clients/:clientOrgId
const updateClientSchema = z.object({
  relationship_type: z.enum(['managed', 'white_label', 'referral']).optional(),
  access_level: z.enum(['full', 'read_only', 'limited']).optional(),
  monthly_fee: z.number().positive().optional(),
  status: z.enum(['active', 'paused', 'terminated']).optional(),
  notes: z.string().optional(),
})

agency.patch('/clients/:clientOrgId', requireAuth, requireOrgRole('owner'), zValidator('json', updateClientSchema), async (c) => {
  const { organizationId } = c.get('org')
  const clientOrgId = c.req.param('clientOrgId')
  const body = c.req.valid('json')

  const existing = await db.agency_clients.findFirst({
    where: { agency_org_id: organizationId, client_org_id: clientOrgId, deleted_at: null },
  })
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const updated = await db.agency_clients.update({
    where: { id: existing.id },
    data: { ...body, updated_at: new Date() },
  })
  return c.json(updated)
})

// GET /summary
agency.get('/summary', requireAuth, requireOrgRole('owner'), async (c) => {
  const { organizationId } = c.get('org')
  const summary = await getClientSummary(organizationId)
  return c.json(summary)
})

export default agency
