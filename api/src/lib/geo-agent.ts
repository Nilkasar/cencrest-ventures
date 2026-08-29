import { db } from './db.js'
import { createBrief } from './content-generator.js'
import { generateRecommendations } from './recommendation-engine.js'

export async function runGeoAgent(agentRunId: string, brandId: string, orgId: string): Promise<void> {
  try {
    // 1. Mark running
    await db.geo_agent_runs.update({
      where: { id: agentRunId },
      data: { status: 'running', started_at: new Date() },
    })

    // 2. Load open geo_gaps
    const gaps = await db.geo_gaps.findMany({
      where: { brand_id: brandId, gap_type: { not: null }, deleted_at: null },
      take: 10,
    })

    // 3. Create action rows for each gap
    const actions = await Promise.all(
      gaps.map((gap) =>
        db.geo_agent_actions.create({
          data: {
            agent_run_id: agentRunId,
            brand_id: brandId,
            action_type: 'analyze_gap',
            gap_id: gap.id,
            input_data: {
              gap_id: gap.id,
              gap_type: (gap as any).gap_type,
              severity: (gap as any).severity,
            },
            status: 'pending',
          },
        }),
      ),
    )

    let gaps_processed = 0
    let content_generated = 0
    let recommendations_applied = 0

    // 4. Process each gap
    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i]
      const action = actions[i]
      const gapType = (gap as any).gap_type as string
      const queryText: string = (gap as any).query_text ?? gapType

      if (['no_mention', 'low_sentiment', 'competitor_only'].includes(gapType)) {
        const brief = await createBrief({
          brand_id: brandId,
          content_type: 'blog_post',
          title: `Address ${gapType} gap for query: ${queryText}`,
          target_query: queryText,
          keywords: [],
          created_by: 'geo_agent',
        })

        await db.geo_agent_actions.update({
          where: { id: action.id },
          data: {
            status: 'completed',
            output_data: { brief_id: brief.id, action: 'brief_created' },
            executed_at: new Date(),
          },
        })

        content_generated++
      } else {
        // no_citation — flag for citation
        await db.geo_agent_actions.update({
          where: { id: action.id },
          data: {
            status: 'completed',
            output_data: { action: 'flagged_for_citation' },
            executed_at: new Date(),
          },
        })
      }

      gaps_processed++
    }

    // 5-6. Refresh recommendations
    const recsCount = await generateRecommendations(brandId)
    recommendations_applied = recsCount

    // 7. Mark completed
    await db.geo_agent_runs.update({
      where: { id: agentRunId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        gaps_processed,
        content_generated,
        recommendations_applied,
        summary: { gaps_processed, content_generated, recommendations_applied },
      },
    })
  } catch (err) {
    await db.geo_agent_runs.update({
      where: { id: agentRunId },
      data: {
        status: 'failed',
        error_message: err instanceof Error ? err.message : String(err),
      },
    })
  }
}

export async function getAgentRunStatus(agentRunId: string) {
  return db.geo_agent_runs.findFirst({
    where: { id: agentRunId },
    include: { geo_agent_actions: true },
  })
}
