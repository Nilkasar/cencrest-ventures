import { describe, expect, it, beforeEach } from 'vitest';
import { getDefaultErrorTracker, __setDefaultErrorTrackerForTesting } from './default-error-tracker.js';
import { ConsoleErrorTracker } from './console-error-tracker.js';

beforeEach(() => {
  __setDefaultErrorTrackerForTesting(undefined);
});

describe('getDefaultErrorTracker', () => {
  it('defaults to a ConsoleErrorTracker — the exact pre-Epic-19 behavior', () => {
    expect(getDefaultErrorTracker()).toBeInstanceOf(ConsoleErrorTracker);
  });

  it('returns the same process-lifetime singleton instance on every call', () => {
    expect(getDefaultErrorTracker()).toBe(getDefaultErrorTracker());
  });

  it('__setDefaultErrorTrackerForTesting swaps the singleton for a test-provided tracker', () => {
    const custom = new ConsoleErrorTracker();
    __setDefaultErrorTrackerForTesting(custom);
    expect(getDefaultErrorTracker()).toBe(custom);
  });
});
