import { db } from './db.js'
import { processSignals } from './learning-loop.js'
import { syncActionsFromRecommendations, syncActionsFromGeoGaps } from './action-center.js'

export async function executeSchedule(scheduleId: string): Promise<void> {
  const schedule = await db.autonomous_schedules.findFirst({ where: { id: scheduleId } })
  if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`)

  const brandId = schedule.brand_id as string
  const orgId = schedule.org_id as string
  const now = new Date()

  const log = await db.autonomous_run_logs.create({
    data: {
      schedule_id: scheduleId,
      brand_id: brandId,
      status: 'running',
      started_at: now,
    },
  })

  await db.autonomous_schedules.update({
    where: { id: scheduleId },
    data: {
      last_run_at: now,
      run_count: { increment: 1 },
      updated_at: now,
    },
  })

  let tasks_executed: object[] = []

  try {
    const scheduleType = schedule.schedule_type as string

    if (scheduleType === 'growth_agent') {
      await db.growth_agent_runs.create({
        data: { brand_id: brandId, org_id: orgId, status: 'pending', trigger: 'autonomous' },
      })
      tasks_executed = [{ task: 'growth_agent_queued', at: now.toISOString() }]
    } else if (scheduleType === 'process_signals') {
      await processSignals(brandId)
      tasks_executed = [{ task: 'process_signals', at: now.toISOString() }]
    } else if (scheduleType === 'sync_actions') {
      await Promise.all([
        syncActionsFromRecommendations(brandId, orgId),
        syncActionsFromGeoGaps(brandId, orgId),
      ])
      tasks_executed = [{ task: 'sync_actions', at: now.toISOString() }]
    } else {
      tasks_executed = [{ task: 'noop', at: now.toISOString() }]
    }

    await db.autonomous_run_logs.update({
      where: { id: log.id },
      data: {
        status: 'completed',
        completed_at: new Date(),
        tasks_executed,
        summary: { schedule_type: scheduleType, run_id: log.id },
      },
    })
  } catch (err) {
    await db.autonomous_run_logs.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        completed_at: new Date(),
        error_message: err instanceof Error ? err.message : String(err),
      },
    })
    throw err
  }
}

export async function getScheduleStatus(scheduleId: string) {
  const schedule = await db.autonomous_schedules.findFirst({ where: { id: scheduleId } })
  if (!schedule) return null

  const recent_logs = await db.autonomous_run_logs.findMany({
    where: { schedule_id: scheduleId },
    orderBy: { created_at: 'desc' },
    take: 5,
  })

  return { ...schedule, recent_logs }
}
