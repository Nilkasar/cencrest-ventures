import { db } from './db.js'

export interface ExperimentResult {
  experiment_id: string
  winner: 'control' | 'variant' | 'inconclusive'
  metrics: Record<string, { control_mean: number; variant_mean: number; lift: number }>
  measurement_count: number
}

export async function analyzeExperiment(experimentId: string): Promise<ExperimentResult> {
  const measurements = await db.experiment_measurements.findMany({
    where: { experiment_id: experimentId },
  })

  const byMetric = new Map<string, { control: number[]; variant: number[] }>()

  for (const m of measurements) {
    if (!byMetric.has(m.metric_name)) {
      byMetric.set(m.metric_name, { control: [], variant: [] })
    }
    const entry = byMetric.get(m.metric_name)!
    if (m.variant === 'control') {
      entry.control.push(Number(m.metric_value))
    } else {
      entry.variant.push(Number(m.metric_value))
    }
  }

  const metrics: Record<string, { control_mean: number; variant_mean: number; lift: number }> = {}
  const lifts: number[] = []

  for (const [metricName, { control, variant }] of byMetric.entries()) {
    const control_mean = control.length > 0 ? control.reduce((a, b) => a + b, 0) / control.length : 0
    const variant_mean = variant.length > 0 ? variant.reduce((a, b) => a + b, 0) / variant.length : 0
    const lift = control_mean !== 0 ? ((variant_mean - control_mean) / control_mean) * 100 : 0
    metrics[metricName] = { control_mean, variant_mean, lift }
    lifts.push(lift)
  }

  const avgLift = lifts.length > 0 ? lifts.reduce((a, b) => a + b, 0) / lifts.length : 0
  const winner: 'control' | 'variant' | 'inconclusive' =
    avgLift > 5 ? 'variant' : avgLift < -5 ? 'control' : 'inconclusive'

  await db.experiments.update({
    where: { id: experimentId },
    data: {
      result_summary: { metrics, winner },
      winner,
    },
  })

  return { experiment_id: experimentId, winner, metrics, measurement_count: measurements.length }
}

export async function recordMeasurement(
  experimentId: string,
  brandId: string,
  variant: string,
  metricName: string,
  metricValue: number,
  metadata?: object,
): Promise<void> {
  await db.experiment_measurements.create({
    data: {
      experiment_id: experimentId,
      brand_id: brandId,
      variant,
      metric_name: metricName,
      metric_value: metricValue,
      measured_at: new Date(),
      metadata: metadata ?? {},
    },
  })
}

export async function startExperiment(experimentId: string): Promise<void> {
  await db.experiments.update({
    where: { id: experimentId },
    data: { status: 'running', started_at: new Date() },
  })
}

export async function endExperiment(experimentId: string): Promise<void> {
  await db.experiments.update({
    where: { id: experimentId },
    data: { status: 'completed', ended_at: new Date() },
  })
  await analyzeExperiment(experimentId)
}
