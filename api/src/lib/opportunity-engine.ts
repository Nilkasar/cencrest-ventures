import { db } from './db.js'

function seoGapScore(position: number | null | undefined): number {
  if (position == null) return 100
  if (position > 50) return 80
  if (position >= 21) return 60
  if (position >= 11) return 40
  if (position >= 4) return 20
  return 5
}

function computeUnifiedScore(
  seoScore: number,
  geoScore: number,
  volume?: number | null,
  difficulty?: number | null,
): number {
  let score = seoScore * 0.5 + geoScore * 0.5
  if (volume != null) score *= 1 + Math.log10(volume + 1) / 5
  if (difficulty != null) score *= 1 + (100 - difficulty) / 200
  return score
}

function priorityTier(unified: number): 'P1' | 'P2' | 'P3' {
  if (unified >= 70) return 'P1'
  if (unified >= 40) return 'P2'
  return 'P3'
}

export async function recalculateOpportunities(brandId: string): Promise<number> {
  // Load keywords with latest ranking
  const keywords = await db.keywords.findMany({
    where: { brand_id: brandId },
    include: {
      brand_keyword_rankings: {
        orderBy: { date: 'desc' },
        take: 1,
      },
    },
  })

  // Load buyer journeys
  const journeys = await db.buyer_journeys.findMany({
    where: { brand_id: brandId, deleted_at: null },
  })

  // Load latest SOV: find most recent run_id for this brand
  const latestSovEntry = await db.share_of_voice.findFirst({
    where: { brand_id: brandId },
    orderBy: { calculated_at: 'desc' },
  })

  let sovEntries: Array<{ query_id: string; entity_name: string; sov_pct: number | { toNumber(): number } }> = []
  if (latestSovEntry) {
    const raw = await db.share_of_voice.findMany({
      where: { brand_id: brandId, run_id: latestSovEntry.run_id },
    })
    sovEntries = raw.map((e) => ({
      query_id: e.query_id,
      entity_name: e.entity_name,
      sov_pct: e.sov_pct,
    }))
  }

  // Build SOV lookup: query_id -> brand sov_pct (for brand entity)
  const sovByQuery = new Map<string, number>()
  for (const entry of sovEntries) {
    const pct = typeof entry.sov_pct === 'object' ? entry.sov_pct.toNumber() : Number(entry.sov_pct)
    if (!sovByQuery.has(entry.query_id) || pct > (sovByQuery.get(entry.query_id) ?? 0)) {
      sovByQuery.set(entry.query_id, pct)
    }
  }

  // Build journey lookup by query text
  const journeyByQuery = new Map<string, (typeof journeys)[0]>()
  for (const j of journeys) {
    journeyByQuery.set(j.query.toLowerCase(), j)
  }

  let count = 0
  const processedQueryTexts = new Set<string>()

  // Process keywords
  for (const kw of keywords) {
    const ranking = kw.brand_keyword_rankings[0] ?? null
    const position = ranking?.position ?? null
    const seoScore = seoGapScore(position)

    // Find matching journey (fuzzy: lowercase includes)
    const kwLower = kw.keyword.toLowerCase()
    let matchedJourney: (typeof journeys)[0] | undefined
    for (const j of journeys) {
      if (j.query.toLowerCase().includes(kwLower) || kwLower.includes(j.query.toLowerCase())) {
        matchedJourney = j
        break
      }
    }

    let geoScore = 100
    if (matchedJourney) {
      const sov = sovByQuery.get(matchedJourney.id)
      if (sov != null) geoScore = 100 - sov
    }

    const unified = computeUnifiedScore(seoScore, geoScore, kw.volume, kw.difficulty)
    const tier = priorityTier(unified)

    // Upsert: find existing by brand_id + keyword_or_query
    const existing = await db.opportunities.findFirst({
      where: { brand_id: brandId, keyword_or_query: kw.keyword },
    })

    if (existing) {
      await db.opportunities.update({
        where: { id: existing.id },
        data: {
          seo_gap_score: seoScore,
          geo_gap_score: geoScore,
          unified_score: unified,
          volume: kw.volume ?? null,
          difficulty: kw.difficulty ?? null,
          priority_tier: tier,
          updated_at: new Date(),
        },
      })
    } else {
      await db.opportunities.create({
        data: {
          brand_id: brandId,
          keyword_or_query: kw.keyword,
          title: kw.keyword,
          seo_gap_score: seoScore,
          geo_gap_score: geoScore,
          unified_score: unified,
          volume: kw.volume ?? null,
          difficulty: kw.difficulty ?? null,
          priority_tier: tier,
        },
      })
    }

    processedQueryTexts.add(kwLower)
    count++
  }

  // Process buyer_journey queries with no matching keyword (GEO-only)
  for (const j of journeys) {
    const jLower = j.query.toLowerCase()
    // Skip if already covered by a keyword
    let covered = false
    for (const kwText of processedQueryTexts) {
      if (kwText.includes(jLower) || jLower.includes(kwText)) {
        covered = true
        break
      }
    }
    if (covered) continue

    const seoScore = 50
    const sov = sovByQuery.get(j.id)
    const geoScore = sov != null ? 100 - sov : 100

    const unified = computeUnifiedScore(seoScore, geoScore)
    const tier = priorityTier(unified)

    const existing = await db.opportunities.findFirst({
      where: { brand_id: brandId, keyword_or_query: j.query },
    })

    if (existing) {
      await db.opportunities.update({
        where: { id: existing.id },
        data: {
          seo_gap_score: seoScore,
          geo_gap_score: geoScore,
          unified_score: unified,
          priority_tier: tier,
          updated_at: new Date(),
        },
      })
    } else {
      await db.opportunities.create({
        data: {
          brand_id: brandId,
          keyword_or_query: j.query,
          title: j.query,
          seo_gap_score: seoScore,
          geo_gap_score: geoScore,
          unified_score: unified,
          priority_tier: tier,
        },
      })
    }

    count++
  }

  return count
}
