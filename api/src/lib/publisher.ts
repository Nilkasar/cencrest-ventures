import { db } from '../lib/db.js'

async function appendLog(jobId: string, event: string): Promise<void> {
  const job = await db.publish_jobs.findFirst({ where: { id: jobId } })
  const currentLog: { event: string; at: string }[] = Array.isArray(job?.publish_log) ? (job.publish_log as { event: string; at: string }[]) : []
  currentLog.push({ event, at: new Date().toISOString() })
  await db.publish_jobs.update({
    where: { id: jobId },
    data: { publish_log: currentLog },
  })
}

export async function submitForApproval(jobId: string): Promise<void> {
  await db.publish_jobs.update({
    where: { id: jobId },
    data: { status: 'pending_approval', updated_at: new Date() },
  })
  await appendLog(jobId, 'submitted')
}

export async function approveJob(jobId: string, approverId: string): Promise<void> {
  await db.publish_jobs.update({
    where: { id: jobId },
    data: { status: 'approved', approved_by: approverId, approved_at: new Date(), updated_at: new Date() },
  })
  await appendLog(jobId, 'approved')
}

export async function rejectJob(jobId: string, reason: string): Promise<void> {
  await db.publish_jobs.update({
    where: { id: jobId },
    data: { status: 'rejected', rejection_reason: reason, updated_at: new Date() },
  })
  await appendLog(jobId, 'rejected')
}

export async function scheduleJob(jobId: string, scheduledAt: Date): Promise<void> {
  await db.publish_jobs.update({
    where: { id: jobId },
    data: { status: 'scheduled', scheduled_at: scheduledAt, updated_at: new Date() },
  })
  await appendLog(jobId, 'scheduled')
}

export async function executePublish(jobId: string): Promise<void> {
  try {
    await db.publish_jobs.update({
      where: { id: jobId },
      data: { status: 'publishing', updated_at: new Date() },
    })
    await appendLog(jobId, 'publishing_started')

    await new Promise(resolve => setTimeout(resolve, 100))

    await db.publish_jobs.update({
      where: { id: jobId },
      data: {
        status: 'published',
        published_at: new Date(),
        published_url: `https://placeholder.example.com/content/${jobId}`,
        updated_at: new Date(),
      },
    })
    await appendLog(jobId, 'published')
  } catch (err) {
    await db.publish_jobs.update({
      where: { id: jobId },
      data: { status: 'failed', updated_at: new Date() },
    })
    await appendLog(jobId, `failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
