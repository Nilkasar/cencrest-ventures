import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('reads the message off a real Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('keeps a meaningful error name as a prefix, and drops the useless one', () => {
    expect(describeError(new TypeError('not a function'))).toBe('TypeError: not a function');
    expect(describeError(new Error('plain'))).toBe('plain');
  });

  // The case this function exists for. Prisma with the Neon serverless adapter
  // rejects with a DOM-style ErrorEvent on a connection failure: `instanceof
  // Error` is false, so the usual idiom logged "[object Object]" and threw away
  // `connect ECONNREFUSED …`. Reproduced here with the shape observed from the
  // built bundle (constructor ErrorEvent, own key clientVersion, string message).
  it('recovers the message from a non-Error object that has one — the Prisma/Neon case', () => {
    class ErrorEventLike {
      message = 'connect ECONNREFUSED 127.0.0.1:443';
      clientVersion = '6.1.0';
    }
    Object.defineProperty(ErrorEventLike, 'name', { value: 'ErrorEvent' });
    const thrown = new ErrorEventLike();

    expect(thrown instanceof Error).toBe(false);
    expect(describeError(thrown)).toContain('connect ECONNREFUSED 127.0.0.1:443');
    expect(describeError(thrown)).not.toBe('[object Object]');
  });

  it('never returns the useless "[object Object]" for a plain object', () => {
    expect(describeError({ code: 'P1001' })).toBe('{"code":"P1001"}');
    expect(describeError({})).not.toBe('[object Object]');
  });

  it('survives a circular object rather than throwing while logging an error', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
    expect(describeError(circular)).toMatch(/unserializable Object/);
  });

  it('passes strings and primitives through', () => {
    expect(describeError('already a string')).toBe('already a string');
    expect(describeError(undefined)).toBe('undefined');
    expect(describeError(null)).toBe('null');
    expect(describeError(42)).toBe('42');
  });

  it('ignores a non-string or empty message rather than logging nothing useful', () => {
    expect(describeError({ message: 123, code: 'X' })).toBe('{"message":123,"code":"X"}');
    expect(describeError({ message: '' })).not.toBe('');
  });
});
