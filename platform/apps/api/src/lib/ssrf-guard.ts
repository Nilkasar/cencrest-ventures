/**
 * SSRF guard for URL-shaped inputs — applied to every URL field the CRM
 * accepts (`leads.website`, `leads.source_url`).
 *
 * Honest scope note: nothing in Epic 1 makes an outbound HTTP request to a
 * stored lead URL — these fields are just recorded strings, so full SSRF
 * protection (which really means: block a REQUEST from being made to a
 * private/internal address, checked at the moment of the fetch, including
 * after DNS resolution to close the DNS-rebinding gap) does not apply yet.
 * This guard is deliberately conservative, applied at the write boundary
 * anyway, for defense in depth: it rejects non-http(s) schemes (blocks
 * `javascript:`/`data:`/`file:` etc. from ever being stored and later
 * rendered as a clickable link) and rejects the obvious literal-IP forms of
 * loopback/private/link-local addresses. It does NOT resolve hostnames — a
 * hostname that only later resolves to a private IP (DNS rebinding) is not
 * caught here. Whichever future epic actually fetches one of these URLs
 * (e.g. the Epic 3 crawler) MUST apply its own request-time SSRF check
 * (resolve-then-check, with redirects re-checked too) — this function is
 * not a substitute for that.
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
