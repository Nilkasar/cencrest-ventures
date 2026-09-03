import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// `vi.hoisted` — this file (unlike most route test files in this codebase)
// statically imports the module under test at the top level rather than
// via a lazy `await import(...)` inside each test, so the mock factory's
// own variable must be hoisted ABOVE that static import too, not just
// above the `vi.mock` call itself — plain `vi.mock`-only hoisting is not
// enough here (verified directly: it throws "Cannot access ... before
// initialization" without this).
const { mockRunMeasurementForAction } = vi.hoisted(() => ({ mockRunMeasurementForAction: vi.fn() }));
vi.mock('./run-measurement.js', () => ({ runMeasurementForAction: mockRunMeasurementForAction }));

import { FOUR_WEEKS_MS, scheduleRemeasurement } from './schedule-remeasurement.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FOUR_WEEKS_MS', () => {
  it('is exactly 28 days in milliseconds', () => {
    expect(FOUR_WEEKS_MS).toBe(28 * 24 * 60 * 60 * 1000);
  });

  it('exceeds the 32-bit signed-int ceiling a naive setTimeout(delay) would silently clamp to ~1ms — this is exactly why the chunked scheduler exists', () => {
    expect(FOUR_WEEKS_MS).toBeGreaterThan(2 ** 31 - 1);
  });
});

describe('scheduleRemeasurement — injectable trigger (no real wall-clock wait required in tests)', () => {
  it('never requires waiting real time: an injected synchronous scheduler fires runMeasurementForAction immediately', () => {
    mockRunMeasurementForAction.mockResolvedValue({ status: 'measured' });
    const fires: Array<() => void> = [];
    scheduleRemeasurement('action-1', 'org-1', { schedule: (fn) => fires.push(fn) });

    expect(mockRunMeasurementForAction).not.toHaveBeenCalled(); // not fired yet — schedule() only recorded it
    fires[0]!();
    expect(mockRunMeasurementForAction).toHaveBeenCalledWith('org-1', 'action-1');
  });

  it('passes FOUR_WEEKS_MS as the default delay to the scheduler', () => {
    const schedule = vi.fn();
    scheduleRemeasurement('action-1', 'org-1', { schedule });
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), FOUR_WEEKS_MS);
  });

  it('honors an overridden delayMs, e.g. for a short-but-real delay test', () => {
    const schedule = vi.fn();
    scheduleRemeasurement('action-1', 'org-1', { schedule, delayMs: 5000 });
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('never throws synchronously even when runMeasurementForAction rejects — logs the failure instead', async () => {
    mockRunMeasurementForAction.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fires: Array<() => void> = [];

    expect(() => scheduleRemeasurement('action-1', 'org-1', { schedule: (fn) => fires.push(fn) })).not.toThrow();
    expect(() => fires[0]!()).not.toThrow();

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy.mock.calls[0]![0]).toMatch(/remeasurement_failed/);
    errorSpy.mockRestore();
  });
});

describe('scheduleRemeasurement — real (non-injected) scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT fire after only 1ms real elapsed time (the exact bug a naive setTimeout(FOUR_WEEKS_MS) would have)', () => {
    mockRunMeasurementForAction.mockResolvedValue({ status: 'measured' });
    scheduleRemeasurement('action-1', 'org-1');
    vi.advanceTimersByTime(1);
    expect(mockRunMeasurementForAction).not.toHaveBeenCalled();
  });

  it('does NOT fire before the full 4 weeks have elapsed, even past the single-setTimeout 32-bit ceiling', () => {
    mockRunMeasurementForAction.mockResolvedValue({ status: 'measured' });
    scheduleRemeasurement('action-1', 'org-1');
    vi.advanceTimersByTime(FOUR_WEEKS_MS - 1000);
    expect(mockRunMeasurementForAction).not.toHaveBeenCalled();
  });

  it('fires once the full 4 weeks have genuinely elapsed, via the chained sub-max-delay timers', () => {
    mockRunMeasurementForAction.mockResolvedValue({ status: 'measured' });
    scheduleRemeasurement('action-1', 'org-1');
    vi.advanceTimersByTime(FOUR_WEEKS_MS);
    expect(mockRunMeasurementForAction).toHaveBeenCalledWith('org-1', 'action-1');
  });
});
