import { describe, expect, it, vi, beforeEach } from 'vitest';

// `@sentry/node` is mocked in every test in this file — this build's hard
// constraint is "no real network call to an external provider... every
// 'real' integration must follow the same NullXProvider/interface
// discipline". These tests verify `SentryErrorTracker` drives the real
// `@sentry/node` API correctly WITHOUT ever opening a real connection to
// Sentry — the mock below stands in for what `Sentry.init()` would
// otherwise do.
const { mockScope, mockSentry } = vi.hoisted(() => {
  const mockScope = { setTag: vi.fn(), setUser: vi.fn() };
  return {
    mockScope,
    mockSentry: {
      init: vi.fn(),
      withScope: vi.fn((cb: (scope: typeof mockScope) => void) => cb(mockScope)),
      captureException: vi.fn(),
    },
  };
});
vi.mock('@sentry/node', () => mockSentry);

import { SentryErrorTracker } from './sentry-error-tracker.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SentryErrorTracker — construction never connects', () => {
  it('constructing the class does not call Sentry.init', () => {
    new SentryErrorTracker('https://examplePublicKey@o0.ingest.sentry.io/0');
    expect(mockSentry.init).not.toHaveBeenCalled();
  });

  it('captureException before init() is a silent no-op, never throws', () => {
    const tracker = new SentryErrorTracker('https://key@o0.ingest.sentry.io/0');
    expect(() => tracker.captureException(new Error('boom'))).not.toThrow();
    expect(mockSentry.captureException).not.toHaveBeenCalled();
    expect(mockSentry.withScope).not.toHaveBeenCalled();
  });
});

describe('SentryErrorTracker — init()', () => {
  it('calls Sentry.init with the given DSN, sendDefaultPii disabled, and the real NODE_ENV', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const tracker = new SentryErrorTracker('https://key@o0.ingest.sentry.io/0');
    tracker.init();

    expect(mockSentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@o0.ingest.sentry.io/0', environment: 'production', sendDefaultPii: false }),
    );
    process.env.NODE_ENV = originalEnv;
  });
});

describe('SentryErrorTracker — captureException() after init()', () => {
  it('tags the scope with only the allowlisted identifiers, then captures the exception', () => {
    const tracker = new SentryErrorTracker('https://key@o0.ingest.sentry.io/0');
    tracker.init();

    const err = new Error('boom');
    tracker.captureException(err, {
      requestId: 'req-1',
      method: 'GET',
      path: '/api/brands/me',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(mockScope.setTag).toHaveBeenCalledWith('request_id', 'req-1');
    expect(mockScope.setTag).toHaveBeenCalledWith('http.method', 'GET');
    expect(mockScope.setTag).toHaveBeenCalledWith('http.path', '/api/brands/me');
    expect(mockScope.setTag).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(mockScope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
    expect(mockSentry.captureException).toHaveBeenCalledWith(err);
  });

  it('skips tags for fields not present in the context, never passing undefined through', () => {
    const tracker = new SentryErrorTracker('https://key@o0.ingest.sentry.io/0');
    tracker.init();

    tracker.captureException(new Error('boom'), { requestId: 'req-1' });

    expect(mockScope.setTag).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith('request_id', 'req-1');
    expect(mockScope.setUser).not.toHaveBeenCalled();
  });

  it('never throws, even with no context given at all', () => {
    const tracker = new SentryErrorTracker('https://key@o0.ingest.sentry.io/0');
    tracker.init();
    expect(() => tracker.captureException(new Error('boom'))).not.toThrow();
    expect(mockSentry.captureException).toHaveBeenCalled();
  });
});
