import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOrgRole } from '../middleware/auth.js'
import { validateDomain, fetchSiteMeta } from '../lib/meta-fetch.js'
import { computeCompleteness } from '../lib/completeness.js'

const brands = new Hono<AppEnv>()

const createBrandSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  website_url: z.string().url().max(500).optional(),
  industry: z.string().max(100).optional(),
  positioning: z.string().optional(),
  value_proposition: z.string().optional(),
  key_differentiators: z.array(z.string()).optional(),
})

const updateBrandSchema = createBrandSchema.partial()

// GET /api/orgs/:slug/brands
brands.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const rows = await db.brands.findMany({
    where: { organization_id: organizationId, deleted_at: null },
    include: {
      _count: { select: { products: { where: { deleted_at: null } }, competitors: { where: { deleted_at: null } } } },
    },
    orderBy: { created_at: 'desc' },
  })

  const result = rows.map((b) => ({
    ...b,
    completeness: computeCompleteness({
      brand: b,
      productCount: b._count.products,
      competitorCount: b._count.competitors,
    }),
    _count: undefined,
  }))

  return c.json(result)
})

// POST /api/orgs/:slug/brands
brands.post('/', requireAuth, requireOrgRole('member'), zValidator('json', createBrandSchema), async (c) => {
  const { organizationId } = c.get('org')
  const user = c.get('user')
  const body = c.req.valid('json')

  let logoUrl: string | null = null

  if (body.website_url) {
    const domain = validateDomain(body.website_url)
    if (domain) {
      const meta = await fetchSiteMeta(domain)
      logoUrl = meta.logoUrl
    }
  }

  const brand = await db.brands.create({
    data: {
      organization_id: organizationId,
      created_by: user.id,
      name: body.name,
      description: body.description ?? null,
      website_url: body.website_url ?? null,
      industry: body.industry ?? null,
      positioning: body.positioning ?? null,
      value_proposition: body.value_proposition ?? null,
      key_differentiators: body.key_differentiators ?? [],
      logo_url: logoUrl,
    },
  })

  return c.json(brand, 201)
})

// GET /api/orgs/:slug/brands/:brandId
brands.get('/:brandId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
    include: {
      products: { where: { deleted_at: null }, orderBy: { created_at: 'desc' } },
      competitors: { where: { deleted_at: null }, orderBy: { created_at: 'desc' } },
    },
  })

  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const completeness = computeCompleteness({
    brand,
    productCount: brand.products.length,
    competitorCount: brand.competitors.length,
  })

  return c.json({ ...brand, completeness })
})

// PATCH /api/orgs/:slug/brands/:brandId
brands.patch('/:brandId', requireAuth, requireOrgRole('member'), zValidator('json', updateBrandSchema), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const body = c.req.valid('json')

  const existing = await db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
  if (!existing) return c.json({ error: 'Brand not found' }, 404)

  let logoUrl = existing.logo_url
  if (body.website_url && body.website_url !== existing.website_url) {
    const domain = validateDomain(body.website_url)
    if (domain) {
      const meta = await fetchSiteMeta(domain)
      if (meta.logoUrl) logoUrl = meta.logoUrl
    }
  }

  const updated = await db.brands.update({
    where: { id: brandId },
    data: { ...body, logo_url: logoUrl, updated_at: new Date() },
  })

  return c.json(updated)
})

// DELETE /api/orgs/:slug/brands/:brandId
brands.delete('/:brandId', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const existing = await db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
  if (!existing) return c.json({ error: 'Brand not found' }, 404)

  await db.brands.update({
    where: { id: brandId },
    data: { deleted_at: new Date() },
  })

  return c.json({ success: true })
})

// POST /api/orgs/:slug/brands/:brandId/products
brands.post('/:brandId/products', requireAuth, requireOrgRole('member'),
  zValidator('json', z.object({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    category: z.string().max(100).optional(),
    price_range: z.string().max(50).optional(),
    is_primary: z.boolean().optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const body = c.req.valid('json')

    const brand = await db.brands.findFirst({
      where: { id: brandId, organization_id: organizationId, deleted_at: null },
    })
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const product = await db.products.create({
      data: { brand_id: brandId, ...body },
    })

    return c.json(product, 201)
  }
)

// POST /api/orgs/:slug/brands/:brandId/competitors
brands.post('/:brandId/competitors', requireAuth, requireOrgRole('member'),
  zValidator('json', z.object({
    name: z.string().min(1).max(255),
    website_url: z.string().url().max(500).optional(),
    description: z.string().optional(),
    competition_type: z.enum(['direct', 'indirect', 'aspirational']).optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const body = c.req.valid('json')

    const brand = await db.brands.findFirst({
      where: { id: brandId, organization_id: organizationId, deleted_at: null },
    })
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const competitor = await db.competitors.create({
      data: { brand_id: brandId, ...body },
    })

    return c.json(competitor, 201)
  }
)

export default brands
