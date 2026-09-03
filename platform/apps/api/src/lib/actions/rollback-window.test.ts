import { describe, expect, it } from 'vitest';
import { isWithinRollbackWindow, rollbackDeadline, ROLLBACK_WINDOW_MS } from './rollback-window.js';

const EXECUTED_AT = new Date('2026-01-01T00:00:00.000Z');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe('rollbackDeadline', () => {
  it('is exactly executedAt + 30 days', () => {
    expect(ROLLBACK_WINDOW_MS).toBe(THIRTY_DAYS_MS);
    expect(rollbackDeadline(EXECUTED_AT).getTime()).toBe(EXECUTED_AT.getTime() + THIRTY_DAYS_MS);
  });
});

describe('isWithinRollbackWindow', () => {
  it('is true immediately after execution', () => {
    expect(isWithinRollbackWindow(EXECUTED_AT, new Date(EXECUTED_AT.getTime() + 1000))).toBe(true);
  });

  it('is true well inside the window (day 15)', () => {
    const now = new Date(EXECUTED_AT.getTime() + 15 * 24 * 60 * 60 * 1000);
    expect(isWithinRollbackWindow(EXECUTED_AT, now)).toBe(true);
  });

  // ── The exact boundary — this is the test this epic's DoD explicitly
  // requires: "30-day-window boundary tests (just inside / just outside)."

  it('is true exactly AT the 30-day deadline instant (inclusive boundary)', () => {
    const deadline = rollbackDeadline(EXECUTED_AT);
    expect(isWithinRollbackWindow(EXECUTED_AT, deadline)).toBe(true);
  });

  it('is true one millisecond BEFORE the deadline (just inside)', () => {
    const deadline = rollbackDeadline(EXECUTED_AT);
    const justInside = new Date(deadline.getTime() - 1);
    expect(isWithinRollbackWindow(EXECUTED_AT, justInside)).toBe(true);
  });

  it('is false one millisecond AFTER the deadline (just outside)', () => {
    const deadline = rollbackDeadline(EXECUTED_AT);
    const justOutside = new Date(deadline.getTime() + 1);
    expect(isWithinRollbackWindow(EXECUTED_AT, justOutside)).toBe(false);
  });

  it('is false well outside the window (day 31)', () => {
    const now = new Date(EXECUTED_AT.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(isWithinRollbackWindow(EXECUTED_AT, now)).toBe(false);
  });

  it('is false far outside the window (day 365)', () => {
    const now = new Date(EXECUTED_AT.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(isWithinRollbackWindow(EXECUTED_AT, now)).toBe(false);
  });

  it('defaults `now` to the real clock when omitted', () => {
    // Execution "30 days and a bit" in the past, by real wall-clock time —
    // proves the default parameter path itself, not just the explicit-`now`
    // path every other test in this file exercises.
    const longAgo = new Date(Date.now() - (THIRTY_DAYS_MS + 60_000));
    expect(isWithinRollbackWindow(longAgo)).toBe(false);
    const recent = new Date(Date.now() - 1000);
    expect(isWithinRollbackWindow(recent)).toBe(true);
  });
});
