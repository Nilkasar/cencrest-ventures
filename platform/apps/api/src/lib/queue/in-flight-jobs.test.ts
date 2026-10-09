import { describe, expect, it, vi } from 'vitest';
import { InFlightJobTracker } from './in-flight-jobs.js';
import type { RegisteredJob } from './registered-job.js';

function job(overrides: Partial<RegisteredJob> = {}): RegisteredJob {
  return {
    jobType: 'ai_visibility_run',
    handler: vi.fn(async () => {}),
    releaseOnShutdown: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('InFlightJobTracker', () => {
  it('counts a job only while its handler is running', async () => {
    const tracker = new InFlightJobTracker();
    let finish: () => void = () => {};
    const instrumented = tracker.instrument(job({ handler: () => new Promise<void>((r) => (finish = r)) }));

    expect(tracker.size).toBe(0);
    const running = instrumented.handler({ runId: 'run-1' });
    expect(tracker.size).toBe(1);
    expect(tracker.inFlightJobTypes()).toEqual(['ai_visibility_run']);

    finish();
    await running;
    expect(tracker.size).toBe(0);
  });

  it('stops counting a job whose handler threw (the domain row is already handled by the handler itself)', async () => {
    const tracker = new InFlightJobTracker();
    const instrumented = tracker.instrument(job({ handler: async () => { throw new Error('boom'); } }));

    await expect(instrumented.handler({})).rejects.toThrow('boom');
    expect(tracker.size).toBe(0);
  });

  it('releases every in-flight job with its own payload', async () => {
    const tracker = new InFlightJobTracker();
    const releaseOnShutdown = vi.fn(async () => {});
    const instrumented = tracker.instrument(job({ handler: () => new Promise<void>(() => {}), releaseOnShutdown }));

    void instrumented.handler({ runId: 'run-1' });
    void instrumented.handler({ runId: 'run-2' });

    await expect(tracker.releaseAll()).resolves.toEqual({ inFlight: 2, released: 2, unreleased: 0 });
    expect(releaseOnShutdown).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(releaseOnShutdown).toHaveBeenCalledWith({ runId: 'run-2' });
  });

  it('counts a job with no releaseOnShutdown as unreleased instead of pretending it was handled', async () => {
    const tracker = new InFlightJobTracker();
    const instrumented = tracker.instrument(
      job({ handler: () => new Promise<void>(() => {}), releaseOnShutdown: undefined }),
    );
    void instrumented.handler({});

    await expect(tracker.releaseAll()).resolves.toEqual({ inFlight: 1, released: 0, unreleased: 1 });
  });

  it('never throws out of releaseAll when a release fails', async () => {
    const tracker = new InFlightJobTracker();
    const instrumented = tracker.instrument(
      job({
        handler: () => new Promise<void>(() => {}),
        releaseOnShutdown: async () => {
          throw new Error('database gone');
        },
      }),
    );
    void instrumented.handler({});

    await expect(tracker.releaseAll()).resolves.toEqual({ inFlight: 1, released: 0, unreleased: 1 });
  });

  it('reports nothing to release when the process is idle', async () => {
    await expect(new InFlightJobTracker().releaseAll()).resolves.toEqual({ inFlight: 0, released: 0, unreleased: 0 });
  });
});
