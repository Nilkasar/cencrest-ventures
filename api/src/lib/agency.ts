import { db } from '../lib/db.js'

export interface AgencyClient {
  id: string
  agency_org_id: string
  client_org_id: string
  relationship_type: string | null
  access_level: string | null
  monthly_fee: unknown
  contract_start: Date | null
  contract_end: Date | null
  status: string
  notes: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface AgencyClientWithOrg extends AgencyClient {
  client_org: {
    id: string
    name: string
    slug: string
  } | null
}

export interface AgencyClientSummary {
  total_clients: number
  active_clients: number
  total_mrr: number
  by_status: {
    active: number
    paused: number
    terminated: number
  }
}

export async function addClient(
  agencyOrgId: string,
  clientOrgId: string,
  data: {
    relationship_type?: string
    access_level?: string
    monthly_fee?: number
    contract_start?: Date
    contract_end?: Date
    notes?: string
  }
): Promise<AgencyClient> {
  const clientOrg = await db.organizations.findFirst({ where: { id: clientOrgId, deleted_at: null } })
  if (!clientOrg) throw new Error('Client organization not found')

  const existing = await db.agency_clients.findFirst({
    where: { agency_org_id: agencyOrgId, client_org_id: clientOrgId, deleted_at: null },
  })
  if (existing) throw new Error('Already linked')

  return db.agency_clients.create({
    data: {
      agency_org_id: agencyOrgId,
      client_org_id: clientOrgId,
      relationship_type: data.relationship_type as never,
      access_level: data.access_level as never,
      monthly_fee: data.monthly_fee,
      contract_start: data.contract_start,
      contract_end: data.contract_end,
      notes: data.notes,
    },
  }) as Promise<AgencyClient>
}

export async function removeClient(agencyOrgId: string, clientOrgId: string): Promise<void> {
  const link = await db.agency_clients.findFirst({
    where: { agency_org_id: agencyOrgId, client_org_id: clientOrgId, deleted_at: null },
  })
  if (!link) throw new Error('Client link not found')

  await db.agency_clients.update({
    where: { id: link.id },
    data: { deleted_at: new Date(), status: 'terminated' as never },
  })
}

export async function listClients(agencyOrgId: string): Promise<AgencyClientWithOrg[]> {
  const clients = await db.agency_clients.findMany({
    where: { agency_org_id: agencyOrgId, deleted_at: null },
    orderBy: { created_at: 'desc' },
  }) as AgencyClient[]

  return Promise.all(
    clients.map(async (client) => {
      const org = await db.organizations.findFirst({ where: { id: client.client_org_id } })
      return { ...client, client_org: org as { id: string; name: string; slug: string } | null }
    })
  )
}

export async function getClientSummary(agencyOrgId: string): Promise<AgencyClientSummary> {
  const clients = await db.agency_clients.findMany({
    where: { agency_org_id: agencyOrgId, deleted_at: null },
  }) as AgencyClient[]

  const total_clients = clients.length
  const active_clients = clients.filter((c) => c.status === 'active').length
  const total_mrr = clients
    .filter((c) => c.status === 'active')
    .reduce((sum, c) => sum + (typeof c.monthly_fee === 'number' ? c.monthly_fee : parseFloat(String(c.monthly_fee ?? 0)) || 0), 0)

  const by_status = {
    active: clients.filter((c) => c.status === 'active').length,
    paused: clients.filter((c) => c.status === 'paused').length,
    terminated: clients.filter((c) => c.status === 'terminated').length,
  }

  return { total_clients, active_clients, total_mrr, by_status }
}
