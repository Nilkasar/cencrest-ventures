import { Hono } from 'hono';
import { checkRlsEnforcement } from '@bebest/database';
import { getPlatformDb } from '@bebest/database/platform';
import { getDefaultAiProviderRegistry } from '../../lib/ai-visibility/provider-registry.js';
import { getPaymentProvider, NullPaymentProvider } from '../../lib/billing/payment-provider.js';
import { getPublishTarget, NullPublishTarget } from '../../lib/actions/publish-target.js';
import { getDefaultJobQueue } from '../../lib/queue/default-job-queue.js';
import { InMemoryJobQueue } from '../../lib/queue/in-memory-job-queue.js';
import { getDefaultErrorTracker } from '../../lib/observability/default-error-tracker.js';
import { ConsoleErrorTracker } from '../../lib/observability/console-error-tracker.js';
import { getInternalOrgId } from '../../lib/internal-org.js';
import {
  buildCapabilities,
  CLOUD_PROVIDERS,
  type Capability,
  type CapabilityStatus,
  type CloudProvider,
  type LiveChecks,
} from '../../lib/platform/capabilities.js';
import type { AppEnv } from '../../types/context.js';
import { platformGuard } from './shared.js';

/**
 * Epic 22 Phase 1 — `GET /api/platform/capabilities` (support).
 *
 * Gathers `LiveChecks` and hands them to the pure catalog in
 * lib/platform/capabilities.ts. Works WITHOUT `PLATFORM_DATABASE_URL` (it is
 * the route that reports that gap), so its guard skips `requirePlatformDb`.
 *
 * COST CONTROL
 *  - Every network check (4 provider `healthCheck()`s — each a free
 *    `GET /models`-style call, never a completion — Ollama `/api/tags`, the
 *    RLS probe, a `SELECT 1` on the platform connection) runs concurrently,
 *    each time-boxed to CHECK_TIMEOUT_MS, so the whole gather is bounded by
 *    ~3s even when a provider hangs. A check that misses the box reports
 *    `null` ("did not answer"), never a guess.
 *  - The result is cached in-process for CACHE_TTL_MS, and concurrent
 *    requests share one in-flight gather — a dashboard refresh loop cannot
 *    turn into a stream of calls to paid providers' APIs.
 *  - Provider health goes through the same registry (`getDefaultAiProvider
 *    Registry()`) the pipelines use, provider by provider rather than via
 *    `healthCheckAll()`, only so each one can be time-boxed independently.
 */

const CHECK_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 60_000;

export interface CapabilitiesResponse {
  /** when the live checks behind this answer were taken (may be up to 60s old) */
  checkedAt: string;
  cached: boolean;
  summary: Record<CapabilityStatus, number>;
  capabilities: Capability[];
}

let cache: { at: number; checks: LiveChecks } | undefined;
let inFlight: Promise<LiveChecks> | undefined;

/** Test-only. */
export function __resetCapabilitiesCacheForTesting(): void {
  cache = undefined;
  inFlight = undefined;
}

function withTimeout<T>(promise: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise.catch(() => null as T | null), timeout]).finally(() => clearTimeout(timer));
}

async function gatherChecks(): Promise<LiveChecks> {
  const registry = getDefaultAiProviderRegistry();
  const health = (name: CloudProvider | 'ollama') =>
    withTimeout(registry.get(name).healthCheck());

  const platformConfigured = Boolean(process.env.PLATFORM_DATABASE_URL);

  const [providerHealth, ollamaHealthy, rls, platformReachable] = await Promise.all([
    Promise.all(CLOUD_PROVIDERS.map((p) => health(p))),
    health('ollama'),
    withTimeout(checkRlsEnforcement()),
    platformConfigured
      ? withTimeout(getPlatformDb().$queryRawUnsafe('SELECT 1').then(() => true))
      : Promise.resolve(null),
  ]);

  const keys: Record<CloudProvider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
  };
  const ai = Object.fromEntries(
    CLOUD_PROVIDERS.map((p, i) => [p, { configured: Boolean(keys[p]), healthy: providerHealth[i] ?? null }]),
  ) as LiveChecks['ai'];

  let crmInternalOrg = true;
  try {
    getInternalOrgId();
  } catch {
    crmInternalOrg = false;
  }

  const queue = getDefaultJobQueue();
  const tracker = getDefaultErrorTracker();

  let rlsCheck: LiveChecks['rls'];
  if (!rls) {
    rlsCheck = { enforced: null, role: null, detail: 'RLS probe did not answer within the time box' };
  } else {
    const leaked = rls.leakedRowsUnderForeignContext;
    const enforced = !rls.bypassesRls && rls.ownedTenantTables === 0 && (leaked === null || leaked === 0);
    rlsCheck = {
      enforced,
      role: rls.role,
      detail: enforced
        ? `request role "${rls.role}" cannot bypass RLS; foreign-org probe returned 0 rows`
        : `request role "${rls.role}": ${[
            rls.isSuperuser ? 'is a superuser' : null,
            rls.hasBypassRls ? 'has BYPASSRLS' : null,
            rls.ownedTenantTables > 0 ? `owns ${rls.ownedTenantTables} tenant table(s)` : null,
            leaked ? `foreign-org probe leaked ${leaked} row(s)` : null,
          ]
            .filter(Boolean)
            .join('; ')}`,
    };
  }

  return {
    ai,
    ollama: { baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434', healthy: ollamaHealthy },
    jwtKeys: Boolean(process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY),
    appUrl: Boolean(process.env.APP_URL),
    resend: Boolean(process.env.RESEND_API_KEY),
    googleOAuth: {
      clientId: Boolean(process.env.GOOGLE_CLIENT_ID),
      clientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
      stateSecret: Boolean(process.env.GOOGLE_OAUTH_STATE_SECRET),
    },
    paymentProviderIsNull: getPaymentProvider() instanceof NullPaymentProvider,
    billingWebhookSecret: Boolean(process.env.BILLING_WEBHOOK_SECRET),
    publishTargetIsNull: getPublishTarget() instanceof NullPublishTarget,
    jobQueue: queue.constructor.name,
    jobQueueDurable: !(queue instanceof InMemoryJobQueue),
    errorTracker: tracker.constructor.name,
    errorTrackerIsConsole: tracker instanceof ConsoleErrorTracker,
    rls: rlsCheck,
    crmInternalOrg,
    platformDb: { configured: platformConfigured, reachable: platformConfigured ? platformReachable : null },
  };
}

async function liveChecks(): Promise<{ checks: LiveChecks; at: number; cached: boolean }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { ...cache, cached: true };
  if (!inFlight) {
    inFlight = gatherChecks()
      .then((checks) => {
        cache = { at: Date.now(), checks };
        return checks;
      })
      .finally(() => {
        inFlight = undefined;
      });
  }
  const checks = await inFlight;
  return { checks, at: cache?.at ?? Date.now(), cached: false };
}

const capabilities = new Hono<AppEnv>();

capabilities.get('/', ...platformGuard('support', { needsDb: false }), async (c) => {
  const { checks, at, cached } = await liveChecks();
  const list = buildCapabilities(checks);
  const summary: Record<CapabilityStatus, number> = { working: 0, partial: 0, blocked: 0, stub: 0 };
  for (const cap of list) summary[cap.status] += 1;
  return c.json({
    checkedAt: new Date(at).toISOString(),
    cached,
    summary,
    capabilities: list,
  } satisfies CapabilitiesResponse);
});

export default capabilities;
