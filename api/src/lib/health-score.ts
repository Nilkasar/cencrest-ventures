import { db } from './db.js'

export async function calculateHealthScore(orgId: string): Promise<{
  health_score: number
  prompt_runs_last_30d: number
  logins_last_7d: number
  actions_completed: number
  risk_level: 'healthy' | 'at_risk' | 'churning'
}> {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // prompt_runs_last_30d: count via brand_id lookup
  let prompt_runs_last_30d = 0
  try {
    const brands = await db.brands.findMany({
      where: { organization_id: orgId, deleted_at: null },
      select: { id: true },
    })
    const brandIds = brands.map((b) => b.id)
    if (brandIds.length > 0) {
      prompt_runs_last_30d = await (db as any).prompt_runs.count({
        where: {
          brand_id: { in: brandIds },
          status: 'complete',
          created_at: { gte: thirtyDaysAgo },
        },
      })
    }
  } catch {
    prompt_runs_last_30d = 0
  }

  // logins_last_7d: count auth_events for org's users
  let logins_last_7d = 0
  try {
    const memberships = await db.memberships.findMany({
      where: { organization_id: orgId },
      select: { user_id: true },
    })
    const userIds = memberships.map((m) => m.user_id)
    if (userIds.length > 0) {
      logins_last_7d = await (db as any).auth_events.count({
        where: {
          user_id: { in: userIds },
          event_type: 'login',
          created_at: { gte: sevenDaysAgo },
        },
      })
    }
  } catch {
    logins_last_7d = 0
  }

  // actions_completed: usage_records with metric = 'prompt_runs' in last 30 days
  let actions_completed = 0
  try {
    actions_completed = await db.usage_records.count({
      where: {
        organization_id: orgId,
        metric: 'prompt_runs' as any,
        recorded_at: { gte: thirtyDaysAgo },
      },
    })
  } catch {
    actions_completed = 0
  }

  // Score calculation
  let score = 0

  if (prompt_runs_last_30d >= 10) score += 40
  else if (prompt_runs_last_30d >= 3) score += 20
  else if (prompt_runs_last_30d >= 1) score += 10

  if (logins_last_7d >= 5) score += 30
  else if (logins_last_7d >= 2) score += 15
  else if (logins_last_7d >= 1) score += 10

  if (actions_completed >= 5) score += 30
  else if (actions_completed >= 2) score += 15
  else if (actions_completed >= 1) score += 10

  const risk_level: 'healthy' | 'at_risk' | 'churning' =
    score >= 60 ? 'healthy' : score >= 30 ? 'at_risk' : 'churning'

  return { health_score: score, prompt_runs_last_30d, logins_last_7d, actions_completed, risk_level }
}

export async function recalculateAllHealthScores(): Promise<void> {
  const orgs = await db.organizations.findMany({
    where: { deleted_at: null },
    select: { id: true },
  })

  for (const org of orgs) {
    const data = await calculateHealthScore(org.id)
    await db.account_health.upsert({
      where: { org_id: org.id },
      update: {
        health_score: data.health_score,
        prompt_runs_last_30d: data.prompt_runs_last_30d,
        logins_last_7d: data.logins_last_7d,
        actions_completed: data.actions_completed,
        risk_level: data.risk_level,
        calculated_at: new Date(),
      },
      create: {
        org_id: org.id,
        health_score: data.health_score,
        prompt_runs_last_30d: data.prompt_runs_last_30d,
        logins_last_7d: data.logins_last_7d,
        actions_completed: data.actions_completed,
        risk_level: data.risk_level,
        calculated_at: new Date(),
      },
    })
  }
}
