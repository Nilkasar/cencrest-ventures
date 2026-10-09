import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const checkRateLimit = vi.fn();
vi.mock('../rate-limiter.js', () => ({ checkRateLimit }));

const ORIGINAL_DAILY_MAX = process.env.FREE_SNAPSHOT_DAILY_MAX;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FREE_SNAPSHOT_DAILY_MAX;
});

afterEach(() => {
  if (ORIGINAL_DAILY_MAX === undefined) delete process.env.FREE_SNAPSHOT_DAILY_MAX;
  else process.env.FREE_SNAPSHOT_DAILY_MAX = ORIGINAL_DAILY_MAX;
});

function allow(limit: number) {
  return { allowed: true, remaining: limit - 1, limit, resetAt: 2_000_000_000 };
}
function deny(limit: number) {
  return { allowed: false, remaining: 0, limit, resetAt: 2_000_000_000 };
}

describe('normalizeSnapshotDomain', () => {
  it('collapses case, a trailing dot, and a leading www. onto one bucket', async () => {
    const { normalizeSnapshotDomain } = await import('./abuse-caps.js');
    expect(normalizeSnapshotDomain('WWW.Example.COM.')).toBe('example.com');
    expect(normalizeSnapshotDomain(' example.com ')).toBe('example.com');
  });

  it('does NOT collapse distinct subdomains — they are genuinely different sites', async () => {
    const { normalizeSnapshotDomain } = await import('./abuse-caps.js');
    expect(normalizeSnapshotDomain('a.example.com')).toBe('a.example.com');
    expect(normalizeSnapshotDomain('b.example.com')).toBe('b.example.com');
  });
});

describe('freeSnapshotDailyMax', () => {
  it('defaults to the documented ceiling when unset', async () => {
    const { freeSnapshotDailyMax, DEFAULT_FREE_SNAPSHOT_DAILY_MAX } = await import('./abuse-caps.js');
    expect(freeSnapshotDailyMax()).toBe(DEFAULT_FREE_SNAPSHOT_DAILY_MAX);
  });

  it('reads a valid override', async () => {
    process.env.FREE_SNAPSHOT_DAILY_MAX = '25';
    const { freeSnapshotDailyMax } = await import('./abuse-caps.js');
    expect(freeSnapshotDailyMax()).toBe(25);
  });

  it('a malformed override falls back to the default, never to unlimited', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.FREE_SNAPSHOT_DAILY_MAX = 'lots';
    const { freeSnapshotDailyMax, DEFAULT_FREE_SNAPSHOT_DAILY_MAX } = await import('./abuse-caps.js');
    expect(freeSnapshotDailyMax()).toBe(DEFAULT_FREE_SNAPSHOT_DAILY_MAX);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('checkFreeSnapshotAbuseCaps', () => {
  it('allows a first-time domain within the global ceiling, using the SHARED rate limiter', async () => {
    checkRateLimit.mockResolvedValueOnce(allow(1)).mockResolvedValueOnce(allow(100));
    const { checkFreeSnapshotAbuseCaps } = await import('./abuse-caps.js');

    await expect(checkFreeSnapshotAbuseCaps('example.com')).resolves.toEqual({ allowed: true });

    expect(checkRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'free_snapshot_domain',
      key: 'example.com',
      max: 1,
      windowSeconds: 7 * 24 * 60 * 60,
    });
    expect(checkRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'free_snapshot_global',
      key: 'all',
      max: 100,
      windowSeconds: 24 * 60 * 60,
    });
  });

  it('REFUSES a second snapshot for the same domain inside the window', async () => {
    checkRateLimit.mockResolvedValueOnce(deny(1));
    const { checkFreeSnapshotAbuseCaps } = await import('./abuse-caps.js');

    const result = await checkFreeSnapshotAbuseCaps('example.com', new Date(1_999_999_000 * 1000));

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.cap).toBe('domain');
    expect(result.error).toBe('snapshot_already_requested_for_domain');
    expect(result.retryAfter).toBe(1000);
    // The public refusal must not confirm who requested it or when exactly.
    expect(result.message).not.toMatch(/@/);
  });

  it('the same site submitted as www. and bare shares ONE domain slot', async () => {
    checkRateLimit.mockResolvedValue(allow(1));
    const { checkFreeSnapshotAbuseCaps } = await import('./abuse-caps.js');

    await checkFreeSnapshotAbuseCaps('www.Example.com');

    expect(checkRateLimit).toHaveBeenNthCalledWith(1, expect.objectContaining({ key: 'example.com' }));
  });

  it('does NOT consume the global budget when the domain cap already refused — the cheap attack costs nothing', async () => {
    checkRateLimit.mockResolvedValueOnce(deny(1));
    const { checkFreeSnapshotAbuseCaps } = await import('./abuse-caps.js');

    await checkFreeSnapshotAbuseCaps('example.com');

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).not.toHaveBeenCalledWith(expect.objectContaining({ bucket: 'free_snapshot_global' }));
  });

  it('REFUSES once the platform-wide daily ceiling is reached, even for a brand-new domain', async () => {
    checkRateLimit.mockResolvedValueOnce(allow(1)).mockResolvedValueOnce(deny(100));
    const { checkFreeSnapshotAbuseCaps } = await import('./abuse-caps.js');

    const result = await checkFreeSnapshotAbuseCaps('brand-new-domain.com');

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.cap).toBe('global');
    expect(result.error).toBe('free_snapshot_capacity_reached');
    expect(result.limit).toBe(100);
  });

  it('honours a lowered FREE_SNAPSHOT_DAILY_MAX', async () => {
    process.env.FREE_SNAPSHOT_DAILY_MAX = '3';
    checkRateLimit.mockResolvedValueOnce(allow(1)).mockResolvedValueOnce(allow(3));
    const { checkFreeSnapshotAbuseCaps } = await import('./abuse-caps.js');

    await checkFreeSnapshotAbuseCaps('example.com');

    expect(checkRateLimit).toHaveBeenNthCalledWith(2, expect.objectContaining({ max: 3 }));
  });

  it('PROPAGATES a rate-limiter store failure — a cap that passes when its store is down is not a cap', async () => {
    checkRateLimit.mockRejectedValue(new Error('connection refused'));
    const { checkFreeSnapshotAbuseCaps } = await import('./abuse-caps.js');
    await expect(checkFreeSnapshotAbuseCaps('example.com')).rejects.toThrow('connection refused');
  });
});
