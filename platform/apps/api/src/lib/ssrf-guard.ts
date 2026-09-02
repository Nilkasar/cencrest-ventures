/**
 * SSRF guard for URL-shaped inputs.
 *
 * Two layers live in this one file, deliberately not split across two
 * "SSRF implementations" (Epic 3's brief is explicit: this must be the
 * ONLY code path that makes outbound requests to a customer-supplied URL,
 * extended from here, never duplicated):
 *
 *   1. `isSafePublicHttpUrl` (below) — write-boundary hygiene, built for
 *      Epic 1. Applied to every URL field the CRM accepts (`leads.website`,
 *      `leads.source_url`). Rejects non-http(s) schemes and the obvious
 *      literal-IP forms of loopback/private/link-local addresses, but does
 *      NOT resolve hostnames — a hostname that only later resolves to a
 *      private IP (DNS rebinding) is not caught here. This is intentional:
 *      nothing in Epic 1 makes an outbound request to a stored lead URL, so
 *      this function only ever needs to protect against what gets STORED
 *      and later rendered, not what gets FETCHED.
 *
 *   2. `safeFetch` (below `isSafePublicHttpUrl`) — the real request-time
 *      guard, built for Epic 3's crawler. This is the ONLY function in the
 *      codebase allowed to open a socket to a customer-supplied URL: it
 *      resolves DNS itself, validates every resolved address against the
 *      full IP-range blocklist (closing the DNS-rebinding gap
 *      `isSafePublicHttpUrl` explicitly does not attempt), re-validates
 *      every redirect hop the same way, and enforces the page-size cap.
 *      Route/service code must call `safeFetch`, never `fetch` directly,
 *      for any URL a customer supplied (brand website, competitor website,
 *      sitemap URL, a discovered link). `src/lib/crawler/engine.ts` is the
 *      only caller today.
 */

const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./, // 127.0.0.0/8
  /^0\.0\.0\.0$/,
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16 (link-local, incl. cloud metadata endpoints)
  /^\[?::1\]?$/, // IPv6 loopback
  /^\[?fc00:/i, // IPv6 unique local
  /^\[?fe80:/i, // IPv6 link-local
];

export function isSafePublicHttpUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(url.hostname))) return false;

  return true;
}

// ============================================================================
// safeFetch — Epic 3 (Website Intelligence) request-time SSRF guard
// ============================================================================

import { lookup as dnsLookup } from 'node:dns/promises';

/** Hostname suffixes/literals treated as internal per
 * docs/epics/03-website-intelligence.md's explicit list, independent of
 * whatever IP they might resolve to. */
const INTERNAL_HOSTNAME_SUFFIXES = ['.internal', '.local'];

function looksLikeInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;
  return INTERNAL_HOSTNAME_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

// ---- IPv4 range check ------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/** [network, prefix length] pairs, all in canonical dotted-quad form for
 * readability. Covers every range docs/epics/03-website-intelligence.md
 * names explicitly (RFC1918 private, loopback, link-local/cloud-metadata)
 * plus the other IANA special-purpose ranges (RFC 6890) a thorough SSRF
 * guard should also reject — carrier-grade NAT, documentation/benchmark
 * ranges, multicast, and reserved/broadcast space. None of these are
 * legitimate destinations for a "crawl this customer's public website"
 * request. */
const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // carrier-grade NAT (RFC 6598)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. 169.254.169.254 cloud metadata
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1 (documentation)
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2 (documentation)
  ['203.0.113.0', 24], // TEST-NET-3 (documentation)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + 255.255.255.255 broadcast
];

function ipv4InCidr(ipInt: number, cidr: [string, number]): boolean {
  const [base, prefix] = cidr;
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // unparseable "IPv4" — fail closed
  return BLOCKED_IPV4_CIDRS.some((cidr) => ipv4InCidr(ipInt, cidr));
}

// ---- IPv6 range check -------------------------------------------------------

/** Expands an IPv6 address (optionally with a trailing embedded-IPv4 tail,
 * e.g. `::ffff:127.0.0.1`) into 8 uint16 groups, or `null` if unparseable.
 * Deliberately hand-rolled rather than pulled from a dependency — this is
 * the one function in the codebase that MUST get address parsing right, so
 * it stays small and auditable rather than trusting a transitive package. */
function parseIpv6Groups(input: string): number[] | null {
  let addr = input.replace(/^\[|\]$/g, '');

  // Embedded IPv4 tail (e.g. "::ffff:192.168.1.1") — replace the dotted-quad
  // with two hex groups so the rest of this function only ever deals with
  // colon-separated hextets.
  const ipv4TailMatch = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (ipv4TailMatch) {
    const v4Int = ipv4ToInt(ipv4TailMatch[1]!);
    if (v4Int === null) return null;
    const hi = ((v4Int >>> 16) & 0xffff).toString(16);
    const lo = (v4Int & 0xffff).toString(16);
    addr = addr.slice(0, addr.length - ipv4TailMatch[1]!.length) + `${hi}:${lo}`;
  }

  if (addr.split('::').length > 2) return null; // "::" can appear at most once

  const [head, tail] = addr.split('::');
  const headParts = head ? head.split(':').filter((p) => p.length > 0) : [];
  const tailParts = tail ? tail.split(':').filter((p) => p.length > 0) : [];

  let groups: string[];
  if (addr.includes('::')) {
    const missing = 8 - (headParts.length + tailParts.length);
    if (missing < 0) return null;
    groups = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  } else {
    groups = addr.split(':');
  }

  if (groups.length !== 8) return null;
  const parsed = groups.map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (parsed.some((n) => Number.isNaN(n))) return null;
  return parsed;
}

function isBlockedIpv6(ip: string): boolean {
  const g = parseIpv6Groups(ip);
  if (g === null) return true; // unparseable — fail closed
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];

  const isZero = (n: number) => n === 0;
  if ([g0, g1, g2, g3, g4, g5, g6].every(isZero) && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    // IPv4-mapped (::ffff:a.b.c.d/96) — unwrap and re-check as IPv4. This is
    // the classic bypass this parser exists specifically to close.
    const v4 = `${(g6 >>> 8) & 0xff}.${g6 & 0xff}.${(g7 >>> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(v4);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  return false;
}

export function isBlockedIpAddress(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

// ---- safeFetch ---------------------------------------------------------------

export class SsrfBlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`Blocked outbound request to "${url}": ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

export class PageTooLargeError extends Error {
  constructor(
    public readonly url: string,
    public readonly maxBytes: number,
  ) {
    super(`Response body for "${url}" exceeded the ${maxBytes}-byte limit`);
    this.name = 'PageTooLargeError';
  }
}

/** Dependency-injectable fetch signature — same pattern as
 * `@bebest/ai-provider`'s `FetchLike`, so `safeFetch` (and every caller of
 * it) can be unit tested with a hand-rolled mock instead of hitting the
 * network. Defaults to the global `fetch` at call time. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Dependency-injectable DNS resolver, matching the shape of
 * `dns.promises.lookup(host, { all: true })`. Injectable for the exact same
 * reason as `FetchLike`: the SSRF test suite needs to simulate "this
 * hostname resolves to 169.254.169.254" without a real DNS server. */
export type DnsResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

async function defaultResolve(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export interface SafeFetchOptions {
  fetchImpl?: FetchLike;
  resolveImpl?: DnsResolver;
  /** RequestInit passed through to the underlying fetch (method, headers).
   * `redirect` is always forced to `'manual'` — safeFetch handles redirects
   * itself so each hop gets re-validated. `signal` is always overridden by
   * this function's own timeout. */
  init?: Omit<RequestInit, 'redirect' | 'signal'>;
  /** Default 5MB, per docs/epics/03-website-intelligence.md's crawl limits. */
  maxBytes?: number;
  /** Default 5. */
  maxRedirects?: number;
  /** Default 15000ms. */
  timeoutMs?: number;
}

export interface SafeFetchResult {
  /** The URL actually fetched — may differ from the input after redirects. */
  finalUrl: string;
  status: number;
  headers: Headers;
  /** Body text, truncated to at most `maxBytes` (already enforced while
   * streaming, not just checked after the fact — see the read loop below). */
  body: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Validates a single URL's scheme + hostname + (after resolving DNS) every
 * resolved IP, WITHOUT making any HTTP request. Exported separately from
 * `safeFetch` so the crawl engine can pre-flight a discovered link (e.g. to
 * decide whether it's even worth queueing) using the identical logic the
 * real fetch will use — one blocklist, checked the same way everywhere. */
export async function assertSafeToFetch(rawUrl: string, resolveImpl: DnsResolver = defaultResolve): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, 'not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(rawUrl, `unsupported scheme "${url.protocol}"`);
  }

  if (looksLikeInternalHostname(url.hostname)) {
    throw new SsrfBlockedError(rawUrl, `internal hostname "${url.hostname}"`);
  }

  // A bracketed IPv6 literal or bare IPv4 literal in the hostname — checked
  // directly, no DNS round-trip needed (and dns.lookup on a literal IP just
  // returns that same literal, so this isn't skipping a check, only
  // skipping a redundant network call).
  const literalHost = url.hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(literalHost) || literalHost.includes(':')) {
    if (isBlockedIpAddress(literalHost)) {
      throw new SsrfBlockedError(rawUrl, `literal address "${literalHost}" is in a blocked range`);
    }
    return url;
  }

  // Resolve-then-validate (DNS-rebinding protection): the hostname itself
  // can look completely innocuous while resolving to a private/metadata
  // address, so EVERY resolved address must be checked, not just the first.
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolveImpl(url.hostname);
  } catch (err) {
    throw new SsrfBlockedError(rawUrl, `DNS resolution failed: ${(err as Error).message}`);
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(rawUrl, 'DNS resolution returned no addresses');
  }

  for (const { address } of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new SsrfBlockedError(rawUrl, `hostname resolves to blocked address "${address}"`);
    }
  }

  return url;
}

/**
 * The ONE function in this codebase allowed to make an outbound HTTP
 * request to a customer-supplied URL. Every check below runs BEFORE the
 * injected `fetchImpl` is ever called — a blocked URL never reaches the
 * network layer at all, which is exactly what the Epic 3 security test
 * suite asserts (mock `fetchImpl`, confirm it was never invoked).
 *
 * Redirects are followed manually (`redirect: 'manual'` on the underlying
 * fetch) and every hop is re-validated through this same
 * scheme/hostname/DNS-resolve pipeline — a redirect to a private address is
 * exactly as dangerous as the original URL being one, and is a well-known
 * bypass of guards that only check the URL the caller typed.
 *
 * The response body is read as a capped stream: `maxBytes` is enforced
 * while reading, not just checked against a (spoofable, sometimes absent)
 * `Content-Length` header after the fact.
 *
 * Known residual gap (documented, not silently accepted — see
 * docs/epics/03-website-intelligence-backend.md): this validates the
 * resolved IP and then asks `fetchImpl` to fetch the URL by HOSTNAME again,
 * not by the exact validated IP. A DNS server with a sub-second TTL could
 * theoretically flip the answer between the check and the connect
 * (TOCTOU). Closing that completely requires pinning the TCP connection to
 * the validated IP while still sending the original Host/SNI — which needs
 * a custom `undici`/`http.Agent` dispatcher below the `fetch()` abstraction,
 * not the dependency-injected `FetchLike` shape this task's own testing
 * constraint (mock `fetchImpl`, no real network) is built around. Flagged
 * as a follow-up hardening item, not implemented here.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveImpl = options.resolveImpl ?? defaultResolve;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let currentUrl = rawUrl;

  for (let redirectCount = 0; ; redirectCount++) {
    if (redirectCount > maxRedirects) {
      throw new SsrfBlockedError(rawUrl, `exceeded ${maxRedirects} redirects`);
    }

    const validated = await assertSafeToFetch(currentUrl, resolveImpl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(validated.toString(), {
        ...options.init,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // Manual redirect handling — every hop re-runs assertSafeToFetch above.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new SsrfBlockedError(currentUrl, `redirect (${res.status}) had no Location header`);
      }
      currentUrl = new URL(location, validated).toString();
      continue;
    }

    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
      throw new PageTooLargeError(validated.toString(), maxBytes);
    }

    const body = await readBodyCapped(res, validated.toString(), maxBytes);

    return { finalUrl: validated.toString(), status: res.status, headers: res.headers, body };
  }
}

/** Reads a Response body up to `maxBytes`, throwing `PageTooLargeError`
 * rather than buffering an unbounded (or Content-Length-lying) response.
 * Falls back to `res.text()` when the injected mock Response has no
 * `.body` stream (a plain `new Response(string)` in a test still exposes
 * one in Node 22, but this keeps the function tolerant of leaner mocks). */
async function readBodyCapped(res: Response, url: string, maxBytes: number): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new PageTooLargeError(url, maxBytes);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PageTooLargeError(url, maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}
