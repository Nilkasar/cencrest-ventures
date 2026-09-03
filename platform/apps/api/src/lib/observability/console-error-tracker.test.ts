import { describe, expect, it, vi, afterEach } from 'vitest';
import { ConsoleErrorTracker } from './console-error-tracker.js';

describe('ConsoleErrorTracker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a structured-JSON line with level/requestId/msg/stack, matching app.ts\'s pre-Epic-19 onError shape', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error('boom');

    new ConsoleErrorTracker().captureException(err, { requestId: 'req-1', method: 'GET', path: '/api/brands/me' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      level: 'error',
      requestId: 'req-1',
      method: 'GET',
      path: '/api/brands/me',
      msg: 'boom',
    });
    expect(logged.stack).toContain('Error: boom');
  });

  it('handles a non-Error throw (e.g. a thrown string) without crashing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => new ConsoleErrorTracker().captureException('a raw string throw')).not.toThrow();

    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged.msg).toBe('a raw string throw');
    expect(logged.stack).toBeUndefined();
  });

  it('never includes fields outside the ErrorContext allowlist (no headers/tokens/bodies possible — the type has no such field)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    new ConsoleErrorTracker().captureException(new Error('x'), {
      requestId: 'r1',
      method: 'GET',
      path: '/api/x',
      organizationId: 'org-1',
      userId: 'user-1',
    });
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(Object.keys(logged).sort()).toEqual(
      ['level', 'method', 'msg', 'organizationId', 'path', 'requestId', 'stack', 'userId'].sort(),
    );
  });

  it('works with no context given at all', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => new ConsoleErrorTracker().captureException(new Error('no context'))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
