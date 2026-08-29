import { db } from './db.js'
import { sendNotification } from './notify.js'

export type HealthCheck = {
  id: string
  org_id: string
  health_score: number
  churn_risk: string
  last_active_at: Date | null
  days_since_last_run: number
  actions_completed_30d: number
  signals_processed_30d: number
  recommendations_dismissed_rate: number
  intervention_type: string | null
  intervention_sent_at: Date | null
  notes: string | null
  created_at: Date
  updated_at: Date
}

export async function computeHealthCheck(orgId: string): Promise<HealthCheck> {
  const now = Date.now()
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)

  // Load org
  const org = await db.organizations.findFirst({ where: { id: orgId } })

  // Load account_health
  const accountHealth = await db.account_health.findFirst({ where: { org_id: orgId } })

  // Load last run
  const lastRun = await db.runs.findFirst({
    where: { org_id: orgId },
    orderBy: { created_at: 'desc' },
  })

  const daysSinceLastRun = lastRun
    ? Math.floor((now - new Date(lastRun.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999

  // Load actions completed in last 30 days
  const actionsCompleted30d = await db.actions.count({
    where: {
      org_id: orgId,
      status: 'completed',
      created_at: { gte: thirtyDaysAgo },
    },
  })

  // Load brand ids for org
  const brands = await db.brands.findMany({
    where: { organization_id: orgId },
    select: { id: true },
  })
  const brandIds = brands.map((b: { id: string }) => b.id)

  // Load signals in last 30 days
  const signalsProcessed30d = brandIds.length > 0
    ? await db.learning_signals.count({
        where: {
          brand_id: { in: brandIds },
          created_at: { gte: thirtyDaysAgo },
        },
      })
    : 0

  // Compute recommendations dismissed rate
  let recommendationsDismissedRate = 0
  if (brandIds.length > 0) {
    const [dismissed, total] = await Promise.all([
      db.recommendations.count({ where: { brand_id: { in: brandIds }, status: 'dismissed' } }),
      db.recommendations.count({ where: { brand_id: { in: brandIds } } }),
    ])
    recommendationsDismissedRate = total > 0 ? dismissed / total : 0
  }

  // Compute health_score
  let score = 100

  if (daysSinceLastRun > 30) score -= 30
  else if (daysSinceLastRun > 14) score -= 15
  else if (daysSinceLastRun > 7) score -= 5

  if (actionsCompleted30d === 0) score -= 20
  else if (actionsCompleted30d < 5) score -= 10

  if (recommendationsDismissedRate > 0.7) score -= 15
  else if (recommendationsDismissedRate > 0.4) score -= 5

  if (accountHealth) {
    score += (accountHealth.health_score / 100) * 20
  }

  const healthScore = Math.min(100, Math.max(0, Math.round(score)))

  // Determine churn_risk
  let churnRisk: string
  if (healthScore < 30) churnRisk = 'critical'
  else if (healthScore < 50) churnRisk = 'high'
  else if (healthScore < 70) churnRisk = 'medium'
  else churnRisk = 'low'

  // Determine intervention_type
  let interventionType: string | null = null
  if (churnRisk === 'critical') interventionType = 'emergency_call'
  else if (churnRisk === 'high') interventionType = 'proactive_outreach'
  else if (churnRisk === 'medium') interventionType = 'check_in_email'

  // Upsert into customer_health_checks
  const row = await db.customer_health_checks.upsert({
    where: { org_id: orgId },
    create: {
      org_id: orgId,
      health_score: healthScore,
      churn_risk: churnRisk,
      last_active_at: lastRun ? new Date(lastRun.created_at) : null,
      days_since_last_run: daysSinceLastRun,
      actions_completed_30d: actionsCompleted30d,
      signals_processed_30d: signalsProcessed30d,
      recommendations_dismissed_rate: recommendationsDismissedRate,
      intervention_type: interventionType,
    },
    update: {
      health_score: healthScore,
      churn_risk: churnRisk,
      last_active_at: lastRun ? new Date(lastRun.created_at) : null,
      days_since_last_run: daysSinceLastRun,
      actions_completed_30d: actionsCompleted30d,
      signals_processed_30d: signalsProcessed30d,
      recommendations_dismissed_rate: recommendationsDismissedRate,
      intervention_type: interventionType,
      updated_at: new Date(),
    },
  })

  return row as HealthCheck
}

export async function runInterventions(orgId: string): Promise<void> {
  const check = await db.customer_health_checks.findFirst({ where: { org_id: orgId } })
  if (!check) return

  const { churn_risk, health_score, intervention_type, intervention_sent_at } = check as HealthCheck

  if (churn_risk === 'low') return

  if (churn_risk === 'high' || churn_risk === 'critical') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const shouldSend = !intervention_sent_at || new Date(intervention_sent_at) < sevenDaysAgo

    if (shouldSend) {
      await sendNotification({
        userId: orgId,
        orgId,
        type: 'billing_alert',
        title: `Customer Success: ${churn_risk} churn risk detected`,
        body: `Health score: ${health_score}. Intervention: ${intervention_type}`,
      })

      await db.customer_health_checks.update({
        where: { org_id: orgId },
        data: { intervention_sent_at: new Date() },
      })
    }
  }
}

export async function getAllHealthChecks(filters?: { churn_risk?: string }): Promise<HealthCheck[]> {
  const where = filters?.churn_risk ? { churn_risk: filters.churn_risk } : {}
  const rows = await db.customer_health_checks.findMany({
    where,
    orderBy: { health_score: 'asc' },
    take: 100,
  })
  return rows as HealthCheck[]
}
