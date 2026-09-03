/**
 * Process-lifetime singleton — same "one instance app-wide" precedent
 * `lib/billing/payment-provider.ts`'s null-provider factory and
 * `lib/ai-visibility/provider-registry.ts`'s `getDefaultAiProviderRegistry`
 * already establish. Every background-job call site (crawler, AI
 * visibility pipeline, agent runner, free-snapshot pipeline) imports
 * `getDefaultJobQueue()` — never constructs `InMemoryJobQueue` or
 * `PgBossJobQueue` itself — so swapping the implementation is a one-line
 * change here, not a call-site change everywhere.
 */
import type { JobQueue } from './job-queue.js';
import { InMemoryJobQueue } from './in-memory-job-queue.js';

let instance: JobQueue | undefined;

/**
 * Defaults to `InMemoryJobQueue` — functionally equivalent to every prior
 * epic's `setImmediate` placeholder, so this build's behavior is unchanged
 * by this epic's refactor. Swap to durable execution by constructing
 * `new PgBossJobQueue(connectionString)` here instead, and calling
 * `.start()` once at server boot (`server.ts`) before any request that
 * could enqueue a job — a config change, not a code change, per this
 * epic's own definition of done.
 */
export function getDefaultJobQueue(): JobQueue {
  if (!instance) instance = new InMemoryJobQueue();
  return instance;
}

/** Test-only seam — lets a test inject a fresh queue (or a spy wrapping the
 * real one) instead of sharing the process-lifetime singleton with every
 * other test file. */
export function __setDefaultJobQueueForTesting(queue: JobQueue | undefined): void {
  instance = queue;
}
