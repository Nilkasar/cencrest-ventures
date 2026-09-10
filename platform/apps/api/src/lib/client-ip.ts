/**
 * Resolving the caller's IP address for columns typed `INET`.
 *
 * Two things went wrong before this module existed, both invisible to the
 * unit suite (which mocks Prisma) and both fatal against a real Postgres:
 *
 *   1. The fallback when neither `X-Forwarded-For` nor `X-Real-IP` is
 *      present was the literal string `'unknown'`. Postgres rejects that
 *      for an `inet` column — `22P02 invalid input syntax for type inet:
 *      "unknown"` — which made `POST /auth/magic-link/verify` return 500
 *      for every caller not behind a proxy that sets those headers. That
 *      is every local/direct connection, so login was broken outright.
 *   2. `X-Forwarded-For` is a LIST ("client, proxy1, proxy2"). Passing the
 *      raw header to an `inet` column fails the same way as soon as there
 *      is more than one hop, so the header being present didn't save it
 *      either.
 *
 * `null` is the honest answer when the address isn't knowable — the column
 * is nullable precisely for that case. Never invent a placeholder that the
 * database will reject or, worse, silently store as a real-looking value.
 */
import type { Context } from 'hono';

// Deliberately permissive: this validates "could this be an inet literal",
// not "is this a routable address". Anything else is dropped rather than
// handed to Postgres. IPv4, optionally with a CIDR suffix; IPv6 in any of
// its hex-group forms, including IPv4-mapped and zone-id-free short forms.
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/;
const IPV6 = /^[0-9a-f:]+(?:\.\d{1,3}){0,3}(?:\/\d{1,3})?$/i;

function looksLikeIp(value: string): boolean {
  if (IPV4.test(value)) {
    return value
      .split('/')[0]!
      .split('.')
      .every((part) => Number(part) <= 255);
  }
  // An IPv6 literal always contains a colon; the loose pattern above would
  // otherwise accept bare digit strings.
  return value.includes(':') && IPV6.test(value);
}

/**
 * The client's IP, or `null` when it can't be determined.
 *
 * Takes the FIRST entry of `X-Forwarded-For` (the original client; later
 * entries are the proxies it passed through), falling back to `X-Real-IP`.
 * Both headers are attacker-controllable, so the value is only ever used
 * for logging/rate-limiting context, never for authorization.
 */
export function clientIp(c: Context): string | null {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && looksLikeIp(first)) return first;
  }

  const real = c.req.header('x-real-ip')?.trim();
  if (real && looksLikeIp(real)) return real;

  return null;
}
