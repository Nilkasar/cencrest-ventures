import { db } from './db.js'

export async function analyseRun(runId: string, brandId: string): Promise<void> {
  // Load brand + competitors
  const brand = await db.brands.findFirst({
    where: { id: brandId, deleted_at: null },
    include: { competitors: { where: { deleted_at: null } } },
  })
  if (!brand) return

  // Load all ai_responses for this run
  const responses = await db.ai_responses.findMany({
    where: { prompt_jobs: { run_id: runId } },
  })

  // Process each response
  for (const response of responses) {
    const mentions = extractMentions(
      response.response_text,
      { name: brand.name, aliases: brand.aliases ?? [] },
      brand.competitors,
    )

    for (const m of mentions) {
      await db.mention_extractions.create({
        data: {
          response_id: response.id,
          entity_name: m.entity_name,
          entity_type: m.entity_type as 'brand' | 'competitor' | 'product',
          mention_count: m.mention_count,
          first_mention_pos: m.first_mention_pos ?? null,
          sentiment: m.sentiment as 'positive' | 'neutral' | 'negative',
          sentiment_score: m.sentiment_score,
          is_recommended: m.is_recommended,
        },
      })
    }

    const citations = extractCitations(response.response_text)
    for (const c of citations) {
      await db.citations.create({
        data: {
          response_id: response.id,
          url: c.url ?? null,
          domain: c.domain ?? null,
          citation_type: c.citation_type as 'link' | 'named_source' | 'implicit',
          context_snippet: c.context_snippet,
        },
      })
    }
  }

  // Compute visibility scores per provider
  const providerMap = new Map<string, typeof responses>()
  for (const r of responses) {
    const list = providerMap.get(r.provider_name) ?? []
    list.push(r)
    providerMap.set(r.provider_name, list)
  }

  for (const [providerName, provResponses] of providerMap) {
    const total = provResponses.length
    let withMention = 0
    let sentimentSum = 0
    let positionSum = 0
    let positionCount = 0
    let recommendationCount = 0

    for (const r of provResponses) {
      const extractions = await db.mention_extractions.findMany({
        where: { response_id: r.id, entity_type: 'brand' },
      })

      const hasMention = extractions.some((e) => e.mention_count > 0)
      if (hasMention) withMention++

      for (const e of extractions) {
        const sentVal =
          e.sentiment === 'positive' ? 1 : e.sentiment === 'negative' ? -1 : 0
        sentimentSum += sentVal
        if (e.first_mention_pos != null) {
          positionSum += e.first_mention_pos
          positionCount++
        }
        if (e.is_recommended) recommendationCount++
      }
    }

    const mention_rate = total > 0 ? withMention / total : 0
    const avg_sentiment = total > 0 ? sentimentSum / total : 0
    const avg_position = positionCount > 0 ? positionSum / positionCount : null

    // Normalise sentiment to 0-1 (was -1..1)
    const sentiment_weight = (avg_sentiment + 1) / 2
    // Normalise position: lower is better; assume max 10000 chars
    const position_weight =
      avg_position != null ? Math.max(0, 1 - avg_position / 10000) : 0
    const recommendation_bonus = total > 0 ? recommendationCount / total : 0

    const score =
      mention_rate * 40 +
      sentiment_weight * 30 +
      position_weight * 20 +
      recommendation_bonus * 10

    await db.visibility_scores.upsert({
      where: { brand_id_provider_name_run_id: { brand_id: brandId, provider_name: providerName, run_id: runId } },
      create: {
        brand_id: brandId,
        provider_name: providerName,
        run_id: runId,
        score,
        mention_rate,
        avg_sentiment,
        avg_position: avg_position ?? undefined,
      },
      update: {
        score,
        mention_rate,
        avg_sentiment,
        avg_position: avg_position ?? undefined,
        calculated_at: new Date(),
      },
    })
  }
}

export function extractMentions(
  text: string,
  brand: { name: string; aliases: string[] },
  competitors: Array<{ name: string }>,
): Array<{
  entity_name: string
  entity_type: string
  mention_count: number
  first_mention_pos: number | null
  sentiment: string
  sentiment_score: number
  is_recommended: boolean
}> {
  const results: ReturnType<typeof extractMentions> = []

  const entities: Array<{ name: string; type: string }> = [
    { name: brand.name, type: 'brand' },
    ...(brand.aliases ?? []).map((a) => ({ name: a, type: 'brand' })),
    ...competitors.map((c) => ({ name: c.name, type: 'competitor' })),
  ]

  const seen = new Set<string>()

  for (const entity of entities) {
    const key = `${entity.type}:${entity.name}`
    if (seen.has(key)) continue
    seen.add(key)

    const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi')

    let match: RegExpExecArray | null
    let count = 0
    let firstPos: number | null = null

    while ((match = regex.exec(text)) !== null) {
      count++
      if (firstPos === null) firstPos = match.index
    }

    if (count === 0) continue

    // Sentiment: scan 100 chars around first mention
    const snippet =
      firstPos !== null
        ? text.slice(Math.max(0, firstPos - 50), firstPos + entity.name.length + 50)
        : ''

    const positiveWords = /excellent|best|recommend|great|top/i
    const negativeWords = /avoid|poor|bad|worst|not recommended/i

    let sentiment = 'neutral'
    let sentiment_score = 0
    if (positiveWords.test(snippet)) {
      sentiment = 'positive'
      sentiment_score = 0.8
    } else if (negativeWords.test(snippet)) {
      sentiment = 'negative'
      sentiment_score = -0.8
    }

    // is_recommended
    const surroundStart = firstPos !== null ? Math.max(0, firstPos - 100) : 0
    const surroundEnd =
      firstPos !== null ? firstPos + entity.name.length + 100 : 200
    const surround = text.slice(surroundStart, surroundEnd)
    const is_recommended = /i recommend|best choice|you should use/i.test(surround)

    results.push({
      entity_name: entity.name,
      entity_type: entity.type,
      mention_count: count,
      first_mention_pos: firstPos,
      sentiment,
      sentiment_score,
      is_recommended,
    })
  }

  return results
}

export function extractCitations(text: string): Array<{
  url: string | null
  domain: string | null
  citation_type: string
  context_snippet: string
}> {
  const results: ReturnType<typeof extractCitations> = []

  // Extract URLs
  const urlRegex = /https?:\/\/[^\s"')>]+/g
  let match: RegExpExecArray | null
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0]
    let domain: string | null = null
    try {
      domain = new URL(url).hostname
    } catch {
      // ignore
    }
    const start = Math.max(0, match.index - 50)
    const end = Math.min(text.length, match.index + url.length + 50)
    results.push({
      url,
      domain,
      citation_type: 'link',
      context_snippet: text.slice(start, end),
    })
  }

  // Named sources: "according to [Source]" or "[Source] reports"
  const namedRegex =
    /(?:according to ([A-Z][A-Za-z0-9 ]{1,50})|([A-Z][A-Za-z0-9 ]{1,50}) reports)/g
  while ((match = namedRegex.exec(text)) !== null) {
    const source = match[1] ?? match[2]
    const start = Math.max(0, match.index - 50)
    const end = Math.min(text.length, match.index + match[0].length + 50)
    results.push({
      url: null,
      domain: null,
      citation_type: 'named_source',
      context_snippet: text.slice(start, end),
    })
    void source
  }

  return results
}
