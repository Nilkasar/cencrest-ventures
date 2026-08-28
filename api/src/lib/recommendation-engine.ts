import { db } from './db.js'

type EffortEstimate = 'low' | 'medium' | 'high'

function effortWeight(effort: EffortEstimate): number {
  switch (effort) {
    case 'low': return 1
    case 'medium': return 2
    case 'high': return 3
  }
}

function toNumber(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'object' && typeof (val as { toNumber(): number }).toNumber === 'function') {
    return (val as { toNumber(): number }).toNumber()
  }
  return Number(val)
}

export async function generateRecommendations(brandId: string): Promise<number> {
  let created = 0

  // --- Process geo_gaps ---
  const gaps = await db.geo_gaps.findMany({
    where: {
      brand_id: brandId,
      dismissed_at: null,
    },
    include: {
      buyer_journeys: { select: { query: true } },
    },
  })

  for (const gap of gaps) {
    // Skip if rec already exists for this brand + gap
    const existing = await db.recommendations.findFirst({
      where: { brand_id: brandId, gap_id: gap.id },
    })
    if (existing) continue

    const queryText = gap.buyer_journeys?.query ?? ''
    const businessImpact = toNumber(gap.business_impact_score)

    let rec_type: string
    let effort: EffortEstimate
    let title: string
    let rationale: string

    switch (gap.gap_type) {
      case 'no_mention':
        rec_type = 'create_content'
        effort = 'high'
        title = `Create content targeting: ${queryText}`
        rationale = 'Brand has no presence for this query'
        break
      case 'no_citation':
        rec_type = 'build_citation'
        effort = 'low'
        title = `Build citations for: ${queryText}`
        rationale = 'AI models mention brand but do not cite brand sources'
        break
      case 'competitor_only':
        rec_type = 'earn_link'
        effort = 'medium'
        title = `Earn links to compete for: ${queryText}`
        rationale = 'Competitor content outranks brand for this query'
        break
      case 'low_sentiment':
        rec_type = 'improve_entity'
        effort = 'medium'
        title = `Improve brand entity signals for: ${queryText}`
        rationale = 'Negative sentiment detected in AI responses for this query'
        break
      default:
        continue
    }

    const roi_score = businessImpact / effortWeight(effort)

    await db.recommendations.create({
      data: {
        brand_id: brandId,
        gap_id: gap.id,
        rec_type,
        title,
        rationale,
        expected_impact: `Business impact score: ${businessImpact.toFixed(1)}`,
        effort_estimate: effort,
        roi_score,
        status: 'active',
      },
    })
    created++
  }

  // --- Process opportunities (P1 and P2 only) ---
  const opportunities = await db.opportunities.findMany({
    where: {
      brand_id: brandId,
      priority_tier: { in: ['P1', 'P2'] },
    },
  })

  for (const opp of opportunities) {
    // Skip if rec already exists for this brand + opportunity
    const existing = await db.recommendations.findFirst({
      where: { brand_id: brandId, opportunity_id: opp.id },
    })
    if (existing) continue

    const unifiedScore = toNumber(opp.unified_score)
    const keywordOrQuery = opp.keyword_or_query

    let rec_type: string
    let effort: EffortEstimate
    let title: string
    let rationale: string
    let shouldCreate = false

    if (unifiedScore >= 70) {
      // P1: check no existing ranking
      const ranking = await db.brand_keyword_rankings.findFirst({
        where: {
          keywords: { brand_id: brandId, keyword: keywordOrQuery },
        },
      })
      if (!ranking) {
        rec_type = 'create_content'
        effort = 'high'
        title = `Create page for high-opportunity term: ${keywordOrQuery}`
        rationale = 'High unified score with no existing ranking — significant growth potential'
        shouldCreate = true
      }
    } else if (unifiedScore >= 40) {
      // P2: check existing ranking pos > 10
      const ranking = await db.brand_keyword_rankings.findFirst({
        where: {
          keywords: { brand_id: brandId, keyword: keywordOrQuery },
        },
        orderBy: { date: 'desc' },
      })
      if (ranking && ranking.position != null && ranking.position > 10) {
        rec_type = 'optimize_page'
        effort = 'low'
        title = `Optimize existing page for: ${keywordOrQuery}`
        rationale = 'Existing ranking below top 10 — optimization can drive significant traffic gains'
        shouldCreate = true
      }
    }

    if (!shouldCreate) continue

    const businessImpact = toNumber(opp.volume) || unifiedScore
    const roi_score = businessImpact / effortWeight(effort!)

    await db.recommendations.create({
      data: {
        brand_id: brandId,
        opportunity_id: opp.id,
        rec_type: rec_type!,
        title: title!,
        rationale: rationale!,
        expected_impact: `Unified score: ${unifiedScore.toFixed(1)}`,
        effort_estimate: effort!,
        roi_score,
        status: 'active',
      },
    })
    created++
  }

  return created
}
