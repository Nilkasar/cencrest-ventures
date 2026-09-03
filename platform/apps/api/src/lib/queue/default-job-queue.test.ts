import { describe, expect, it, beforeEach } from 'vitest';
import { getDefaultJobQueue, __setDefaultJobQueueForTesting } from './default-job-queue.js';
import { InMemoryJobQueue } from './in-memory-job-queue.js';

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
