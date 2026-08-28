import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const competitive = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
}

// GET /sov — share of voice matrix (latest run)
competitive.get('/sov', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // Find the most recent run_id for this brand in share_of_voice
  const latest = await db.share_of_voice.findFirst({
    where: { brand_id: brandId },
    orderBy: { calculated_at: 'desc' },
  })

  if (!latest) {
    return c.json({ entities: [], run_id: null, calculated_at: null })
  }

  const runId = latest.run_id

  const rows = await db.share_of_voice.findMany({
    where: { brand_id: brandId, run_id: runId },
    orderBy: { sov_pct: 'desc' },
  })

  const entities = rows.map((r) => ({
    entity_name: r.entity_name,
    entity_type: r.entity_type,
    sov_pct: Number(r.sov_pct),
    mentions: r.mentions,
  }))

  return c.json({ entities, run_id: runId, calculated_at: latest.calculated_at })
})

// GET /gaps — queries where competitor SOV > 0 and brand SOV = 0 in the latest run
competitive.get('/gaps', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // Find the most recent run_id
  const latest = await db.share_of_voice.findFirst({
    where: { brand_id: brandId },
    orderBy: { calculated_at: 'desc' },
  })

  if (!latest) return c.json([])

  const runId = latest.run_id

  // Get all SOV rows for this run
  const allRows = await db.share_of_voice.findMany({
    where: { brand_id: brandId, run_id: runId },
    include: { buyer_journeys: true },
  })

  // Find query_ids where brand SOV = 0 and at least one competitor SOV > 0
  const queryIds = new Set(allRows.map((r) => r.query_id))
  const gaps: Array<{
    query_id: string
    competitor_name: string
    competitor_sov: number
    stage: string
  }> = []

  for (const queryId of queryIds) {
    const rowsForQuery = allRows.filter((r) => r.query_id === queryId)
    const brandRows = rowsForQuery.filter((r) => r.entity_type === 'brand')
    const brandSov = brandRows.reduce((sum, r) => sum + Number(r.sov_pct), 0)

    if (brandSov === 0) {
      const competitorRows = rowsForQuery.filter(
        (r) => r.entity_type === 'competitor' && Number(r.sov_pct) > 0,
      )
      for (const compRow of competitorRows) {
        gaps.push({
          query_id: queryId,
          competitor_name: compRow.entity_name,
          competitor_sov: Number(compRow.sov_pct),
          stage: compRow.buyer_journeys?.stage ?? 'unknown',
        })
      }
    }
  }

  return c.json(gaps)
})

// GET /scores — competitor visibility scores vs brand's own scores
competitive.get('/scores', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // Get brand's latest visibility score (one per provider, most recent)
  const allBrandScores = await db.visibility_scores.findMany({
    where: { brand_id: brandId },
    orderBy: { calculated_at: 'desc' },
  })

  const seenProviders = new Set<string>()
  const latestBrandScores = allBrandScores.filter((s) => {
    if (seenProviders.has(s.provider_name)) return false
    seenProviders.add(s.provider_name)
    return true
  })

  // Get all competitors
  const competitors = await db.competitors.findMany({
    where: { brand_id: brandId, deleted_at: null },
  })

  // For each competitor, get their latest visibility scores
  const competitorScores = await Promise.all(
    competitors.map(async (comp) => {
      const allScores = await db.competitor_visibility.findMany({
        where: { competitor_id: comp.id },
        orderBy: { calculated_at: 'desc' },
      })

      const seenCompProviders = new Set<string>()
      const latestScores = allScores.filter((s) => {
        if (seenCompProviders.has(s.provider_name)) return false
        seenCompProviders.add(s.provider_name)
        return true
      })

      return {
        competitor_id: comp.id,
        name: comp.name,
        scores: latestScores.map((s) => ({
          provider: s.provider_name,
          score: Number(s.score),
          mention_rate: Number(s.mention_rate),
        })),
      }
    }),
  )

  return c.json({
    brand: latestBrandScores,
    competitors: competitorScores,
  })
})

// GET /trends — historical SOV per competitor (last 10 runs)
competitive.get('/trends', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // Get all SOV rows for competitors for this brand, ordered by calculated_at desc
  const rows = await db.share_of_voice.findMany({
    where: { brand_id: brandId, entity_type: 'competitor' },
    orderBy: { calculated_at: 'desc' },
  })

  // Get unique run_ids (last 10)
  const seenRuns = new Set<string>()
  const last10Runs: string[] = []
  for (const r of rows) {
    if (!seenRuns.has(r.run_id)) {
      seenRuns.add(r.run_id)
      last10Runs.push(r.run_id)
      if (last10Runs.length >= 10) break
    }
  }

  // Filter to only last 10 runs
  const filteredRows = rows.filter((r) => last10Runs.includes(r.run_id))

  // Group by competitor name
  const competitorMap = new Map<
    string,
    Array<{ run_id: string; sov_pct: number; calculated_at: Date }>
  >()

  for (const row of filteredRows) {
    const history = competitorMap.get(row.entity_name) ?? []
    history.push({
      run_id: row.run_id,
      sov_pct: Number(row.sov_pct),
      calculated_at: row.calculated_at,
    })
    competitorMap.set(row.entity_name, history)
  }

  const result = Array.from(competitorMap.entries()).map(([competitor_name, history]) => ({
    competitor_name,
    history,
  }))

  return c.json(result)
})

// GET /seo-overlap — keywords where brand has no top-20 ranking but competitors may
competitive.get('/seo-overlap', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const skip = (page - 1) * limit

  // Get brand keywords with their latest ranking
  const [total, keywords] = await Promise.all([
    db.keywords.count({ where: { brand_id: brandId } }),
    db.keywords.findMany({
      where: { brand_id: brandId },
      include: {
        brand_keyword_rankings: {
          where: { brand_id: brandId },
          orderBy: { date: 'desc' },
          take: 1,
        },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
  ])

  const result = keywords.map((kw) => {
    const latestRanking = kw.brand_keyword_rankings[0] ?? null
    const position = latestRanking?.position ?? null
    const isPotentialGap = position === null || position > 20

    return {
      keyword_id: kw.id,
      keyword: kw.keyword,
      volume: kw.volume,
      difficulty: kw.difficulty,
      intent: kw.intent,
      current_position: position,
      is_potential_competitor_advantage: isPotentialGap,
    }
  })

  return c.json({ total, page, limit, data: result })
})

export default competitive
