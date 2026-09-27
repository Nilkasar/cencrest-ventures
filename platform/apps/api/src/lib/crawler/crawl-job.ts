/**
 * The crawl background job — extracted out of `routes/crawl.ts` by the
 * HTTP/worker split.
 *
 * It used to live in the route file and register its handler there at module
 * import time. That shape only works when one process both serves the
 * request and runs the job. Under the split the route runs on Vercel
 * serverless (where a crawl — up to 500 pages at 2 req/sec — cannot finish)
 * and the handler runs in the worker (`src/worker.ts`), which must be able to
 * import the handler without importing a Hono route tree.
 *
 * `scheduleCrawlJob` is awaited by its caller: with a durable queue the
 * enqueue is a real INSERT, and a serverless function that returns before it
 * lands loses the job.
 */
import { withOrgContext } from '@bebest/database';
import { getDefaultJobQueue } from '../queue/default-job-queue.js';
import { registerInProcessJobHandler } from '../queue/register-in-process.js';
import { JOB_TYPES } from '../queue/job-types.js';
import type { JobDefinition } from '../queue/job-queue.js';
import { runCrawlJob } from './engine.js';

export interface CrawlJobPayload {
  jobId: string;
  organizationId: string;
  brandId: string;
  rootUrl: string;
}

/** Best-effort — if even this write fails, the job is left in whatever state
 * `runCrawlJob` last successfully wrote. `withOrgContext` sets
 * `app.current_org` first; `crawl_jobs` is a tenant table under RLS and the
 * worker has no BYPASSRLS, same as the API. */
async function markCrawlJobFailed(jobId: string, organizationId: string, error: string): Promise<void> {
  await withOrgContext(organizationId, (tx) =>
    tx.crawl_jobs.update({
      where: { id: jobId },
      data: { status: 'failed', error, completed_at: new Date() },
    }),
  ).catch(() => {
    // Intentionally swallowed — see above.
  });
}

export const crawlJob: JobDefinition<CrawlJobPayload> = {
  jobType: JOB_TYPES.CRAWL,
  handler: async ({ jobId, organizationId, brandId, rootUrl }) => {
    await runCrawlJob(jobId, organizationId, brandId, rootUrl).catch(async (err) => {
      await markCrawlJobFailed(jobId, organizationId, String((err as Error)?.message ?? err));
    });
  },
  releaseOnShutdown: async ({ jobId, organizationId }) => {
    await markCrawlJobFailed(
      jobId,
      organizationId,
      'Worker shut down while this crawl was in progress; the crawl did not complete. Retry it.',
    );
  },
};

registerInProcessJobHandler(crawlJob);

export async function scheduleCrawlJob(payload: CrawlJobPayload): Promise<void> {
  await getDefaultJobQueue().enqueue<CrawlJobPayload>(JOB_TYPES.CRAWL, payload);
}
