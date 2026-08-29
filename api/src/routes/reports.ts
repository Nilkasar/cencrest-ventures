import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { generateReport, getReportData } from '../lib/report-generator.js'

const reports = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
}

// GET / — list reports
reports.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const type = c.req.query('type') as string | undefined

  const rows = await db.reports.findMany({
    where: {
      brand_id: brandId,
      ...(type ? { type } : {}),
    },
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  return c.json(rows)
})

// GET /summary — count by type and status
reports.get('/summary', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const [total, byTypeRows, byStatusRows] = await Promise.all([
    db.reports.count({ where: { brand_id: brandId } }),
    db.reports.groupBy({
      by: ['type'],
      where: { brand_id: brandId },
      _count: { id: true },
    }),
    db.reports.groupBy({
      by: ['status'],
      where: { brand_id: brandId },
      _count: { id: true },
    }),
  ])

  const by_type: Record<string, number> = {}
  for (const row of byTypeRows as Array<{ type: string; _count: { id: number } }>) {
    by_type[row.type] = row._count.id
  }

  const by_status: Record<string, number> = {}
  for (const row of byStatusRows as Array<{ status: string; _count: { id: number } }>) {
    by_status[row.status] = row._count.id
  }

  return c.json({ total, by_type, by_status })
})

// POST / — create report
reports.post(
  '/',
  requireAuth,
  requireOrgRole('member'),
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(255),
      type: z.enum(['visibility', 'competitive', 'seo', 'geo', 'overview']),
      format: z.enum(['json', 'pdf', 'csv']).default('json'),
    }),
  ),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const body = c.req.valid('json')
    const userId = c.get('user').id

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const report = await db.reports.create({
      data: {
        brand_id: brandId,
        name: body.name,
        type: body.type,
        format: body.format,
        status: 'pending',
        created_by: userId,
      },
    })

    setImmediate(() => generateReport(report.id, brandId).catch(console.error))

    return c.json({ id: report.id, status: 'pending' }, 201)
  },
)

// GET /:reportId — get single report
reports.get('/:reportId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const reportId = c.req.param('reportId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const report = await db.reports.findFirst({
    where: { id: reportId, brand_id: brandId },
  })
  if (!report) return c.json({ error: 'Report not found' }, 404)

  return c.json(report)
})

// GET /:reportId/data — get report with parsed sections
reports.get('/:reportId/data', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const reportId = c.req.param('reportId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const result = await getReportData(reportId)
  return c.json(result)
})

// DELETE /:reportId — hard delete
reports.delete('/:reportId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const reportId = c.req.param('reportId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  await db.reports.delete({ where: { id: reportId } })

  return c.json({ success: true })
})

export default reports
