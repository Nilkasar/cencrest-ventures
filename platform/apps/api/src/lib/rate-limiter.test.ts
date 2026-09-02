import { describe, expect, it, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn();

vi.mock('@bebest/database', () => ({
  db: {
    organization_rate_limits: {
      upsert: upsertMock,
    },
  },
}));

describe('checkRateLimit', () => {
  beforeEach(() => {
    upsertMock.mockReset();
  });

  it('allows the request when the count is within the limit', async () => {
    upsertMock.mockResolvedValue({ count: 3 });
    const { checkRateLimit } = await import('./rate-limiter.js');

    const result = await checkRateLimit({
      bucket: 'auth',
      key: '1.2.3.4',
      max: 5,
      windowSeconds: 900,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.limit).toBe(5);
  });

  it('blocks the request once the count exceeds the limit', async () => {
    upsertMock.mockResolvedValue({ count: 6 });
    const { checkRateLimit } = await import('./rate-limiter.js');

    const result = await checkRateLimit({
      bucket: 'auth',
      key: '1.2.3.4',
      max: 5,
      windowSeconds: 900,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('never lets remaining go negative', async () => {
    upsertMock.mockResolvedValue({ count: 50 });
    const { checkRateLimit } = await import('./rate-limiter.js');

    const result = await checkRateLimit({
      bucket: 'auth',
      key: '1.2.3.4',
      max: 5,
      windowSeconds: 900,
    });

    expect(result.remaining).toBe(0);
  });

  it('scopes the bucket key by bucket name AND caller key, so two IPs never share a counter', async () => {
    upsertMock.mockResolvedValue({ count: 1 });
    const { checkRateLimit } = await import('./rate-limiter.js');

    await checkRateLimit({ bucket: 'auth', key: '1.1.1.1', max: 5, windowSeconds: 60 });
    await checkRateLimit({ bucket: 'auth', key: '2.2.2.2', max: 5, windowSeconds: 60 });

    const keysUsed = upsertMock.mock.calls.map(
      (call) => (call[0] as { where: { bucket_key_window_start: { bucket_key: string } } }).where
        .bucket_key_window_start.bucket_key,
    );
    expect(new Set(keysUsed).size).toBe(2);
    expect(keysUsed[0]).toContain('1.1.1.1');
    expect(keysUsed[1]).toContain('2.2.2.2');
  });

  it('quantizes window_start to the window size (fixed-window bucketing)', async () => {
    upsertMock.mockResolvedValue({ count: 1 });
    const { checkRateLimit } = await import('./rate-limiter.js');

    await checkRateLimit({ bucket: 'public', key: 'x', max: 30, windowSeconds: 60 });

    const arg = upsertMock.mock.calls[0]?.[0] as {
      where: { bucket_key_window_start: { window_start: Date } };
    };
    const windowStart = arg.where.bucket_key_window_start.window_start;
    expect(windowStart.getTime() % 60_000).toBe(0);
  });
});
