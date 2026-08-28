import { db } from './db.js'
import { buildProvider, decryptKey } from './ai-provider.js'

const MAX_RESPONSE_CHARS = 50_000
const MAX_ATTEMPTS = 3

export async function executeRun(runId: string, brandId: string): Promise<void> {
  // 1. Mark run as running
  await db.prompt_runs.update({
    where: { id: runId },
    data: { status: 'running', started_at: new Date(), updated_at: new Date() },
  })

  try {
    // 2. Load all buyer_journeys for brand
    const queries = await db.buyer_journeys.findMany({
      where: { brand_id: brandId, deleted_at: null },
    })

    // 3. Load active org_ai_providers for the brand's org
    const brand = await db.brands.findFirst({ where: { id: brandId } })
    if (!brand) {
      await db.prompt_runs.update({
        where: { id: runId },
        data: { status: 'failed', error_message: 'Brand not found', completed_at: new Date(), updated_at: new Date() },
      })
      return
    }

    const providers = await db.org_ai_providers.findMany({
      where: { organization_id: brand.organization_id, is_active: true },
      orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    })

    // 4. No providers configured
    if (providers.length === 0) {
      await db.prompt_runs.update({
        where: { id: runId },
        data: { status: 'failed', error_message: 'No AI providers configured', completed_at: new Date(), updated_at: new Date() },
      })
      return
    }

    // 5. Create prompt_jobs for each query × provider combination
    const jobData: Array<{ run_id: string; query_id: string; provider_id: string }> = []
    for (const query of queries) {
      for (const provider of providers) {
        jobData.push({ run_id: runId, query_id: query.id, provider_id: provider.id })
      }
    }

    await db.prompt_jobs.createMany({ data: jobData })

    // 6. Update total_prompts count
    const totalPrompts = jobData.length
    await db.prompt_runs.update({
      where: { id: runId },
      data: { total_prompts: totalPrompts, updated_at: new Date() },
    })

    // 7-9. Process each job
    const jobs = await db.prompt_jobs.findMany({
      where: { run_id: runId },
      include: { buyer_journeys: true, org_ai_providers: true },
    })

    let completedCount = 0
    let failedCount = 0

    for (const job of jobs) {
      // Re-check run status to support cancellation
      const currentRun = await db.prompt_runs.findFirst({ where: { id: runId } })
      if (currentRun?.status === 'cancelled') break

      const providerConfig = job.org_ai_providers
      if (!providerConfig) {
        await db.prompt_jobs.update({
          where: { id: job.id },
          data: { status: 'failed', last_error: 'Provider not found', completed_at: new Date() },
        })
        failedCount++
        completedCount++
        await db.prompt_runs.update({
          where: { id: runId },
          data: { completed_prompts: completedCount, updated_at: new Date() },
        })
        continue
      }

      let apiKey: string | null = null
      if (providerConfig.api_key_enc) {
        try {
          apiKey = decryptKey(providerConfig.api_key_enc)
        } catch {
          await db.prompt_jobs.update({
            where: { id: job.id },
            data: { status: 'failed', last_error: 'Failed to decrypt API key', completed_at: new Date() },
          })
          failedCount++
          completedCount++
          await db.prompt_runs.update({
            where: { id: runId },
            data: { completed_prompts: completedCount, updated_at: new Date() },
          })
          continue
        }
      }

      const query = job.buyer_journeys
      let succeeded = false

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const provider = buildProvider(providerConfig.provider_name, providerConfig.model, apiKey)
          const start = Date.now()
          const response = await provider.complete(query.query)
          const latencyMs = Date.now() - start

          const truncatedText = response.text.slice(0, MAX_RESPONSE_CHARS)

          // 8. Save ai_response and mark job complete
          await db.ai_responses.create({
            data: {
              prompt_job_id: job.id,
              query_id: query.id,
              provider_name: response.provider,
              model: response.model,
              prompt_text: query.query,
              response_text: truncatedText,
              tokens_in: response.tokens_in,
              tokens_out: response.tokens_out,
              latency_ms: latencyMs,
            },
          })

          await db.prompt_jobs.update({
            where: { id: job.id },
            data: { status: 'complete', attempts: attempt, completed_at: new Date() },
          })

          succeeded = true
          break
        } catch (err) {
          await db.prompt_jobs.update({
            where: { id: job.id },
            data: { attempts: attempt, last_error: String(err) },
          })

          if (attempt === MAX_ATTEMPTS) {
            await db.prompt_jobs.update({
              where: { id: job.id },
              data: { status: 'failed', completed_at: new Date() },
            })
          }
        }
      }

      if (!succeeded) failedCount++
      completedCount++

      // 9. Update completed_prompts after each job
      await db.prompt_runs.update({
        where: { id: runId },
        data: { completed_prompts: completedCount, updated_at: new Date() },
      })
    }

    // 10. Finalize run status
    const failureRate = totalPrompts > 0 ? failedCount / totalPrompts : 0
    const finalStatus = failureRate > 0.5 ? 'failed' : 'complete'

    await db.prompt_runs.update({
      where: { id: runId },
      data: { status: finalStatus, completed_at: new Date(), updated_at: new Date() },
    })
  } catch (err) {
    await db.prompt_runs.update({
      where: { id: runId },
      data: { status: 'failed', error_message: String(err), completed_at: new Date(), updated_at: new Date() },
    })
  }
}
