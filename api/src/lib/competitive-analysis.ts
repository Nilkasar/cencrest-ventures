import { db } from './db.js'

export async function computeCompetitorVisibility(brandId: string, runId: string): Promise<void> {
  // 1. Load all competitors for the brand (not deleted)
  const competitors = await db.competitors.findMany({
    where: { brand_id: brandId, deleted_at: null },
  })

  if (competitors.length === 0) return

  // 2. Load all ai_responses for this run via prompt_jobs, with their mention_extractions
  const aiResponses = await db.ai_responses.findMany({
    where: {
      prompt_jobs: { run_id: runId },
    },
    include: {
      mention_extractions: {
        where: { entity_type: 'competitor' },
      },
    },
  })

  // Group responses by provider
  const responsesByProvider = new Map<string, typeof aiResponses>()
  for (const resp of aiResponses) {
    const list = responsesByProvider.get(resp.provider_name) ?? []
    list.push(resp)
    responsesByProvider.set(resp.provider_name, list)
  }

  for (const competitor of competitors) {
    for (const [providerName, responses] of responsesByProvider.entries()) {
      const totalResponses = responses.length
      let responsesWithMention = 0
      let sentimentSum = 0
      let sentimentCount = 0

      for (const resp of responses) {
        const competitorMentions = resp.mention_extractions.filter(
          (m) => m.entity_name.toLowerCase() === competitor.name.toLowerCase(),
        )
        if (competitorMentions.length > 0) {
          responsesWithMention++
          for (const m of competitorMentions) {
            if (m.sentiment_score !== null && m.sentiment_score !== undefined) {
              sentimentSum += Number(m.sentiment_score)
              sentimentCount++
            }
          }
        }
      }

      const mentionRate = totalResponses > 0 ? responsesWithMention / totalResponses : 0
      const avgSentiment = sentimentCount > 0 ? sentimentSum / sentimentCount : 0
      // score = mention_rate × 60 + (avg_sentiment + 1) / 2 × 40
      const score = mentionRate * 60 + ((avgSentiment + 1) / 2) * 40

      await db.competitor_visibility.upsert({
        where: {
          competitor_id_provider_name_run_id: {
            competitor_id: competitor.id,
            provider_name: providerName,
            run_id: runId,
          },
        },
        update: {
          score,
          mention_rate: mentionRate,
          avg_sentiment: avgSentiment,
          calculated_at: new Date(),
        },
        create: {
          brand_id: brandId,
          competitor_id: competitor.id,
          provider_name: providerName,
          run_id: runId,
          score,
          mention_rate: mentionRate,
          avg_sentiment: avgSentiment,
        },
      })
    }
  }
}

export async function computeShareOfVoice(brandId: string, runId: string): Promise<void> {
  // 1. Load all prompt_jobs for this run, then their ai_responses with mention_extractions
  const promptJobs = await db.prompt_jobs.findMany({
    where: { run_id: runId },
    include: {
      ai_responses: {
        include: {
          mention_extractions: true,
        },
      },
    },
  })

  // Collect all query_ids in this run
  const queryIds = new Set<string>()
  for (const job of promptJobs) {
    queryIds.add(job.query_id)
  }

  for (const queryId of queryIds) {
    // Get all responses for this query in this run
    const jobsForQuery = promptJobs.filter((j) => j.query_id === queryId)
    const allMentions: Array<{ entity_name: string; entity_type: string; mention_count: number }> =
      []

    for (const job of jobsForQuery) {
      for (const resp of job.ai_responses) {
        for (const m of resp.mention_extractions) {
          allMentions.push({
            entity_name: m.entity_name,
            entity_type: m.entity_type,
            mention_count: m.mention_count,
          })
        }
      }
    }

    // Sum up mentions per entity
    const entityMentions = new Map<string, { entity_type: string; total: number }>()
    for (const m of allMentions) {
      const existing = entityMentions.get(m.entity_name) ?? { entity_type: m.entity_type, total: 0 }
      existing.total += m.mention_count
      entityMentions.set(m.entity_name, existing)
    }

    const totalMentions = Array.from(entityMentions.values()).reduce((sum, e) => sum + e.total, 0)

    for (const [entityName, data] of entityMentions.entries()) {
      const sovPct = totalMentions > 0 ? (data.total / totalMentions) * 100 : 0

      await db.share_of_voice.upsert({
        where: {
          query_id_run_id_entity_name: {
            query_id: queryId,
            run_id: runId,
            entity_name: entityName,
          },
        },
        update: {
          sov_pct: sovPct,
          mentions: data.total,
          calculated_at: new Date(),
        },
        create: {
          brand_id: brandId,
          query_id: queryId,
          run_id: runId,
          entity_name: entityName,
          entity_type: data.entity_type as 'brand' | 'competitor' | 'product',
          sov_pct: sovPct,
          mentions: data.total,
        },
      })
    }
  }
}
