import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const analysis = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
}

// GET /visibility — latest visibility score per provider
analysis.get('/visibility', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // Get all scores ordered by calculated_at desc, then deduplicate by provider
  const all = await db.visibility_scores.findMany({
    where: { brand_id: brandId },
    orderBy: { calculated_at: 'desc' },
  })

  const seenProviders = new Set<string>()
  const latest = all.filter((s) => {
    if (seenProviders.has(s.provider_name)) return false
    seenProviders.add(s.provider_name)
    return true
  })

  return c.json(latest)
})

// GET /visibility/history — last 90 days, optional ?provider= filter
analysis.get('/visibility/history', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const providerFilter = c.req.query('provider')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const since = new Date()
  since.setDate(since.getDate() - 90)

  const rows = await db.visibility_scores.findMany({
    where: {
      brand_id: brandId,
      calculated_at: { gte: since },
      ...(providerFilter ? { provider_name: providerFilter } : {}),
    },
    orderBy: { calculated_at: 'asc' },
  })

  return c.json(rows)
})

// GET /mentions — paginated mention_extractions
analysis.get('/mentions', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const entityTypeFilter = c.req.query('entity_type')
  const sentimentFilter = c.req.query('sentiment')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const skip = (page - 1) * limit

  const where = {
    ai_responses: {
      prompt_jobs: { prompt_runs: { brand_id: brandId } },
    },
    ...(entityTypeFilter ? { entity_type: entityTypeFilter as 'brand' | 'competitor' | 'product' } : {}),
    ...(sentimentFilter ? { sentiment: sentimentFilter as 'positive' | 'neutral' | 'negative' } : {}),
  }

  const [total, data] = await Promise.all([
    db.mention_extractions.count({ where }),
    db.mention_extractions.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

// GET /citations — paginated citations
analysis.get('/citations', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const domainFilter = c.req.query('domain')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const skip = (page - 1) * limit

  const where = {
    ai_responses: {
      prompt_jobs: { prompt_runs: { brand_id: brandId } },
    },
    ...(domainFilter ? { domain: domainFilter } : {}),
  }

  const [total, data] = await Promise.all([
    db.citations.count({ where }),
    db.citations.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

// GET /runs/:runId/analysis — full analysis for one run
analysis.get('/runs/:runId/analysis', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const runId = c.req.param('runId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.prompt_runs.findFirst({ where: { id: runId, brand_id: brandId } })
  if (!run) return c.json({ error: 'Run not found' }, 404)

  const [visibilityScores, mentions, citations] = await Promise.all([
    db.visibility_scores.findMany({ where: { brand_id: brandId, run_id: runId } }),
    db.mention_extractions.findMany({
      where: { ai_responses: { prompt_jobs: { run_id: runId } } },
    }),
    db.citations.findMany({
      where: { ai_responses: { prompt_jobs: { run_id: runId } } },
    }),
  ])

  // Mention summary: counts by entity, avg sentiment
  const entityMap = new Map<string, { count: number; sentimentSum: number; type: string }>()
  for (const m of mentions) {
    const existing = entityMap.get(m.entity_name) ?? { count: 0, sentimentSum: 0, type: m.entity_type }
    existing.count += m.mention_count
    existing.sentimentSum +=
      m.sentiment === 'positive' ? 1 : m.sentiment === 'negative' ? -1 : 0
    entityMap.set(m.entity_name, existing)
  }

  const mentionSummary = Array.from(entityMap.entries()).map(([name, v]) => ({
    entity_name: name,
    entity_type: v.type,
    total_mentions: v.count,
    avg_sentiment: v.count > 0 ? v.sentimentSum / v.count : 0,
  }))

  // Top 5 cited domains
  const domainCounts = new Map<string, number>()
  for (const c of citations) {
    if (c.domain) {
      domainCounts.set(c.domain, (domainCounts.get(c.domain) ?? 0) + 1)
    }
  }
  const topDomains = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }))

  return c.json({
    run_id: runId,
    visibility_scores: visibilityScores,
    mention_summary: mentionSummary,
    top_cited_domains: topDomains,
  })
})

export default analysis
