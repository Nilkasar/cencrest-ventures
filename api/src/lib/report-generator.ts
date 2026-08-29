import { db } from '../lib/db.js'

export interface Section {
  title: string
  data: Record<string, unknown>
}

export interface Report {
  id: string
  brand_id: string
  name: string
  type: string
  format: string
  status: string
  file_path?: string | null
  metadata?: unknown
  created_by: string
  created_at: Date
  completed_at?: Date | null
}

export async function generateReport(reportId: string, brandId: string): Promise<void> {
  try {
    await db.reports.update({
      where: { id: reportId },
      data: { status: 'running' },
    })

    let brand: { name: string; industry?: string | null } | null = null
    try {
      brand = await db.brands.findFirst({ where: { id: brandId } })
    } catch {
      brand = null
    }

    const reportRow = await db.reports.findFirst({ where: { id: reportId } })
    const reportType = reportRow?.type ?? 'overview'

    let sections: Section[] = []

    if (reportType === 'visibility') {
      try {
        const runs = await db.prompt_runs.findMany({
          where: { brand_id: brandId },
          orderBy: { created_at: 'desc' },
          take: 5,
        })
        const scores = await db.brand_visibility_scores.findMany({
          where: { brand_id: brandId },
        })
        const byProvider: Record<string, number[]> = {}
        for (const s of scores) {
          const p = s.provider as string
          if (!byProvider[p]) byProvider[p] = []
          byProvider[p].push(Number(s.visibility_score ?? 0))
        }
        const avgByProvider: Record<string, number> = {}
        for (const [p, vals] of Object.entries(byProvider)) {
          avgByProvider[p] = vals.reduce((a, b) => a + b, 0) / vals.length
        }
        sections = [{
          title: 'Visibility Overview',
          data: {
            recent_runs: runs.length,
            avg_visibility_by_provider: avgByProvider,
          },
        }]
      } catch {
        sections = [{ title: 'Visibility Overview', data: { recent_runs: 0, avg_visibility_by_provider: {} } }]
      }
    } else if (reportType === 'competitive') {
      try {
        const compVis = await db.competitor_visibility.findMany({
          where: { brand_id: brandId },
        })
        sections = [{
          title: 'Competitive Landscape',
          data: { competitors: compVis },
        }]
      } catch {
        sections = [{ title: 'Competitive Landscape', data: { competitors: [] } }]
      }
    } else if (reportType === 'seo') {
      try {
        const [keywordsCount, oppsCount] = await Promise.all([
          db.keywords.count({ where: { brand_id: brandId } }),
          db.opportunities.count({ where: { brand_id: brandId } }),
        ])
        sections = [{
          title: 'SEO Summary',
          data: { keywords_count: keywordsCount, opportunities_count: oppsCount },
        }]
      } catch {
        sections = [{ title: 'SEO Summary', data: { keywords_count: 0, opportunities_count: 0 } }]
      }
    } else if (reportType === 'geo') {
      try {
        const geoGaps = await db.geo_gaps.findMany({
          where: { brand_id: brandId },
          select: { gap_type: true },
        })
        const byGapType: Record<string, number> = {}
        for (const g of geoGaps) {
          const t = g.gap_type as string
          byGapType[t] = (byGapType[t] ?? 0) + 1
        }
        sections = [{
          title: 'GEO Gap Analysis',
          data: { gap_count_by_type: byGapType },
        }]
      } catch {
        sections = [{ title: 'GEO Gap Analysis', data: { gap_count_by_type: {} } }]
      }
    } else {
      sections = [{
        title: 'Overview',
        data: { brand: brand?.name ?? '' },
      }]
    }

    const now = new Date()
    const metadata = {
      sections,
      generated_at: now.toISOString(),
      brand_name: brand?.name ?? '',
    }

    await db.reports.update({
      where: { id: reportId },
      data: {
        status: 'completed',
        completed_at: now,
        metadata: metadata as unknown as never,
      },
    })
  } catch (err) {
    try {
      await db.reports.update({
        where: { id: reportId },
        data: { status: 'failed' },
      })
    } catch {
      // ignore
    }
    throw err
  }
}

export async function getReportData(reportId: string): Promise<{ report: Report; sections: Section[] }> {
  const report = await db.reports.findFirst({ where: { id: reportId } }) as Report
  let sections: Section[] = []
  try {
    const meta = report?.metadata as { sections?: Section[] } | null
    sections = meta?.sections ?? []
  } catch {
    sections = []
  }
  return { report, sections }
}
