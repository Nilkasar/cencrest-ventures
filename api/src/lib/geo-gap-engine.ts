import { db } from './db.js'

type IntentType = 'commercial' | 'transactional' | 'informational' | 'navigational' | string | null

function intentWeight(intentType: IntentType): number {
  switch (intentType) {
    case 'commercial': return 1.5
    case 'transactional': return 2.0
    case 'informational': return 0.5
    case 'navigational': return 0.3
    default: return 1.0
  }
}

function severityForIntent(intentType: IntentType): 'critical' | 'high' | 'medium' | 'low' {
  switch (intentType) {
    case 'commercial':
    case 'transactional':
      return 'critical'
    case 'informational':
      return 'medium'
    case 'navigational':
      return 'low'
    default:
      return 'medium'
  }
}

function stageToSeverity(stage: string): 'critical' | 'high' | 'medium' | 'low' {
  switch (stage) {
    case 'consideration': return 'high'
    case 'awareness': return 'medium'
    default: return 'medium'
  }
}

function noMentionSeverity(intentType: IntentType, stage: string): 'critical' | 'high' | 'medium' | 'low' {
  if (intentType === 'commercial' || intentType === 'transactional') return 'critical'
  if (stage === 'consideration') return 'high'
  return stageToSeverity(stage)
}

function toNumber(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'object' && typeof (val as { toNumber(): number }).toNumber === 'function') {
    return (val as { toNumber(): number }).toNumber()
  }
  return Number(val)
}

export async function computeGeoGaps(brandId: string, runId: string): Promise<number> {
  // 1. Load all buyer_journeys for brand
  const journeys = await db.buyer_journeys.findMany({
    where: { brand_id: brandId, deleted_at: null },
  })

  if (journeys.length === 0) return 0

  const journeyIds = journeys.map((j) => j.id)

  // 2. Load all ai_responses for this run that match these journeys
  //    Join via prompt_jobs (run_id) → ai_responses (query_id)
  const promptJobs = await db.prompt_jobs.findMany({
    where: { run_id: runId, query_id: { in: journeyIds } },
    select: { id: true, query_id: true },
  })

  const promptJobIds = promptJobs.map((pj) => pj.id)
  if (promptJobIds.length === 0) return 0

  // Load all responses for these jobs
  const responses = await db.ai_responses.findMany({
    where: { prompt_job_id: { in: promptJobIds } },
    include: {
      mention_extractions: true,
      citations: true,
    },
  })

  if (responses.length === 0) return 0

  // 3. Load brand pages for root cause analysis
  const pages = await db.pages.findMany({
    where: { brand_id: brandId },
    select: { url: true, title: true },
  })

  // 4. Load SOV for latest run to get competitor SOV
  const latestSovEntry = await db.share_of_voice.findFirst({
    where: { brand_id: brandId },
    orderBy: { calculated_at: 'desc' },
  })
  let sovEntries: Array<{ query_id: string; entity_name: string; entity_type: string; sov_pct: unknown }> = []
  if (latestSovEntry) {
    sovEntries = await db.share_of_voice.findMany({
      where: { brand_id: brandId, run_id: latestSovEntry.run_id },
    })
  }

  // 5. Load keywords for volume lookup
  const keywords = await db.keywords.findMany({
    where: { brand_id: brandId },
    select: { keyword: true, volume: true, intent: true },
  })

  // Build keyword volume lookup (lowercase)
  const kwVolumeMap = new Map<string, { volume: number | null; intent: string | null }>()
  for (const kw of keywords) {
    kwVolumeMap.set(kw.keyword.toLowerCase(), { volume: kw.volume ?? null, intent: kw.intent ?? null })
  }

  // Build journey lookup by id
  const journeyMap = new Map(journeys.map((j) => [j.id, j]))

  // Build SOV competitor lookup: query_id -> top competitor sov_pct
  const competitorSovByQuery = new Map<string, number>()
  for (const entry of sovEntries) {
    if (entry.entity_type !== 'brand') {
      const existing = competitorSovByQuery.get(entry.query_id) ?? 0
      const pct = toNumber(entry.sov_pct)
      if (pct > existing) competitorSovByQuery.set(entry.query_id, pct)
    }
  }

  // Group responses by query_id + provider_name
  type ResponseWithIncludes = typeof responses[0]
  const grouped = new Map<string, ResponseWithIncludes[]>()
  for (const resp of responses) {
    const key = `${resp.query_id}::${resp.provider_name}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(resp)
  }

  // Determine brand domain from website_url
  const brand = await db.brands.findFirst({
    where: { id: brandId },
    select: { website_url: true, name: true },
  })
  const brandName = brand?.name ?? ''
  let brandDomain: string | null = null
  if (brand?.website_url) {
    try {
      brandDomain = new URL(brand.website_url).hostname.replace(/^www\./, '')
    } catch {
      brandDomain = null
    }
  }

  const upserts: Array<Promise<unknown>> = []

  for (const [key, groupedResponses] of grouped) {
    const [queryId, providerName] = key.split('::')
    const journey = journeyMap.get(queryId)
    if (!journey) continue

    const intentType = journey.intent_type as IntentType
    const stage = journey.stage as string
    const queryText = journey.query

    // Find keyword match
    const qLower = queryText.toLowerCase()
    let matchedVolume: number | null = null
    for (const [kw, data] of kwVolumeMap) {
      if (qLower.includes(kw) || kw.includes(qLower)) {
        matchedVolume = data.volume
        break
      }
    }

    // Aggregate mention extractions across all responses in this group
    const allMentions = groupedResponses.flatMap((r) => r.mention_extractions)
    const brandMentions = allMentions.filter(
      (m) => m.entity_type === 'brand' && m.entity_name.toLowerCase() === brandName.toLowerCase(),
    )
    const competitorMentions = allMentions.filter((m) => m.entity_type === 'competitor')

    const totalBrandMentionCount = brandMentions.reduce((sum, m) => sum + m.mention_count, 0)
    const totalCompetitorMentionCount = competitorMentions.reduce((sum, m) => sum + m.mention_count, 0)

    // Average sentiment score for brand
    const sentimentScores = brandMentions
      .map((m) => toNumber(m.sentiment_score))
      .filter((s) => s !== 0 || brandMentions.some((m) => toNumber(m.sentiment_score) === 0))
    const avgSentiment = sentimentScores.length > 0
      ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length
      : 0

    // Citations pointing to brand domain
    const allCitations = groupedResponses.flatMap((r) => r.citations)
    const brandCitationCount = brandDomain
      ? allCitations.filter((c) => c.domain && c.domain.replace(/^www\./, '').includes(brandDomain!)).length
      : 0

    // Helper to check if any page covers the query (fuzzy match)
    function hasPageCovering(query: string): boolean {
      const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
      for (const page of pages) {
        const haystack = `${(page.title ?? '').toLowerCase()} ${page.url.toLowerCase()}`
        if (qWords.some((w) => haystack.includes(w))) return true
      }
      return false
    }

    const volumeWeight = matchedVolume != null ? matchedVolume : 50 * intentWeight(intentType)

    // --- no_mention gap ---
    if (totalBrandMentionCount === 0) {
      const hasCoverage = hasPageCovering(queryText)
      const rootCause = hasCoverage
        ? 'Content exists but not cited by AI'
        : 'Brand has no content covering this topic'
      const severity = noMentionSeverity(intentType, stage)
      const businessImpact = matchedVolume != null ? matchedVolume * 1.0 : 50 * intentWeight(intentType)

      upserts.push(
        upsertGap(brandId, queryId, providerName, 'no_mention', severity, rootCause,
          `Create content targeting: ${queryText}`, businessImpact),
      )
    }

    // --- competitor_only gap ---
    if (totalCompetitorMentionCount > 0 && totalBrandMentionCount === 0) {
      const competitorSov = competitorSovByQuery.get(queryId) ?? 0
      const businessImpact = competitorSov * (matchedVolume != null ? matchedVolume / 100 : 1)

      upserts.push(
        upsertGap(brandId, queryId, providerName, 'competitor_only', 'high',
          'Competitor content outranks brand for this query in AI training data',
          `Publish competitive comparison content for: ${queryText}`, businessImpact),
      )
    }

    // --- low_sentiment gap ---
    if (totalBrandMentionCount > 0 && avgSentiment < -0.2) {
      upserts.push(
        upsertGap(brandId, queryId, providerName, 'low_sentiment', 'critical',
          'Negative sentiment in AI responses indicates negative brand perception',
          'Address negative sentiment signals in brand content', volumeWeight),
      )
    }

    // --- no_citation gap ---
    if (totalBrandMentionCount > 0 && brandCitationCount === 0) {
      upserts.push(
        upsertGap(brandId, queryId, providerName, 'no_citation', 'medium',
          'AI models mention brand but don\'t cite brand sources',
          'Build citations by publishing authoritative content', volumeWeight),
      )
    }
  }

  await Promise.all(upserts)
  return upserts.length
}

async function upsertGap(
  brandId: string,
  queryId: string,
  providerName: string,
  gapType: 'no_mention' | 'low_sentiment' | 'no_citation' | 'competitor_only',
  severity: 'critical' | 'high' | 'medium' | 'low',
  rootCause: string,
  recommendedAction: string,
  businessImpact: number,
): Promise<void> {
  const existing = await db.geo_gaps.findFirst({
    where: { brand_id: brandId, query_id: queryId, provider_name: providerName, gap_type: gapType },
  })

  if (existing) {
    await db.geo_gaps.update({
      where: { id: existing.id },
      data: {
        severity,
        root_cause_hypothesis: rootCause,
        recommended_action: recommendedAction,
        business_impact_score: businessImpact,
        updated_at: new Date(),
      },
    })
  } else {
    await db.geo_gaps.create({
      data: {
        brand_id: brandId,
        query_id: queryId,
        provider_name: providerName,
        gap_type: gapType,
        severity,
        root_cause_hypothesis: rootCause,
        recommended_action: recommendedAction,
        business_impact_score: businessImpact,
      },
    })
  }
}
