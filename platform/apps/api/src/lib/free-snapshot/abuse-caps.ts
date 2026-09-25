/**
 * FREE-SNAPSHOT ABUSE CAPS — the free snapshot spends real vendor money per
 * lead with no card on file: 20-50 queries x 4 cloud assistants x 2 calls
 * each, attributed to BeBest's own internal org (`lib/ai-usage/attribution.ts`),
 * i.e. straight off our margin. `routes/snapshot.ts` already rate-limits 1
 * request per IP per hour, which a scripted attacker defeats with a proxy
 * pool; the per-page/per-query caps bound one snapshot's size but not how
 * many snapshots exist.
 *
 * Two caps are added here, both on the SAME mechanism the rest of the
 * platform uses (`lib/rate-limiter.ts`'s Postgres-backed fixed-window
 * counter) rather than a second, parallel one:
 *
 *   1. PER DOMAIN. One snapshot per domain per rolling week. Re-submitting
 *      the same site from a hundred IPs buys nothing, and a legitimate lead
 *      has no reason to need a second report on the same domain within days.
 *      The domain is the thing the money is spent on, so it is the right key
 *      — the email and the IP are both free to change.
 *
 *   2. GLOBAL DAILY CEILING. A hard platform-wide bound on how many free
 *      snapshots run in a day, so the worst case for a distributed attack
 *      (many domains, many IPs) is a known, bounded number instead of an
 *      unbounded model bill. This is the cap that actually limits blast
 *      radius; the per-domain one only raises the cost of the cheap attack.
 *
 * ORDER MATTERS AND IS DELIBERATE: the domain cap is checked FIRST. The
 * limiter increments on check, so whichever cap is checked first consumes a
 * slot even when a later one refuses. Domain-first means a scripted attacker
 * hammering one domain burns only that domain's slot and never touches the
 * global budget; the cost is that a legitimate request refused by the global
 * ceiling has burned its domain slot for the window. One lead delayed beats a
 * drained global budget.
 *
 * `organization_rate_limits` is intentionally NOT under RLS (see that table's
 * comment) because these checks run pre-auth, with no tenant context — which
 * is exactly the case here: the lead has no `organizations` row at all.
 *
 * FIXED-WINDOW CAVEAT, inherited and accepted: windows are aligned to epoch
 * boundaries, not truly sliding, so up to ~2x a cap can pass across a
 * boundary (2 snapshots for one domain, or ~2 days' worth of the daily
 * ceiling in a 48-hour straddle). That is the documented trade-off in
 * `lib/rate-limiter.ts`; for an abuse bound, a factor of two is acceptable
 * and a sliding-window log is not worth an unbounded timestamp table.
 */
import { checkRateLimit } from '../rate-limiter.js';

/** One per domain per 7 days. */
export const FREE_SNAPSHOT_DOMAIN_MAX = 1;
export const FREE_SNAPSHOT_DOMAIN_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/** Platform-wide snapshots per day. Deliberately an operational safety valve,
 * not a plan entitlement: it protects BeBest's own bill, belongs to no
 * customer, and must be tunable without a migration or a re-seed — so it is
 * env-configurable rather than living in `plans.limits` (which is
 * per-subscriber data and has no "BeBest itself" row).
 *
 * At ~$0.50-2 of model spend per free snapshot, 100/day bounds the worst case
 * to roughly $50-200/day. */
export const DEFAULT_FREE_SNAPSHOT_DAILY_MAX = 100;
export const FREE_SNAPSHOT_GLOBAL_WINDOW_SECONDS = 24 * 60 * 60;

/** The single bucket key every global-ceiling check shares — a constant, not
 * a per-caller value, which is the whole point: one counter for the platform. */
const GLOBAL_KEY = 'all';

export function freeSnapshotDailyMax(): number {
  const raw = process.env.FREE_SNAPSHOT_DAILY_MAX;
  if (raw === undefined || raw.trim() === '') return DEFAULT_FREE_SNAPSHOT_DAILY_MAX;
  const parsed = Number(raw);
  // A malformed value falls back to the default rather than to "unlimited" —
  // a typo in an env var must not disable a spend cap.
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'free_snapshot_daily_max_invalid',
        value: raw,
        hint: `FREE_SNAPSHOT_DAILY_MAX must be a non-negative integer; falling back to ${DEFAULT_FREE_SNAPSHOT_DAILY_MAX}`,
      }),
    );
    return DEFAULT_FREE_SNAPSHOT_DAILY_MAX;
  }
  return parsed;
}

/**
 * Normalizes a hostname to the thing we are actually willing to pay to
 * analyze once. Lowercased (DNS is case-insensitive, so `EXAMPLE.com` and
 * `example.com` must share a slot), trailing dot dropped, and a leading
 * `www.` stripped — `www.example.com` and `example.com` are the same site and
 * must not each get a free snapshot.
 *
 * NOT a public-suffix-aware registrable-domain reduction: `a.example.com` and
 * `b.example.com` legitimately are different sites, and collapsing them would
 * refuse real leads. A subdomain-enumerating attacker is bounded by the global
 * daily ceiling instead, which is the cap built for exactly that case.
 */
export function normalizeSnapshotDomain(domain: string): string {
  let d = domain.trim().toLowerCase();
  if (d.endsWith('.')) d = d.slice(0, -1);
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

export type FreeSnapshotCapRefusal = {
  allowed: false;
  cap: 'domain' | 'global';
  error: string;
  message: string;
  retryAfter: number;
  limit: number;
  resetAt: number;
};

export type FreeSnapshotCapResult = { allowed: true } | FreeSnapshotCapRefusal;

function retryAfterFrom(resetAt: number, now: Date): number {
  return Math.max(0, resetAt - Math.floor(now.getTime() / 1000));
}

/**
 * Runs both caps. Returns a refusal the route turns into a 429; never throws
 * for a refusal (a refusal is a normal outcome, not an error). A database
 * failure inside `checkRateLimit` DOES propagate: an abuse cap that silently
 * passes when its store is unreachable is not a cap.
 */
export async function checkFreeSnapshotAbuseCaps(domain: string, now: Date = new Date()): Promise<FreeSnapshotCapResult> {
  const normalized = normalizeSnapshotDomain(domain);

  const perDomain = await checkRateLimit({
    bucket: 'free_snapshot_domain',
    key: normalized,
    max: FREE_SNAPSHOT_DOMAIN_MAX,
    windowSeconds: FREE_SNAPSHOT_DOMAIN_WINDOW_SECONDS,
  });

  if (!perDomain.allowed) {
    return {
      allowed: false,
      cap: 'domain',
      error: 'snapshot_already_requested_for_domain',
      // No detail about WHO requested it — this is a public, unauthenticated
      // endpoint, and confirming "someone already snapshotted this domain and
      // here is when" is a small information leak about our customer base.
      message:
        'A free snapshot has already been requested for this domain recently. Contact us if you need another one sooner.',
      retryAfter: retryAfterFrom(perDomain.resetAt, now),
      limit: perDomain.limit,
      resetAt: perDomain.resetAt,
    };
  }

  const dailyMax = freeSnapshotDailyMax();
  const global = await checkRateLimit({
    bucket: 'free_snapshot_global',
    key: GLOBAL_KEY,
    max: dailyMax,
    windowSeconds: FREE_SNAPSHOT_GLOBAL_WINDOW_SECONDS,
  });

  if (!global.allowed) {
    return {
      allowed: false,
      cap: 'global',
      error: 'free_snapshot_capacity_reached',
      message: "We've reached today's free snapshot capacity. Please try again tomorrow, or contact us to be scheduled.",
      retryAfter: retryAfterFrom(global.resetAt, now),
      limit: global.limit,
      resetAt: global.resetAt,
    };
  }

  return { allowed: true };
}
