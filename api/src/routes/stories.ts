import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const stories = new Hono<AppEnv>()

const createSchema = z.object({
  author_name: z.string().min(1).max(255),
  author_title: z.string().max(255).optional(),
  company_name: z.string().max(255).optional(),
  story_type: z.enum(['case_study', 'interview', 'lesson', 'growth_story', 'failure_story']).optional(),
  title: z.string().min(1).max(500),
  summary: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  industry: z.string().max(100).optional(),
  metrics: z.record(z.unknown()).optional(),
})

const patchSchema = z.object({
  title: z.string().max(500).optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  industry: z.string().max(100).optional(),
  metrics: z.record(z.unknown()).optional(),
  featured: z.boolean().optional(),
  status: z.enum(['draft', 'review', 'published', 'archived']).optional(),
})

// GET /public — no auth (before auth-required routes)
stories.get('/public', async (c) => {
  const org = c.get('org') as { organizationId: string } | undefined
  // org might not be set if no auth middleware ran; we need org from slug
  const slug = c.req.param('slug')
  const organization = await db.organizations.findUnique({ where: { slug, deleted_at: null } })
  if (!organization) return c.json({ error: 'Organization not found' }, 404)

  const rows = await db.entrepreneur_stories.findMany({
    where: { org_id: organization.id, status: 'published', featured: true, deleted_at: null },
    orderBy: { created_at: 'desc' },
    take: 10,
    select: {
      id: true,
      author_name: true,
      author_title: true,
      company_name: true,
      story_type: true,
      title: true,
      summary: true,
      tags: true,
      industry: true,
      metrics: true,
      published_at: true,
    },
  })

  return c.json(rows)
})

// GET /featured — before /:storyId
stories.get('/featured', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const rows = await db.entrepreneur_stories.findMany({
    where: { org_id: organizationId, featured: true, status: 'published', deleted_at: null },
    orderBy: { created_at: 'desc' },
  })

  return c.json(rows)
})

// GET /
stories.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const { status, story_type, featured } = c.req.query()

  const where: Record<string, unknown> = { org_id: organizationId, deleted_at: null }
  if (status) where.status = status
  if (story_type) where.story_type = story_type
  if (featured === 'true') where.featured = true
  if (featured === 'false') where.featured = false

  const rows = await db.entrepreneur_stories.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  return c.json(rows)
})

// POST /
stories.post('/', requireAuth, requireOrgRole('member'), zValidator('json', createSchema), async (c) => {
  const { organizationId } = c.get('org')
  const body = c.req.valid('json')

  const story = await db.entrepreneur_stories.create({
    data: {
      org_id: organizationId,
      ...body,
      tags: body.tags ?? [],
      metrics: body.metrics ?? {},
    },
  })

  return c.json(story, 201)
})

// GET /:storyId
stories.get('/:storyId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const storyId = c.req.param('storyId')

  const story = await db.entrepreneur_stories.findFirst({
    where: { id: storyId, org_id: organizationId, deleted_at: null },
  })

  if (!story) return c.json({ error: 'Story not found' }, 404)
  return c.json(story)
})

// PATCH /:storyId
stories.patch('/:storyId', requireAuth, requireOrgRole('member'), zValidator('json', patchSchema), async (c) => {
  const { organizationId } = c.get('org')
  const storyId = c.req.param('storyId')
  const body = c.req.valid('json')

  const existing = await db.entrepreneur_stories.findFirst({
    where: { id: storyId, org_id: organizationId, deleted_at: null },
  })
  if (!existing) return c.json({ error: 'Story not found' }, 404)

  const data: Record<string, unknown> = { ...body }
  if (body.status === 'published' && !existing.published_at) {
    data.published_at = new Date()
  }

  const updated = await db.entrepreneur_stories.update({
    where: { id: storyId },
    data,
  })

  return c.json(updated)
})

// DELETE /:storyId
stories.delete('/:storyId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const storyId = c.req.param('storyId')

  const existing = await db.entrepreneur_stories.findFirst({
    where: { id: storyId, org_id: organizationId, deleted_at: null },
  })
  if (!existing) return c.json({ error: 'Story not found' }, 404)

  await db.entrepreneur_stories.update({
    where: { id: storyId },
    data: { deleted_at: new Date() },
  })

  return c.json({ success: true })
})

// POST /:storyId/publish
stories.post('/:storyId/publish', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const storyId = c.req.param('storyId')

  const existing = await db.entrepreneur_stories.findFirst({
    where: { id: storyId, org_id: organizationId, deleted_at: null },
  })
  if (!existing) return c.json({ error: 'Story not found' }, 404)

  const updated = await db.entrepreneur_stories.update({
    where: { id: storyId },
    data: {
      status: 'published',
      published_at: existing.published_at ?? new Date(),
    },
  })

  return c.json(updated)
})

export default stories
