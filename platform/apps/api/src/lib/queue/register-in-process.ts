/**
 * The dev/test half of the registration story (the worker half is
 * `job-registry.ts`).
 *
 * Before the HTTP/worker split, every job module called
 * `getDefaultJobQueue().register(...)` at module import time and one process
 * both enqueued and ran the job. That is still exactly what we want with no
 * `JOB_QUEUE_DATABASE_URL` configured — `pnpm dev`, `pnpm test`, and the
 * 1,156-test suite all depend on the handler firing in-process — and exactly
 * what we must NOT do on Vercel, where the process that served the request
 * is frozen the moment the response returns and can never run the handler.
 *
 * So each job module keeps its one-line module-load registration, but routes
 * it through here, where it becomes a no-op as soon as a real worker is
 * configured. The handler itself is still exported as a `JobDefinition` for
 * the worker to register deliberately — this function only decides whether
 * THIS process should also consume.
 */
import { getDefaultJobQueue, jobsRunInSeparateWorker } from './default-job-queue.js';
import type { JobDefinition } from './job-queue.js';

export function registerInProcessJobHandler<TPayload>(definition: JobDefinition<TPayload>): void {
  if (jobsRunInSeparateWorker()) return;
  getDefaultJobQueue().register<TPayload>(definition.jobType, definition.handler);
}
