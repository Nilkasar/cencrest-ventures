import { describe, expect, it, afterEach } from 'vitest';
import {
  assertAutonomyLevelAllowed,
  resolveRequestedAutonomyLevel,
  AutonomyLevelRejectedError,
  MAX_AUTONOMY_LEVEL,
  MIN_AUTONOMY_LEVEL,
} from './autonomy.js';

/**
 * This epic's own explicit DoD: "A test proving Level 4 is unreachable
 * under every input combination tried, not just the documented default."
 * Every test below tries a DIFFERENT way a caller might attempt to reach
 * level 4 (or something worse) — the point is breadth of input shapes, not
 * just re-asserting the same case seven times.
 */
describe('assertAutonomyLevelAllowed — Level 4 is unreachable', () => {
  it.each([1, 2, 3])('allows the documented valid levels (%d)', (level) => {
    expect(assertAutonomyLevelAllowed(level)).toBe(level);
  });

  it.each([
    ['the literal forbidden value', 4],
    ['one above the forbidden value', 5],
    ['a large out-of-range integer', 100],
    ['zero', 0],
    ['a negative integer', -1],
    ['a negative number equal in magnitude to the forbidden value', -4],
  ])('rejects %s (%p) with AutonomyLevelRejectedError', (_label, value) => {
    expect(() => assertAutonomyLevelAllowed(value)).toThrow(AutonomyLevelRejectedError);
  });

  it.each([
    ['a non-integer number', 3.5],
    ['NaN', NaN],
    ['positive Infinity', Infinity],
    ['negative Infinity', -Infinity],
    ['a numeric string', '4'],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an object', { level: 4 }],
    ['an array', [4]],
  ])('rejects the malformed input %s (%p) — never coerces it into a valid level', (_label, value) => {
    expect(() => assertAutonomyLevelAllowed(value)).toThrow(AutonomyLevelRejectedError);
  });

  it('never returns a value outside 1..MAX_AUTONOMY_LEVEL for any input in a wide sweep', () => {
    for (let level = -10; level <= 20; level += 1) {
      if (level >= MIN_AUTONOMY_LEVEL && level <= MAX_AUTONOMY_LEVEL) {
        expect(assertAutonomyLevelAllowed(level)).toBe(level);
      } else {
        expect(() => assertAutonomyLevelAllowed(level)).toThrow(AutonomyLevelRejectedError);
      }
    }
  });

  it('MAX_AUTONOMY_LEVEL is 3 — the constant itself, not just current behavior, encodes the ceiling', () => {
    expect(MAX_AUTONOMY_LEVEL).toBe(3);
  });
});

describe('assertAutonomyLevelAllowed — AUTONOMOUS_MODE has zero effect (the doc\'s own named Level-4 gate)', () => {
  const ORIGINAL = process.env.AUTONOMOUS_MODE;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AUTONOMOUS_MODE;
    else process.env.AUTONOMOUS_MODE = ORIGINAL;
  });

  it.each(['true', 'True', '1', 'yes', 'TRUE'])(
    'still rejects level 4 with process.env.AUTONOMOUS_MODE=%p set',
    (flagValue) => {
      process.env.AUTONOMOUS_MODE = flagValue;
      expect(() => assertAutonomyLevelAllowed(4)).toThrow(AutonomyLevelRejectedError);
    },
  );

  it('setting AUTONOMOUS_MODE=true does not even change level 1-3 behavior (the function reads no env var at all)', () => {
    process.env.AUTONOMOUS_MODE = 'true';
    expect(assertAutonomyLevelAllowed(1)).toBe(1);
    expect(assertAutonomyLevelAllowed(2)).toBe(2);
    expect(assertAutonomyLevelAllowed(3)).toBe(3);
    expect(() => assertAutonomyLevelAllowed(4)).toThrow(AutonomyLevelRejectedError);
  });
});

describe('resolveRequestedAutonomyLevel — combining a request with a plan cap', () => {
  it('defaults to level 1 when nothing was requested', () => {
    expect(resolveRequestedAutonomyLevel(undefined, null)).toBe(1);
  });

  it('accepts a level at or below the plan cap', () => {
    expect(resolveRequestedAutonomyLevel(2, 3)).toBe(2);
    expect(resolveRequestedAutonomyLevel(3, 3)).toBe(3);
  });

  it('rejects a level above the plan cap even though it is a globally valid level', () => {
    expect(() => resolveRequestedAutonomyLevel(3, 2)).toThrow(AutonomyLevelRejectedError);
  });

  it('null plan cap means "no plan-specific cap," NOT "unlimited up to 4" — level 4 is still rejected', () => {
    expect(() => resolveRequestedAutonomyLevel(4, null)).toThrow(AutonomyLevelRejectedError);
  });

  it.each([4, 5, 10, 99])(
    'even a CORRUPTED/misconfigured plan.autonomy_level_max of %d cannot unlock level 4 — the ' +
      'unconditional global check runs regardless of what the plan says',
    (corruptedPlanMax) => {
      expect(() => resolveRequestedAutonomyLevel(4, corruptedPlanMax)).toThrow(AutonomyLevelRejectedError);
    },
  );

  it('a corrupted plan.autonomy_level_max of 4+ does not even affect requests for a VALID level — 3 is still allowed', () => {
    expect(resolveRequestedAutonomyLevel(3, 4)).toBe(3);
  });

  it('rejects malformed requested values the same way assertAutonomyLevelAllowed does, regardless of plan cap', () => {
    expect(() => resolveRequestedAutonomyLevel('4', null)).toThrow(AutonomyLevelRejectedError);
    expect(() => resolveRequestedAutonomyLevel(NaN, 3)).toThrow(AutonomyLevelRejectedError);
  });

  it('does not clamp — a rejected level throws, it is never silently downgraded to 3', () => {
    let thrown: unknown;
    try {
      resolveRequestedAutonomyLevel(4, null);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AutonomyLevelRejectedError);
    expect((thrown as AutonomyLevelRejectedError).requested).toBe(4);
  });
});
