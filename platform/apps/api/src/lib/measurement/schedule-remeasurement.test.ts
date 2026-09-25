/**
 * Epic 14's re-measurement trigger, as a queue job rather than a `setTimeout`.
 *
 * The assertions that matter here are the ones that fail if someone moves the
 * four-week wait back into the scheduling process: the delay must be handed to
 * the queue, and the work must be reachable from a payload alone.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const enqueue = vi.fn();
vi.mock('../queue/default-job-queue.js', () => ({
  getDefaultJobQueue: () => ({ enqueue, register: vi.fn() }),
  jobsRunInSeparateWorker: () => true,
}));
vi.mock('../queue/register-in-process.js', () => ({ registerInProcessJobHandler: vi.fn() }));

const { mockRunMeasurementForAction } = vi.hoisted(() => ({ mockRunMeasurementForAction: vi.fn() }));
vi.mock('./run-measurement.js', () => ({ runMeasurementForAction: mockRunMeasurementForAction }));

import { FOUR_WEEKS_MS, remeasurementJob, scheduleRemeasurement } from './schedule-remeasurement.js';
import { JOB_TYPES } from '../queue/job-types.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FOUR_WEEKS_MS', () => {
  it('is exactly 28 days in milliseconds', () => {
    expect(FOUR_WEEKS_MS).toBe(28 * 24 * 60 * 60 * 1000);
  });

  it('exceeds the 32-bit signed-int ceiling, which is why the delay must live in the queue and not in a JS timer', () => {
    // A single setTimeout(FOUR_WEEKS_MS) silently clamps to ~1ms. pg-boss
    // stores the delay in Postgres and has no such ceiling. If anyone moves
    // this back onto setTimeout, this is the fact that makes it wrong.
    expect(FOUR_WEEKS_MS).toBeGreaterThan(2 ** 31 - 1);
  });
});

describe('scheduleRemeasurement', () => {
  it('enqueues the remeasurement job with a serializable payload and the four-week delay', async () => {
    await scheduleRemeasurement('action-1', 'org-1');

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      JOB_TYPES.REMEASUREMENT,
      { actionId: 'action-1', organizationId: 'org-1' },
      { delayMs: FOUR_WEEKS_MS },
    );
  });

  it('honors an overridden delayMs so a test never waits real time', async () => {
    await scheduleRemeasurement('action-1', 'org-1', { delayMs: 5000 });
    expect(enqueue).toHaveBeenCalledWith(JOB_TYPES.REMEASUREMENT, expect.anything(), { delayMs: 5000 });
  });

  it('does not run the measurement itself — that is the worker\'s job', async () => {
    await scheduleRemeasurement('action-1', 'org-1');
    expect(mockRunMeasurementForAction).not.toHaveBeenCalled();
  });

  it('propagates an enqueue failure rather than reporting a re-measurement that was never scheduled', async () => {
    enqueue.mockRejectedValueOnce(new Error('queue down'));
    await expect(scheduleRemeasurement('action-1', 'org-1')).rejects.toThrow('queue down');
  });
});

describe('remeasurementJob handler', () => {
  it('reconstructs the work from the payload alone, with org before action', async () => {
    mockRunMeasurementForAction.mockResolvedValue({ status: 'measured' });
    await remeasurementJob.handler({ actionId: 'action-1', organizationId: 'org-1' });
    expect(mockRunMeasurementForAction).toHaveBeenCalledWith('org-1', 'action-1');
  });

  it('never throws past its own logging when the measurement rejects', async () => {
    mockRunMeasurementForAction.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(remeasurementJob.handler({ actionId: 'action-1', organizationId: 'org-1' })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]![0]).toMatch(/remeasurement_failed/);
    errorSpy.mockRestore();
  });

  it('is declared under the canonical job type, so the worker coverage check sees it', () => {
    expect(remeasurementJob.jobType).toBe(JOB_TYPES.REMEASUREMENT);
  });
});
