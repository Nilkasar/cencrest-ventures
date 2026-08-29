import { db } from './db.js'
import { runGeoAgent } from './geo-agent.js'
import { runSeoAgent } from './seo-agent.js'

export async function runGrowthAgent(growthRunId: string, brandId: string, orgId: string): Promise<void> {
  try {
    await db.growth_agent_runs.update({
      where: { id: growthRunId },
      data: { status: 'running', started_at: new Date() },
    })

    const geoRun = await db.geo_agent_runs.create({
      data: { brand_id: brandId, org_id: orgId, status: 'pending', trigger: 'growth_agent' },
    })
    const seoRun = await db.seo_agent_runs.create({
      data: { brand_id: brandId, org_id: orgId, status: 'pending', trigger: 'growth_agent' },
    })

    await db.growth_agent_runs.update({
      where: { id: growthRunId },
      data: { geo_run_id: geoRun.id, seo_run_id: seoRun.id },
    })

    await runGeoAgent(geoRun.id, brandId, orgId)
    await runSeoAgent(seoRun.id, brandId, orgId)

    const finalGeo = await db.geo_agent_runs.findFirst({ where: { id: geoRun.id } })
    const finalSeo = await db.seo_agent_runs.findFirst({ where: { id: seoRun.id } })

    const gapsProcessed = (finalGeo as any)?.gaps_processed ?? 0
    const oppsProcessed = (finalSeo as any)?.opportunities_processed ?? 0
    const contentGenerated = ((finalGeo as any)?.content_generated ?? 0) + ((finalSeo as any)?.content_generated ?? 0)

    await db.growth_agent_runs.update({
      where: { id: growthRunId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        total_gaps_processed: gapsProcessed,
        total_opportunities_processed: oppsProcessed,
        total_content_generated: contentGenerated,
        summary: { geo_run_id: geoRun.id, seo_run_id: seoRun.id, gapsProcessed, oppsProcessed, contentGenerated },
      },
    })
  } catch (err: any) {
    await db.growth_agent_runs.update({
      where: { id: growthRunId },
      data: { status: 'failed', error_message: err.message },
    }).catch(() => {})
  }
}

export async function getGrowthRunStatus(growthRunId: string) {
  return db.growth_agent_runs.findFirst({ where: { id: growthRunId } })
}
