import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const checkRateLimitMock = vi.fn();

vi.mock('../lib/rate-limiter.js', () => ({
  checkRateLimit: checkRateLimitMock,
}));

describe('rateLimit middleware', () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset();
  });

  it('passes the request through and sets headers when allowed', async () => {
    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 29,
      limit: 30,
      resetAt: 1_700_000_060,
    });
    const { rateLimit } = await import('./rate-limit.js');

    const app = new Hono();
    app.get('/', rateLimit({ bucket: 'public', max: 30, windowSeconds: 60 }), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('29');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('30');
  });

  it('returns 429 with Retry-After when the limit is exceeded', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 42;
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 5, resetAt });
    const { rateLimit } = await import('./rate-limit.js');

    const app = new Hono();
    app.get('/', rateLimit({ bucket: 'auth', max: 5, windowSeconds: 900 }), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).not.toBeNull();
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Too many requests');
  });

  it('derives the key from the client IP by default', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, limit: 1, resetAt: 0 });
    const { rateLimit } = await import('./rate-limit.js');

    const app = new Hono();
    app.get('/', rateLimit({ bucket: 'free_snapshot', max: 1, windowSeconds: 3600 }), (c) =>
      c.json({ ok: true }),
    );

    await app.request('/', { headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: '9.9.9.9', bucket: 'free_snapshot' }),
    );
  });
});
