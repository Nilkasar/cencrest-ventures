import { describe, expect, it, beforeEach } from 'vitest';
import {
  createJobQueueFromEnv,
  getDefaultJobQueue,
  jobsRunInSeparateWorker,
  __setDefaultJobQueueForTesting,
} from './default-job-queue.js';
import { InMemoryJobQueue } from './in-memory-job-queue.js';
import { PgBossJobQueue } from './pgboss-job-queue.js';

beforeEach(() => {
  __setDefaultJobQueueForTesting(undefined);
});

describe('getDefaultJobQueue', () => {
  it('defaults to an InMemoryJobQueue — functionally equivalent to the setImmediate placeholder it replaces', () => {
    expect(getDefaultJobQueue()).toBeInstanceOf(InMemoryJobQueue);
  });

  it('returns the same process-lifetime singleton instance on every call', () => {
    expect(getDefaultJobQueue()).toBe(getDefaultJobQueue());
  });

  it('__setDefaultJobQueueForTesting swaps the singleton for a test-provided queue', () => {
    const custom = new InMemoryJobQueue();
    __setDefaultJobQueueForTesting(custom);
    expect(getDefaultJobQueue()).toBe(custom);
  });
});

describe('createJobQueueFromEnv — the same env-driven provider selection email/billing/error-tracking use', () => {
  it('falls back to InMemoryJobQueue when JOB_QUEUE_DATABASE_URL is unset, so dev and the test suite are unchanged', () => {
    expect(createJobQueueFromEnv({} as NodeJS.ProcessEnv)).toBeInstanceOf(InMemoryJobQueue);
  });

  it('treats a blank/whitespace JOB_QUEUE_DATABASE_URL as unset rather than trying to connect to ""', () => {
    expect(createJobQueueFromEnv({ JOB_QUEUE_DATABASE_URL: '   ' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      InMemoryJobQueue,
    );
  });

  it('builds a PgBossJobQueue when JOB_QUEUE_DATABASE_URL is set (constructing it opens no connection)', () => {
    const queue = createJobQueueFromEnv({
      JOB_QUEUE_DATABASE_URL: 'postgres://bebest_app@localhost:5434/bebest',
    } as NodeJS.ProcessEnv);
    expect(queue).toBeInstanceOf(PgBossJobQueue);
  });
});

describe('jobsRunInSeparateWorker — what tells the HTTP process not to register handlers', () => {
  it('is false with no queue database configured (one process does both, as before the split)', () => {
    expect(jobsRunInSeparateWorker({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is true once a durable queue is configured (the worker is the only consumer)', () => {
    expect(
      jobsRunInSeparateWorker({ JOB_QUEUE_DATABASE_URL: 'postgres://x@y/z' } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
