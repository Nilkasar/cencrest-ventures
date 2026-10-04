/**
 * Starting a crawl for a brand — the write path `POST /brands/me/crawl`
 * (routes/crawl.ts) always had, moved here unchanged so onboarding
 * completion (Epic 22 Phase 2, lib/onboarding/complete.ts) starts the first
 * crawl through exactly the same code instead of a copy.
 *
 * The background handler is registered here, at module load, so whichever
 * caller is imported first, `crawl_job` is registered exactly once.
 */
import { withOrgContext, type brands, type crawl_jobs } from '@bebest/database';
import { runCrawlJob } from './engine.js';
import { getDefaultJobQueue } from '../queue/default-job-queue.js';

interface CrawlJobPayload {
  jobId: string;
  organizationId: string;
  brandId: string;
  rootUrl: string;
}

const CRAWL_JOB_TYPE = 'crawl_job';

// Epic 19 (Production Hardening), item 1 — registered once at module load,
// routed through `JobQueue` instead of a raw `setImmediate` call. See
// `lib/queue/job-queue.ts`'s header comment for the full design;
// behaviorally unchanged in this build (default queue is
// `InMemoryJobQueue`, still fires via `setImmediate` under the hood).
getDefaultJobQueue().register<CrawlJobPayload>(CRAWL_JOB_TYPE, async ({ jobId, organizationId, brandId, rootUrl }) => {
  await runCrawlJob(jobId, organizationId, brandId, rootUrl).catch(async (err) => {
    await withOrgContext(organizationId, (tx) =>
      tx.crawl_jobs.update({
        where: { id: jobId },
        data: { status: 'failed', error: String((err as Error)?.message ?? err), completed_at: new Date() },
      }),
    ).catch(() => {
      // Best-effort — if even this write fails, the job is left in
      // whatever state runCrawlJob last successfully wrote.
    });
  });
});

export type StartCrawlResult =
  | { status: 'started'; job: crawl_jobs }
  | { status: 'skipped'; reason: 'no_website_url' }
  | { status: 'skipped'; reason: 'crawl_already_in_progress'; job: crawl_jobs };

/**
 * Creates the `crawl_jobs` row (status `queued`) and enqueues the crawl, or
 * says why it did not. Callers decide the HTTP meaning of a skip (the crawl
 * route answers 422/409; onboarding reports it as `skipped`) and write their
 * own audit event for a started job.
 */
export async function startCrawlForBrand(params: {
  organizationId: string;
  brand: Pick<brands, 'id' | 'website_url'>;
  userId: string;
}): Promise<StartCrawlResult> {
  const { organizationId, brand, userId } = params;
  if (!brand.website_url) return { status: 'skipped', reason: 'no_website_url' };

  const existingActive = await withOrgContext(organizationId, (tx) =>
    tx.crawl_jobs.findFirst({
      where: { brand_id: brand.id, organization_id: organizationId, status: { in: ['queued', 'running'] } },
    }),
  );
  if (existingActive) return { status: 'skipped', reason: 'crawl_already_in_progress', job: existingActive };

  // The crawl_jobs row is created HERE, synchronously, before the
  // background job is even scheduled — let alone before any HTTP request
  // is made. This is the literal invariant
  // docs/epics/03-website-intelligence.md's end-to-end flow step 1 checks:
  // "confirm a crawl_jobs row is created in queued status before any HTTP
  // request is made."
  const job = await withOrgContext(organizationId, (tx) =>
    tx.crawl_jobs.create({
      data: {
        organization_id: organizationId,
        brand_id: brand.id,
        root_url: brand.website_url as string,
        status: 'queued',
        created_by: userId,
      },
    }),
  );

  // A process restart between `queued` and `completed` currently strands
  // the job in `running` forever with no retry — `InMemoryJobQueue` (the
  // default `JobQueue`, see `lib/queue/default-job-queue.ts`) is not
  // durable, same gap the `setImmediate` it replaces had. Documented, not
  // solved here; solved by pointing `default-job-queue.ts` at
  // `PgBossJobQueue` with a real connection string.
  void getDefaultJobQueue().enqueue<CrawlJobPayload>(CRAWL_JOB_TYPE, {
    jobId: job.id,
    organizationId,
    brandId: brand.id,
    rootUrl: job.root_url,
  });

  return { status: 'started', job };
}
