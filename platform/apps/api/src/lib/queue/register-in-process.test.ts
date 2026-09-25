import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryJobQueue } from './in-memory-job-queue.js';
import { __setDefaultJobQueueForTesting } from './default-job-queue.js';
import { registerInProcessJobHandler } from './register-in-process.js';
import { JOB_TYPES } from './job-types.js';
import type { JobDefinition } from './job-queue.js';

const original = process.env.JOB_QUEUE_DATABASE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.JOB_QUEUE_DATABASE_URL;
  else process.env.JOB_QUEUE_DATABASE_URL = original;
  __setDefaultJobQueueForTesting(undefined);
});

let queue: InMemoryJobQueue;
let handler: ReturnType<typeof vi.fn>;
let definition: JobDefinition<{ runId: string }>;

beforeEach(() => {
  queue = new InMemoryJobQueue();
  vi.spyOn(queue, 'register');
  __setDefaultJobQueueForTesting(queue);
  handler = vi.fn().mockResolvedValue(undefined);
  definition = { jobType: JOB_TYPES.AI_VISIBILITY_RUN, handler };
});

describe('registerInProcessJobHandler', () => {
  it('registers on the default queue when no separate worker is configured (dev/test parity)', () => {
    delete process.env.JOB_QUEUE_DATABASE_URL;

    registerInProcessJobHandler(definition);

    expect(queue.register).toHaveBeenCalledWith(JOB_TYPES.AI_VISIBILITY_RUN, handler);
  });

  it('registers NOTHING once a durable queue is configured — the Vercel HTTP process must never claim a job it cannot finish', () => {
    process.env.JOB_QUEUE_DATABASE_URL = 'postgres://bebest_app@localhost:5434/bebest';

    registerInProcessJobHandler(definition);

    expect(queue.register).not.toHaveBeenCalled();
  });
});
