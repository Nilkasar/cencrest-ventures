import { describe, expect, it, vi } from 'vitest';

vi.mock('@bebest/database', () => {
  const tx = new Proxy({}, { get: () => ({ update: vi.fn(), create: vi.fn(), findFirst: vi.fn() }) });
  return {
    db: tx,
    withOrgContext: vi.fn(async (_orgId: string, fn: (t: unknown) => unknown) => fn(tx)),
    withUserContext: vi.fn(async (_userId: string, fn: (t: unknown) => unknown) => fn(tx)),
    assertRlsEnforced: vi.fn(),
  };
});

import { ALL_JOB_TYPES } from './job-types.js';
import { InFlightJobTracker } from './in-flight-jobs.js';
import { createWorkerRuntime, installSignalHandlers } from './worker-runtime.js';
import type { JobHandler, JobQueue } from './job-queue.js';

const emailSender = {
  sendMagicLink: vi.fn(),
  sendInvitation: vi.fn(),
  sendSnapshotReady: vi.fn(),
} as never;

function recordingQueue(overrides: Partial<JobQueue> = {}) {
  const calls: string[] = [];
  const registered: string[] = [];
  const queue: JobQueue = {
    register: <T>(jobType: string, _handler: JobHandler<T>) => {
      registered.push(jobType);
      calls.push(`register:${jobType}`);
    },
    enqueue: vi.fn(async () => {}),
    start: vi.fn(async () => {
      calls.push('start');
    }),
    stop: vi.fn(async () => {
      calls.push('stop');
    }),
    ...overrides,
  };
  return { queue, calls, registered };
}

/** A job that never finishes, already "in flight" through the tracker — what a
 * ~1,400-prompt AI Visibility run looks like when the host sends SIGTERM. */
function stuckInFlightJob(tracker: InFlightJobTracker) {
  const releaseOnShutdown = vi.fn(async () => {});
  const wrapped = tracker.instrument({
    jobType: ALL_JOB_TYPES[0]!,
    handler: () => new Promise<void>(() => {}),
    releaseOnShutdown,
  });
  void wrapped.handler({ runId: 'run-1', organizationId: 'org-1' });
  return { releaseOnShutdown };
}

describe('WorkerRuntime.start', () => {
  it('registers every declared job type BEFORE the queue starts consuming', async () => {
    const { queue, calls, registered } = recordingQueue();

    await createWorkerRuntime({ queue, emailSender }).start();

    expect([...registered].sort()).toEqual([...ALL_JOB_TYPES].sort());
    expect(calls.indexOf('start')).toBe(calls.length - 1);
    expect(queue.start).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second start() does not re-register or re-connect', async () => {
    const { queue, registered } = recordingQueue();
    const runtime = createWorkerRuntime({ queue, emailSender });

    await runtime.start();
    await runtime.start();

    expect(registered).toHaveLength(ALL_JOB_TYPES.length);
    expect(queue.start).toHaveBeenCalledTimes(1);
  });
});

describe('WorkerRuntime.shutdown — a killed worker must not strand a run', () => {
  it('stops the queue, then releases every job still in flight', async () => {
    const tracker = new InFlightJobTracker();
    const { releaseOnShutdown } = stuckInFlightJob(tracker);
    const { queue, calls } = recordingQueue();
    const runtime = createWorkerRuntime({ queue, emailSender, tracker, shutdownGraceMs: 5 });

    await runtime.shutdown('SIGTERM');

    expect(calls).toContain('stop');
    expect(releaseOnShutdown).toHaveBeenCalledWith({ runId: 'run-1', organizationId: 'org-1' });
  });

  it('releases in-flight work even when the queue never finishes stopping (grace period expires)', async () => {
    const tracker = new InFlightJobTracker();
    const { releaseOnShutdown } = stuckInFlightJob(tracker);
    const { queue } = recordingQueue({ stop: vi.fn(() => new Promise<void>(() => {})) });
    const logs: Record<string, unknown>[] = [];
    const runtime = createWorkerRuntime({
      queue,
      emailSender,
      tracker,
      shutdownGraceMs: 5,
      log: (entry) => logs.push(entry),
    });

    await runtime.shutdown('SIGTERM');

    expect(releaseOnShutdown).toHaveBeenCalledTimes(1);
    const released = logs.find((entry) => entry.msg === 'worker_released_in_flight_jobs');
    expect(released).toMatchObject({ graceExpired: true, inFlight: 1, released: 1, unreleased: 0 });
    expect(logs.at(-1)).toMatchObject({ msg: 'worker_shutdown_complete' });
  });

  it('a release that throws is counted, and the shutdown still completes', async () => {
    const tracker = new InFlightJobTracker();
    const wrapped = tracker.instrument({
      jobType: ALL_JOB_TYPES[0]!,
      handler: () => new Promise<void>(() => {}),
      releaseOnShutdown: async () => {
        throw new Error('database gone');
      },
    });
    void wrapped.handler({ runId: 'run-1' });
    const { queue } = recordingQueue();
    const logs: Record<string, unknown>[] = [];

    await createWorkerRuntime({ queue, emailSender, tracker, shutdownGraceMs: 5, log: (e) => logs.push(e) }).shutdown(
      'SIGTERM',
    );

    expect(logs.find((entry) => entry.msg === 'worker_released_in_flight_jobs')).toMatchObject({
      released: 0,
      unreleased: 1,
    });
    expect(logs.at(-1)).toMatchObject({ msg: 'worker_shutdown_complete' });
  });

  it('a second signal joins the first shutdown instead of stopping the queue twice', async () => {
    const { queue } = recordingQueue();
    const runtime = createWorkerRuntime({ queue, emailSender, shutdownGraceMs: 5 });

    await Promise.all([runtime.shutdown('SIGTERM'), runtime.shutdown('SIGINT')]);

    expect(queue.stop).toHaveBeenCalledTimes(1);
    expect(runtime.isShuttingDown).toBe(true);
  });

  it('with nothing in flight it simply stops the queue', async () => {
    const { queue } = recordingQueue();
    const logs: Record<string, unknown>[] = [];

    await createWorkerRuntime({ queue, emailSender, log: (e) => logs.push(e) }).shutdown('SIGTERM');

    expect(queue.stop).toHaveBeenCalledTimes(1);
    expect(logs.some((entry) => entry.msg === 'worker_released_in_flight_jobs')).toBe(false);
  });
});

describe('installSignalHandlers', () => {
  it('SIGTERM and SIGINT both shut down and then exit 0', async () => {
    const { queue } = recordingQueue();
    const runtime = createWorkerRuntime({ queue, emailSender, shutdownGraceMs: 5 });
    const listeners = new Map<string, () => void>();
    const exit = vi.fn();

    installSignalHandlers(runtime, {
      on: (signal, listener) => listeners.set(signal, listener),
      exit,
    });

    expect([...listeners.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    listeners.get('SIGTERM')!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(queue.stop).toHaveBeenCalledTimes(1);
  });

  it('exits non-zero when the shutdown itself throws', async () => {
    const tracker = new InFlightJobTracker();
    const runtime = createWorkerRuntime({
      queue: recordingQueue().queue,
      emailSender,
      tracker,
      shutdownGraceMs: 5,
    });
    vi.spyOn(runtime, 'shutdown').mockRejectedValue(new Error('boom'));
    const listeners = new Map<string, () => void>();
    const exit = vi.fn();
    const logs: Record<string, unknown>[] = [];

    installSignalHandlers(runtime, { on: (s, l) => listeners.set(s, l), exit, log: (e) => logs.push(e) });
    listeners.get('SIGTERM')!();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logs.at(-1)).toMatchObject({ msg: 'worker_shutdown_failed', signal: 'SIGTERM' });
  });
});
