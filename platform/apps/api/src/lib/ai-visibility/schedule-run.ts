/**
 * The PREPARE/QUEUE-to-EXECUTE handoff shared by `routes/ai-runs.ts` (brand
 * runs) and `routes/competitor-ai-runs.ts` (Epic 8 competitor runs) —
 * factored out here so both routes schedule the identical fire-and-forget
 * background job with identical failure handling, rather than two copies of
 * the same `setImmediate`/`.catch()` block drifting apart over time.
 *
 * TODO: replace with a durable queue (pg-boss) — same documented,
 * no-queue-package-in-this-monorepo placeholder `routes/crawl.ts` already
 * uses (checked again at this epic's spec time: still true). A process
 * restart mid-run currently strands it in `running` forever with no retry.
 */
import { withOrgContext } from '@bebest/database';
import { runAiVisibilityRun } from './pipeline.js';

export function scheduleAiVisibilityRun(runId: string, organizationId: string, brandId: string): void {
  setImmediate(() => {
    void runAiVisibilityRun(runId, organizationId, brandId).catch(async (err) => {
      await withOrgContext(organizationId, (tx) =>
        tx.ai_runs.update({
          where: { id: runId },
          data: { status: 'failed', error: String((err as Error)?.message ?? err), completed_at: new Date() },
        }),
      ).catch(() => {
        // Best-effort — if even this write fails, the run is left in
        // whatever state runAiVisibilityRun last successfully wrote.
      });
    });
  });
}
