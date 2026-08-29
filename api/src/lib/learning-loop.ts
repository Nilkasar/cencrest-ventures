import { db } from '../lib/db.js'

export interface LearningInsight {
  id: string
  brand_id: string
  insight_type: string
  title: string
  description: string
  confidence: number
  supporting_signals: string[]
  action_taken: boolean
  action_type: string | null
  created_at: Date
  updated_at: Date
}

export async function recordSignal(
  brandId: string,
  signalType: string,
  source: string,
  metricName: string,
  metricValue: number,
  options?: { sourceId?: string; delta?: number; context?: object },
): Promise<void> {
  await db.learning_signals.create({
    data: {
      brand_id: brandId,
      signal_type: signalType,
      source,
      source_id: options?.sourceId ?? null,
      metric_name: metricName,
      metric_value: metricValue,
      delta: options?.delta ?? null,
      context: options?.context ?? null,
      processed: false,
      processed_at: null,
      recorded_at: new Date(),
    },
  })
}

export async function processSignals(brandId: string): Promise<number> {
  const signals = await db.learning_signals.findMany({
    where: { brand_id: brandId, processed: false },
    take: 100,
    orderBy: { recorded_at: 'asc' },
  }) as Array<{
    id: string
    signal_type: string
    metric_name: string
    metric_value: number | { toNumber(): number }
  }>

  if (signals.length === 0) return 0

  // Group by (signal_type, metric_name)
  const groups = new Map<string, typeof signals>()
  for (const sig of signals) {
    const key = `${sig.signal_type}::${sig.metric_name}`
    const arr = groups.get(key) ?? []
    arr.push(sig)
    groups.set(key, arr)
  }

  for (const [key, group] of groups) {
    if (group.length < 3) continue

    const values = group.map(s =>
      typeof s.metric_value === 'object' ? s.metric_value.toNumber() : Number(s.metric_value),
    )
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const trend = values[values.length - 1] - values[0]

    if (Math.abs(trend) > 0.1 * Math.abs(mean)) {
      const [signalType, metricName] = key.split('::')
      await db.learning_insights.create({
        data: {
          brand_id: brandId,
          insight_type: signalType,
          title: `${metricName} ${trend > 0 ? 'improving' : 'declining'} for ${signalType}`,
          description: `Based on ${group.length} signals. Mean: ${mean.toFixed(2)}, trend: ${trend > 0 ? '+' : ''}${trend.toFixed(2)}`,
          confidence: Math.min(0.99, group.length / 20),
          supporting_signals: group.map(s => s.id),
          action_taken: false,
          action_type: null,
        },
      })
    }
  }

  await db.learning_signals.updateMany({
    where: { id: { in: signals.map(s => s.id) } },
    data: { processed: true, processed_at: new Date() },
  })

  return signals.length
}

export async function getInsights(brandId: string, limit = 20): Promise<LearningInsight[]> {
  return db.learning_insights.findMany({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
    take: limit,
  }) as Promise<LearningInsight[]>
}

export async function markInsightActioned(insightId: string, actionType: string): Promise<void> {
  await db.learning_insights.update({
    where: { id: insightId },
    data: { action_taken: true, action_type: actionType, updated_at: new Date() },
  })
}
