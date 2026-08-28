import { db } from './db.js'

export const PLANS = {
  free:    { prompt_runs: 10,    ai_tokens: 50000,    crawl_pages: 100,   users: 2,   brands: 1  },
  starter: { prompt_runs: 100,   ai_tokens: 500000,   crawl_pages: 1000,  users: 5,   brands: 3  },
  growth:  { prompt_runs: 1000,  ai_tokens: 5000000,  crawl_pages: 5000,  users: 20,  brands: 10 },
  agency:  { prompt_runs: 10000, ai_tokens: 50000000, crawl_pages: 50000, users: 100, brands: 50 },
} as const

export type PlanName = keyof typeof PLANS
export type UsageMetric = 'prompt_runs' | 'ai_tokens' | 'crawl_pages' | 'users' | 'brands'

export function getPlanLimits(plan: string): typeof PLANS[PlanName] {
  return PLANS[plan as PlanName] ?? PLANS.free
}

export async function checkLimit(
  organizationId: string,
  metric: UsageMetric,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const subscription = await db.subscriptions.findUnique({
    where: { organization_id: organizationId },
  })

  const planName = subscription?.plan ?? 'free'
  const limits = getPlanLimits(planName)
  const limit = limits[metric]

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const records = await db.usage_records.findMany({
    where: {
      organization_id: organizationId,
      metric: metric as never,
      recorded_at: { gte: monthStart, lt: monthEnd },
    },
  })

  const used = records.reduce((sum, r) => sum + r.quantity, 0)

  return { allowed: used < limit, used, limit }
}
