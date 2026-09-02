import { describe, expect, it, vi } from 'vitest';
import {
  safeFetch,
  assertSafeToFetch,
  isBlockedIpAddress,
  SsrfBlockedError,
  PageTooLargeError,
  type DnsResolver,
} from './ssrf-guard.js';

/**
 * Epic 3's hard security gate: the SSRF test suite. Every network call is
 * injected (`fetchImpl`/`resolveImpl`) per docs/epics/03-website-
 * intelligence.md's own instruction ("since these tests need real network
 * behavior... verify the *logic* — the blocklist, the resolve-then-validate
 * order — from code"). Each "blocked" test also asserts `fetchImpl` was
 * NEVER called — the literal end-to-end-flow requirement: "confirm the
 * request is rejected BEFORE any socket is opened."
 */

function resolverFor(map: Record<string, Array<{ address: string; family: number }>>): DnsResolver {
  return async (hostname: string) => {
    const result = map[hostname];
    if (!result) throw new Error(`ENOTFOUND ${hostname}`);
    return result;
  };
}

function okResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, { status: init.status ?? 200, headers: init.headers });
}

describe('isBlockedIpAddress', () => {
  it('blocks RFC1918 private ranges', () => {
    expect(isBlockedIpAddress('10.1.2.3')).toBe(true);
    expect(isBlockedIpAddress('172.16.0.1')).toBe(true);
    expect(isBlockedIpAddress('172.31.255.255')).toBe(true);
    expect(isBlockedIpAddress('192.168.1.1')).toBe(true);
  });

  it('does not block a real private-looking-adjacent public address', () => {
    expect(isBlockedIpAddress('172.32.0.1')).toBe(false); // just outside 172.16.0.0/12
    expect(isBlockedIpAddress('8.8.8.8')).toBe(false);
  });

  it('blocks loopback', () => {
    expect(isBlockedIpAddress('127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('127.255.255.255')).toBe(true);
  });

  it('blocks the cloud metadata endpoint specifically', () => {
    expect(isBlockedIpAddress('169.254.169.254')).toBe(true);
  });

  it('blocks link-local generally', () => {
    expect(isBlockedIpAddress('169.254.1.1')).toBe(true);
  });

  it('blocks IPv6 loopback and unique-local/link-local', () => {
    expect(isBlockedIpAddress('::1')).toBe(true);
    expect(isBlockedIpAddress('fc00::1')).toBe(true);
    expect(isBlockedIpAddress('fe80::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 addresses that unwrap to a blocked IPv4 (bypass attempt)', () => {
    expect(isBlockedIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('does not block a real public IPv6 address', () => {
    expect(isBlockedIpAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('assertSafeToFetch', () => {
  it('rejects unparseable URLs', async () => {
    await expect(assertSafeToFetch('not a url')).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeToFetch('file:///etc/passwd')).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeToFetch('ftp://example.com')).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeToFetch('javascript:alert(1)')).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects internal hostnames (localhost, *.internal, *.local) without any DNS call', async () => {
    const resolveImpl = vi.fn();
    await expect(assertSafeToFetch('http://localhost/', resolveImpl)).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeToFetch('http://db.internal/', resolveImpl)).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeToFetch('http://printer.local/', resolveImpl)).rejects.toThrow(SsrfBlockedError);
    expect(resolveImpl).not.toHaveBeenCalled();
  });

  it('rejects a literal private IPv4 in the URL without any DNS call', async () => {
    const resolveImpl = vi.fn();
    await expect(assertSafeToFetch('http://10.0.0.5/', resolveImpl)).rejects.toThrow(SsrfBlockedError);
    expect(resolveImpl).not.toHaveBeenCalled();
  });

  it('rejects the literal cloud metadata IP', async () => {
    await expect(assertSafeToFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(SsrfBlockedError);
  });

  it('accepts a hostname that resolves to a public IP', async () => {
    const resolveImpl = resolverFor({ 'example.com': [{ address: '93.184.216.34', family: 4 }] });
    const url = await assertSafeToFetch('https://example.com/page', resolveImpl);
    expect(url.hostname).toBe('example.com');
  });

  it('DNS-rebinding: rejects a hostname that LOOKS public but resolves to a private IP', async () => {
    const resolveImpl = resolverFor({ 'evil.example.com': [{ address: '10.0.0.1', family: 4 }] });
    await expect(assertSafeToFetch('http://evil.example.com/', resolveImpl)).rejects.toThrow(SsrfBlockedError);
  });

  it('DNS-rebinding: rejects when ANY resolved address is blocked, not just the first', async () => {
    const resolveImpl = resolverFor({
      'multi.example.com': [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    });
    await expect(assertSafeToFetch('http://multi.example.com/', resolveImpl)).rejects.toThrow(SsrfBlockedError);
  });

  it('fails closed when DNS resolution errors', async () => {
    const resolveImpl: DnsResolver = async () => {
      throw new Error('DNS server unreachable');
    };
    await expect(assertSafeToFetch('http://example.com/', resolveImpl)).rejects.toThrow(SsrfBlockedError);
  });
});

describe('safeFetch', () => {
  it('never calls fetchImpl when the URL is blocked before any socket would open', async () => {
    const fetchImpl = vi.fn();
    const resolveImpl = resolverFor({ 'internal-service.example.com': [{ address: '10.1.1.1', family: 4 }] });
    await expect(safeFetch('http://internal-service.example.com/', { fetchImpl, resolveImpl })).rejects.toThrow(
      SsrfBlockedError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches a validated URL and returns the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('<html><title>Hi</title></html>'));
    const resolveImpl = resolverFor({ 'example.com': [{ address: '93.184.216.34', family: 4 }] });
    const result = await safeFetch('https://example.com/page', { fetchImpl, resolveImpl });
    expect(result.status).toBe(200);
    expect(result.body).toContain('<title>Hi</title>');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it('follows a redirect to a safe URL and re-validates the new hop', async () => {
    const resolveImpl = resolverFor({
      'old.example.com': [{ address: '93.184.216.1', family: 4 }],
      'new.example.com': [{ address: '93.184.216.2', family: 4 }],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse('', { status: 301, headers: { location: 'https://new.example.com/' } }))
      .mockResolvedValueOnce(okResponse('final page'));
    const result = await safeFetch('https://old.example.com/', { fetchImpl, resolveImpl });
    expect(result.finalUrl).toBe('https://new.example.com/');
    expect(result.body).toBe('final page');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect to a private address (SSRF via redirect)', async () => {
    const resolveImpl = resolverFor({ 'redirector.example.com': [{ address: '93.184.216.1', family: 4 }] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
      );
    await expect(safeFetch('https://redirector.example.com/', { fetchImpl, resolveImpl })).rejects.toThrow(
      SsrfBlockedError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never followed to the blocked hop
  });

  it('gives up after too many redirects', async () => {
    const resolveImpl = resolverFor({ 'loop.example.com': [{ address: '93.184.216.1', family: 4 }] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse('', { status: 302, headers: { location: 'https://loop.example.com/' } }));
    await expect(
      safeFetch('https://loop.example.com/', { fetchImpl, resolveImpl, maxRedirects: 2 }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects a response over the byte cap even when Content-Length is absent (streamed enforcement)', async () => {
    const resolveImpl = resolverFor({ 'big.example.com': [{ address: '93.184.216.1', family: 4 }] });
    const bigBody = 'x'.repeat(1000);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(bigBody));
    await expect(
      safeFetch('https://big.example.com/', { fetchImpl, resolveImpl, maxBytes: 10 }),
    ).rejects.toThrow(PageTooLargeError);
  });

  it('rejects up front via Content-Length when it already exceeds the cap', async () => {
    const resolveImpl = resolverFor({ 'big2.example.com': [{ address: '93.184.216.1', family: 4 }] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse('short', { headers: { 'content-length': '999999999' } }));
    await expect(
      safeFetch('https://big2.example.com/', { fetchImpl, resolveImpl, maxBytes: 10 }),
    ).rejects.toThrow(PageTooLargeError);
  });

  it('times out a hung request', async () => {
    const resolveImpl = resolverFor({ 'slow.example.com': [{ address: '93.184.216.1', family: 4 }] });
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    await expect(
      safeFetch('https://slow.example.com/', { fetchImpl, resolveImpl, timeoutMs: 5 }),
    ).rejects.toThrow();
  });
});
