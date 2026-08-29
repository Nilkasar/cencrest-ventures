import { db } from './db.js'
import { createBrief } from './content-generator.js'

export async function runSeoAgent(
  agentRunId: string,
  brandId: string,
  orgId: string,
): Promise<void> {
  try {
    // 1. Mark as running
    await db.seo_agent_runs.update({
      where: { id: agentRunId },
      data: { status: 'running', started_at: new Date() },
    })

    // 2. Load top P1 opportunities
    const opportunities = await db.opportunities.findMany({
      where: { brand_id: brandId, tier: 'P1', deleted_at: null },
      take: 10,
    })

    // 3. Create action rows
    for (const opp of opportunities) {
      await db.seo_agent_actions.create({
        data: {
          agent_run_id: agentRunId,
          brand_id: brandId,
          action_type: 'process_opportunity',
          opportunity_id: opp.id,
          input_data: {
            opportunity_id: opp.id,
            opportunity_type: (opp as any).opportunity_type,
            unified_score: (opp as any).unified_score,
          },
          status: 'pending',
        },
      })
    }

    // 4. Process each opportunity
    let opportunitiesProcessed = 0
    let contentGenerated = 0

    for (const opp of opportunities) {
      const actionRow = await db.seo_agent_actions.findFirst({
        where: { agent_run_id: agentRunId, opportunity_id: opp.id },
      })

      const oppType = (opp as any).opportunity_type
      const keyword = (opp as any).keyword

      if (oppType === 'keyword_gap' || oppType === 'content_gap') {
        const brief = await createBrief({
          brand_id: brandId,
          content_type: 'blog_post',
          title: `Target SEO opportunity: ${keyword || oppType}`,
          target_query: keyword || null,
          keywords: keyword ? [keyword] : [],
          created_by: 'seo_agent',
        })

        if (actionRow) {
          await db.seo_agent_actions.update({
            where: { id: actionRow.id },
            data: {
              status: 'completed',
              output_data: { brief_id: brief.id, action: 'brief_created' },
              executed_at: new Date(),
            },
          })
        }
        contentGenerated++
      } else {
        if (actionRow) {
          await db.seo_agent_actions.update({
            where: { id: actionRow.id },
            data: {
              status: 'completed',
              output_data: { action: 'flagged_for_review' },
              executed_at: new Date(),
            },
          })
        }
      }

      opportunitiesProcessed++
    }

    // 5. Count keywords
    const keywords = await db.keywords.findMany({
      where: { brand_id: brandId, deleted_at: null },
      take: 50,
    })
    const keywordsProcessed = keywords.length

    // 6. Mark completed
    await db.seo_agent_runs.update({
      where: { id: agentRunId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        keywords_processed: keywordsProcessed,
        opportunities_processed: opportunitiesProcessed,
        content_generated: contentGenerated,
        summary: { keywords_processed: keywordsProcessed, opportunities_processed: opportunitiesProcessed, content_generated: contentGenerated },
      },
    })
  } catch (err) {
    await db.seo_agent_runs.update({
      where: { id: agentRunId },
      data: {
        status: 'failed',
        error_message: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => {})
  }
}

export async function getSeoRunStatus(agentRunId: string) {
  return db.seo_agent_runs.findFirst({
    where: { id: agentRunId },
    include: { seo_agent_actions: true },
  })
}
