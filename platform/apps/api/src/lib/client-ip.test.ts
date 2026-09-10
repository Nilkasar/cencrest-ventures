import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { clientIp } from './client-ip.js';

async function ipFor(headers: Record<string, string>): Promise<string | null> {
  const app = new Hono();
  let seen: string | null | undefined;
  app.get('/', (c) => {
    seen = clientIp(c);
    return c.json({ ok: true });
  });
  await app.request('/', { headers });
  return seen ?? null;
}

describe('clientIp', () => {
  // The bug this replaced: the fallback was the literal string 'unknown',
  // written straight into an INET column. Postgres rejects it (22P02), and
  // because it happens inside login's session insert, every sign-in
  // returned 500 for any caller not behind a header-setting proxy.
  it('returns null — never a placeholder — when no header is present', async () => {
    await expect(ipFor({})).resolves.toBeNull();
  });

  it('takes the first entry of an X-Forwarded-For chain, not the whole list', async () => {
    // "1.2.3.4, 10.0.0.1, 10.0.0.2" is not a valid inet literal.
    await expect(ipFor({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })).resolves.toBe(
      '203.0.113.7',
    );
  });

  it('trims whitespace around the forwarded address', async () => {
    await expect(ipFor({ 'x-forwarded-for': '  203.0.113.7  ' })).resolves.toBe('203.0.113.7');
  });

  it('falls back to X-Real-IP', async () => {
    await expect(ipFor({ 'x-real-ip': '198.51.100.9' })).resolves.toBe('198.51.100.9');
  });

  it('prefers X-Forwarded-For over X-Real-IP', async () => {
    await expect(
      ipFor({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.9' }),
    ).resolves.toBe('203.0.113.7');
  });

  it('accepts IPv6', async () => {
    await expect(ipFor({ 'x-forwarded-for': '2001:db8::1' })).resolves.toBe('2001:db8::1');
  });

  it('rejects anything that is not an address rather than passing it through', async () => {
    await expect(ipFor({ 'x-forwarded-for': 'unknown' })).resolves.toBeNull();
    await expect(ipFor({ 'x-forwarded-for': 'localhost' })).resolves.toBeNull();
    await expect(ipFor({ 'x-forwarded-for': '999.1.1.1' })).resolves.toBeNull();
    await expect(ipFor({ 'x-real-ip': "'; drop table sessions; --" })).resolves.toBeNull();
  });

  it('skips a malformed first hop rather than trusting the rest of the chain', async () => {
    // The first entry is the claimed client; if it is junk, fall through to
    // X-Real-IP rather than silently attributing the request to a proxy.
    await expect(
      ipFor({ 'x-forwarded-for': 'garbage, 203.0.113.7', 'x-real-ip': '198.51.100.9' }),
    ).resolves.toBe('198.51.100.9');
  });
});
