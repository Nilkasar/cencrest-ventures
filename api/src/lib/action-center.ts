import { db } from './db.js'

export async function syncActionsFromRecommendations(brandId: string, orgId: string): Promise<number> {
  const recs = await db.recommendations.findMany({
    where: { brand_id: brandId, status: { not: 'dismissed' } },
    take: 50,
  })

  let created = 0

  for (const rec of recs) {
    const existing = await db.actions.findFirst({
      where: { source: 'recommendation_engine', source_id: rec.id },
    })

    if (!existing) {
      const priority =
        rec.priority === 'P1' ? 'high' :
        rec.priority === 'P2' ? 'medium' : 'low'

      await db.actions.create({
        data: {
          brand_id: brandId,
          org_id: orgId,
          action_type: 'recommendation',
          title: (rec as any).title ?? rec.recommendation_type,
          description: (rec as any).rationale ?? null,
          priority: priority as any,
          status: 'pending',
          source: 'recommendation_engine',
          source_id: rec.id,
          metadata: {
            recommendation_type: rec.recommendation_type,
            roi_score: (rec as any).roi_score,
          },
        },
      })
      created++
    }
  }

  return created
}

export async function syncActionsFromGeoGaps(brandId: string, orgId: string): Promise<number> {
  const gaps = await db.geo_gaps.findMany({
    where: {
      brand_id: brandId,
      deleted_at: null,
      severity: { in: ['high', 'critical'] as any },
    },
    take: 20,
  })

  let created = 0

  for (const gap of gaps) {
    const existing = await db.actions.findFirst({
      where: { source: 'geo_gap', source_id: gap.id },
    })

    if (!existing) {
      const queryText = (gap as any).query_text ?? gap.gap_type
      await db.actions.create({
        data: {
          brand_id: brandId,
          org_id: orgId,
          action_type: 'geo_gap',
          title: `Fix ${gap.gap_type} gap: ${queryText}`,
          priority: gap.severity === 'critical' ? 'critical' : ('high' as any),
          status: 'pending',
          source: 'geo_gap',
          source_id: gap.id,
          metadata: {
            gap_type: gap.gap_type,
            severity: gap.severity,
          },
        },
      })
      created++
    }
  }

  return created
}

export async function dismissAction(actionId: string, brandId: string): Promise<void> {
  await db.actions.update({
    where: { id: actionId },
    data: {
      status: 'dismissed',
      deleted_at: new Date(),
    },
  })
}

export async function completeAction(actionId: string, brandId: string): Promise<void> {
  await db.actions.update({
    where: { id: actionId },
    data: {
      status: 'completed',
      completed_at: new Date(),
    },
  })
}
