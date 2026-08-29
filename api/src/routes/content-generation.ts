import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { db } from '../lib/db.js'
import {
  generateContentFromBrief,
  scoreDraft,
  listBriefs,
  createBrief,
} from '../lib/content-generator.js'

const contentGeneration = new Hono<AppEnv>()

async function getBrand(brandId: string, orgId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: orgId, deleted_at: null } })
}

// GET / — list briefs
contentGeneration.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const status = c.req.query('status')
  const briefs = await listBriefs(brandId, status)

  return c.json({ total: briefs.length, data: briefs })
})

const createBriefSchema = z.object({
  content_type: z.enum(['blog_post', 'landing_page', 'faq', 'product_description', 'case_study']),
  title: z.string().min(1).max(500),
  target_query: z.string().max(500).optional(),
  target_stage: z.string().max(50).optional(),
  target_intent: z.string().max(50).optional(),
  keywords: z.array(z.string()).max(20).optional(),
  outline: z.array(z.unknown()).optional(),
})

// POST / — create brief
contentGeneration.post('/', requireAuth, requireOrgRole('member'), zValidator('json', createBriefSchema), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const user = c.get('user')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const body = c.req.valid('json')
  const brief = await createBrief({ ...body, brand_id: brandId, created_by: user.id })

  return c.json(brief, 201)
})

// GET /:briefId — single brief
contentGeneration.get('/:briefId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const briefId = c.req.param('briefId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const brief = await db.content_briefs.findFirst({ where: { id: briefId, brand_id: brandId, deleted_at: null } })
  if (!brief) return c.json({ error: 'Brief not found' }, 404)

  return c.json(brief)
})

// DELETE /:briefId — soft-delete
contentGeneration.delete('/:briefId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const briefId = c.req.param('briefId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const brief = await db.content_briefs.findFirst({ where: { id: briefId, brand_id: brandId, deleted_at: null } })
  if (!brief) return c.json({ error: 'Brief not found' }, 404)

  const updated = await db.content_briefs.update({
    where: { id: briefId },
    data: { deleted_at: new Date(), updated_at: new Date() },
  })

  return c.json(updated)
})

// POST /:briefId/generate — fire-and-forget
contentGeneration.post('/:briefId/generate', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const briefId = c.req.param('briefId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  setImmediate(() => generateContentFromBrief(briefId, organizationId).catch(console.error))

  return c.json({ queued: true }, 202)
})

// GET /:briefId/drafts — list drafts
contentGeneration.get('/:briefId/drafts', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const briefId = c.req.param('briefId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const drafts = await db.generated_content.findMany({ where: { brief_id: briefId, brand_id: brandId } })

  return c.json(drafts)
})

// GET /:briefId/drafts/:draftId — single draft
contentGeneration.get('/:briefId/drafts/:draftId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const briefId = c.req.param('briefId')
  const draftId = c.req.param('draftId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const draft = await db.generated_content.findFirst({ where: { id: draftId, brief_id: briefId, brand_id: brandId } })
  if (!draft) return c.json({ error: 'Draft not found' }, 404)

  return c.json(draft)
})

// POST /:briefId/drafts/:draftId/score — fire-and-forget
contentGeneration.post('/:briefId/drafts/:draftId/score', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const briefId = c.req.param('briefId')
  const draftId = c.req.param('draftId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // suppress unused warnings
  void briefId

  setImmediate(() => scoreDraft(draftId).catch(console.error))

  return c.json({ queued: true }, 202)
})

const patchDraftSchema = z.object({
  status: z.enum(['draft', 'approved', 'rejected', 'published']).optional(),
  feedback: z.record(z.unknown()).optional(),
})

// PATCH /:briefId/drafts/:draftId — update draft
contentGeneration.patch(
  '/:briefId/drafts/:draftId',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', patchDraftSchema),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const briefId = c.req.param('briefId')
    const draftId = c.req.param('draftId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const draft = await db.generated_content.findFirst({ where: { id: draftId, brief_id: briefId, brand_id: brandId } })
    if (!draft) return c.json({ error: 'Draft not found' }, 404)

    const body = c.req.valid('json')
    const updated = await db.generated_content.update({
      where: { id: draftId },
      data: { ...body, updated_at: new Date() },
    })

    return c.json(updated)
  },
)

export default contentGeneration
