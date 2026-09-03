import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryJobQueue } from './in-memory-job-queue.js';

describe('InMemoryJobQueue', () => {
  it('fires the registered handler with the enqueued payload, asynchronously (never before enqueue() returns)', async () => {
    const queue = new InMemoryJobQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register('greet', handler);

    await queue.enqueue('greet', { name: 'Ada' });
    expect(handler).not.toHaveBeenCalled(); // enqueue() resolving does not mean the handler ran yet

    await new Promise((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledWith({ name: 'Ada' });
  });

  it('does not reject or leave an unhandled rejection when no handler is registered — logs it the same way a handler failure is instead', async () => {
    const queue = new InMemoryJobQueue();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandledRejectionSpy = vi.fn();
    process.on('unhandledRejection', unhandledRejectionSpy);

    try {
      // enqueue() is `async`; a bare `throw` in its body would reject the
      // returned Promise rather than throw synchronously. It must resolve
      // instead — matching every real call site's bare `void enqueue(...)`
      // with no `.catch()`.
      await expect(queue.enqueue('unregistered', {})).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
      expect(logged).toMatchObject({
        level: 'error',
        msg: 'in_memory_job_queue_handler_failed',
        jobType: 'unregistered',
        error: expect.stringMatching(/no handler registered for job type "unregistered"/),
      });

      expect(unhandledRejectionSpy).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejectionSpy);
      errorSpy.mockRestore();
    }
  });

  it('a bare `void enqueue(...)` with no handler registered and no .catch() (the real call-site pattern) produces no unhandled rejection', async () => {
    const queue = new InMemoryJobQueue();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandledRejectionSpy = vi.fn();
    process.on('unhandledRejection', unhandledRejectionSpy);

    try {
      void queue.enqueue('unregistered', {}); // no await, no .catch() — exactly how routes/crawl.ts etc. call this
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandledRejectionSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.off('unhandledRejection', unhandledRejectionSpy);
      errorSpy.mockRestore();
    }
  });

  it('register() is idempotent per job type — a second registration replaces the first', async () => {
    const queue = new InMemoryJobQueue();
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    queue.register('job', first);
    queue.register('job', second);

    await queue.enqueue('job', { n: 1 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ n: 1 });
  });

  it('a rejecting handler is caught and logged, never thrown back into enqueue() or left unhandled', async () => {
    const queue = new InMemoryJobQueue();
    queue.register('boom', async () => {
      throw new Error('handler exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(queue.enqueue('boom', {})).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({ level: 'error', msg: 'in_memory_job_queue_handler_failed', jobType: 'boom', error: 'handler exploded' });
    errorSpy.mockRestore();
  });

  it('two independent jobs registered on the same queue fire independently with their own payloads', async () => {
    const queue = new InMemoryJobQueue();
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    queue.register('a', a);
    queue.register('b', b);

    await queue.enqueue('a', { x: 1 });
    await queue.enqueue('b', { y: 2 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(a).toHaveBeenCalledWith({ x: 1 });
    expect(b).toHaveBeenCalledWith({ y: 2 });
  });

  it('start() and stop() are no-ops that resolve without throwing (nothing to connect to)', async () => {
    const queue = new InMemoryJobQueue();
    await expect(queue.start()).resolves.toBeUndefined();
    await expect(queue.stop()).resolves.toBeUndefined();
  });

  describe('delayMs', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not fire before the requested delay has elapsed', async () => {
      const queue = new InMemoryJobQueue();
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.register('delayed', handler);

      await queue.enqueue('delayed', { n: 1 }, { delayMs: 5000 });
      vi.advanceTimersByTime(4999);
      expect(handler).not.toHaveBeenCalled();
    });

    it('fires once the requested delay has elapsed', async () => {
      const queue = new InMemoryJobQueue();
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.register('delayed', handler);

      await queue.enqueue('delayed', { n: 1 }, { delayMs: 5000 });
      vi.advanceTimersByTime(5000);
      expect(handler).toHaveBeenCalledWith({ n: 1 });
    });

    it('handles a delay past the 32-bit setTimeout ceiling without silently clamping to ~1ms', async () => {
      const OVER_CEILING_MS = 2 ** 31; // one past Node's signed-32-bit setTimeout ceiling
      const queue = new InMemoryJobQueue();
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.register('long-delay', handler);

      await queue.enqueue('long-delay', { n: 1 }, { delayMs: OVER_CEILING_MS });
      vi.advanceTimersByTime(1);
      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(OVER_CEILING_MS);
      expect(handler).toHaveBeenCalledWith({ n: 1 });
    });
  });
});
