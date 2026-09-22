/**
 * Integration routes — Google OAuth connect/callback, disconnect, stats, and
 * the legacy mock connect path retained for backward compatibility.
 *
 * OAuth flow (new):
 *   1. `GET /integrations/:provider/authorize` — returns a Google consent URL.
 *   2. Google redirects to `GET /integrations/google/callback` — exchanges code,
 *      discovers siteUrl/propertyId, upserts the `integrations` row.
 *
 * The callback is PUBLIC (no `requireAuth`) — it is the OAuth redirect target
 * and must be accessible without a Bearer token. It is mounted in `app.ts`
 * at the same `/api/integrations` base as the authenticated routes; `app.ts`
 * must ensure the public `publicRateLimit` already applied at `*` is the only
 * middleware that runs before this handler.
 *
 * `config_enc` fields written here: `{ accessToken, refreshToken, expiresAt,
 * scope, siteUrl? (gsc), propertyId? (ga4) }`. Never returned in any
 * response or log line.
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { withOrgContext, type integration_type } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import {
  generateAuthUrl,
  verifyState,
  exchangeCode,
  refreshAccessToken,
  type OAuthProvider,
} from '../lib/google-oauth.js';
import { GoogleSearchConsoleProvider } from '../lib/seo/google-search-console-provider.js';
import { GoogleAnalyticsProvider, listGA4Properties } from '../lib/analytics/google-analytics-provider.js';
import { getGSCStats } from '../lib/analytics/gsc-stats.js';
import type { AppEnv } from '../types/context.js';

const integrationsRoute = new Hono<AppEnv>();

const MANAGE = 'manage_integrations' as const;

const PROVIDER_SLUGS: Record<string, integration_type> = {
  google_search_console: 'gsc',
  google_analytics_4: 'ga4',
};

const SLUG_FOR_TYPE: Partial<Record<integration_type, string>> = {
  gsc: 'google_search_console',
  ga4: 'google_analytics_4',
};

function slugForType(type: integration_type): string {
  return SLUG_FOR_TYPE[type] ?? type;
}

function serializeIntegration(row: {
  id: string;
  integration_type: integration_type;
  status: string;
  connected_at: Date | null;
  disconnected_at: Date | null;
  last_synced_at: Date | null;
}) {
  return {
    id: row.id,
    provider: slugForType(row.integration_type),
    status: row.status,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    lastSyncedAt: row.last_synced_at,
  };
}

function getRedirectUri(): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }
  if (process.env.NODE_ENV !== 'production') {
    return `http://localhost:3001/api/integrations/google/callback`;
  }
  // Fallback for production — prefer GOOGLE_OAUTH_REDIRECT_URI env var so
  // preview deployments and custom domains don't produce redirect_uri mismatch.
  return `https://bebest-api.vercel.app/api/integrations/google/callback`;
}

function getAppUrl(): string {
  return process.env.APP_URL ?? 'https://app.bebestwithai.com';
}

// ── GET /integrations — list this org's connections ──────────────────────────
integrationsRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.integrations.findMany({
      where: { organization_id: org.organizationId, deleted_at: null },
      orderBy: { created_at: 'asc' },
      take: 100,
    }),
  );
  return c.json(rows.map(serializeIntegration));
});

// ── GET /integrations/:provider/authorize — begin OAuth flow ─────────────────
integrationsRoute.get(
  '/:provider/authorize',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  async (c) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return c.json(
        { error: 'google_oauth_not_configured', message: 'Google OAuth credentials are not configured.' },
        503,
      );
    }

    const providerSlug = c.req.param('provider');
    const integrationType = PROVIDER_SLUGS[providerSlug];
    if (!integrationType) {
      return c.json(
        {
          error: 'unsupported_provider',
          message: `Unknown provider "${providerSlug}". Supported: ${Object.keys(PROVIDER_SLUGS).join(', ')}.`,
        },
        400,
      );
    }

    const org = c.get('org');
    const oauthProvider = integrationType as OAuthProvider;
    const url = generateAuthUrl(oauthProvider, org.organizationId, getRedirectUri());
    return c.json({ url });
  },
);

// ── GET /integrations/google/callback — public OAuth redirect target ─────────
// Registered here but mounted BEFORE auth middleware in app.ts so Google can
// redirect back without a Bearer token.
integrationsRoute.get('/google/callback', async (c) => {
  const appUrl = getAppUrl();
  const { code, state, error } = c.req.query() as { code?: string; state?: string; error?: string };

  if (error || !code || !state) {
    return c.redirect(`${appUrl}/connectors?error=oauth_denied`);
  }

  let provider: OAuthProvider;
  let orgId: string;
  try {
    ({ provider, orgId } = verifyState(state));
  } catch {
    return c.redirect(`${appUrl}/connectors?error=oauth_failed`);
  }

  try {
    const redirectUri = getRedirectUri();
    const { accessToken, refreshToken, expiresAt, scope } = await exchangeCode(code, redirectUri);

    const config: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      scope: string;
      siteUrl?: string;
      propertyId?: string;
    } = { accessToken, refreshToken, expiresAt, scope };

    if (provider === 'gsc') {
      const gscProvider = new GoogleSearchConsoleProvider(accessToken);
      const siteUrl = await gscProvider.getSiteUrl();
      if (siteUrl) config.siteUrl = siteUrl;
    } else {
      const properties = await listGA4Properties(accessToken);
      if (properties.length > 0 && properties[0]) config.propertyId = properties[0].propertyId;
    }

    const integrationType = provider as integration_type;
    const now = new Date();

    await withOrgContext(orgId, (tx) =>
      tx.integrations.upsert({
        where: { organization_id_integration_type: { organization_id: orgId, integration_type: integrationType } },
        create: {
          organization_id: orgId,
          integration_type: integrationType,
          config_enc: config,
          status: 'connected',
          connected_at: now,
          disconnected_at: null,
          // No `created_by` available on a public callback — omit rather
          // than fabricate a user id. The `created_by` column is nullable
          // per the schema.
        },
        update: {
          config_enc: config,
          status: 'connected',
          connected_at: now,
          disconnected_at: null,
          updated_at: now,
        },
      }),
    );

    const providerSlug = SLUG_FOR_TYPE[integrationType] ?? integrationType;
    return c.redirect(`${appUrl}/connectors?connected=${providerSlug}`);
  } catch {
    return c.redirect(`${appUrl}/connectors?error=oauth_failed`);
  }
});

// ── Token refresh helper (race-safe) ─────────────────────────────────────────
// Uses a conditional update keyed on the *current* expiresAt value. If two
// concurrent requests both see an expired token and both call refreshAccessToken,
// only one update will match the WHERE condition (updated_at < threshold trick
// is not available in Prisma without raw SQL, so we instead re-read after a
// lost race and use whichever token is freshest).
async function resolveAccessToken(
  organizationId: string,
  connectionId: string,
  cfg: { accessToken: string; refreshToken?: string; expiresAt?: number; [k: string]: unknown },
  reconnectMessage: string,
): Promise<{ accessToken: string } | { error: string; message: string; status: 409 }> {
  const needsRefresh =
    cfg.expiresAt != null &&
    cfg.expiresAt < Math.floor(Date.now() / 1000) + 60 &&
    cfg.refreshToken != null;

  if (!needsRefresh) return { accessToken: cfg.accessToken };

  try {
    const refreshed = await refreshAccessToken(cfg.refreshToken!);

    // Attempt a conditional write — only update if updated_at hasn't changed
    // since we read (i.e., nobody else snuck in a refresh). Prisma doesn't
    // expose WHERE on update directly, so we use updateMany with the id filter;
    // updateMany returns { count } which is 0 when another writer beat us.
    const { count } = await withOrgContext(organizationId, (tx) =>
      (tx.integrations as unknown as {
        updateMany: (args: {
          where: { id: string };
          data: { config_enc: unknown; updated_at: Date };
        }) => Promise<{ count: number }>;
      }).updateMany({
        where: { id: connectionId },
        data: {
          config_enc: { ...cfg, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt },
          updated_at: new Date(),
        },
      }),
    );

    if (count > 0) {
      // We won the race — use our freshly issued token.
      return { accessToken: refreshed.accessToken };
    }

    // We lost the race — re-read the row to get whatever fresher token the
    // other writer stored, rather than using our now-stale refreshed token
    // (Google may already have revoked our refresh result).
    const latest = await withOrgContext(organizationId, (tx) =>
      tx.integrations.findUnique({ where: { id: connectionId } }),
    );
    const latestCfg = latest?.config_enc as typeof cfg | null;
    if (latestCfg?.accessToken) return { accessToken: latestCfg.accessToken };

    // Fallback: use what we got from the refresh even if we lost the race.
    return { accessToken: refreshed.accessToken };
  } catch {
    return { error: 'token_expired', message: reconnectMessage, status: 409 };
  }
}

// ── GET /integrations/gsc/stats ──────────────────────────────────────────────
integrationsRoute.get(
  '/gsc/stats',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  async (c) => {
    const org = c.get('org');

    const connection = await withOrgContext(org.organizationId, (tx) =>
      tx.integrations.findUnique({
        where: {
          organization_id_integration_type: {
            organization_id: org.organizationId,
            integration_type: 'gsc',
          },
        },
      }),
    );

    if (!connection || connection.status !== 'connected' || connection.deleted_at) {
      return c.json({ error: 'not_connected' }, 404);
    }

    const cfg = connection.config_enc as {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      siteUrl?: string;
    } | null;

    if (!cfg?.accessToken || !cfg.siteUrl) {
      return c.json({ error: 'not_connected' }, 404);
    }

    const tokenResult = await resolveAccessToken(
      org.organizationId,
      connection.id,
      cfg as { accessToken: string; refreshToken?: string; expiresAt?: number; siteUrl?: string },
      'Please reconnect Google Search Console.',
    );
    if ('error' in tokenResult) return c.json({ error: tokenResult.error, message: tokenResult.message }, tokenResult.status);
    const { accessToken } = tokenResult;

    const rawDays = c.req.query('days');
    const days = Math.min(Math.max(rawDays ? parseInt(rawDays, 10) || 28 : 28, 1), 90);

    try {
      const stats = await getGSCStats(accessToken, cfg.siteUrl, days);
      return c.json(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('401') || message.includes('invalid_grant')) {
        return c.json(
          { error: 'token_expired', message: 'Please reconnect Google Search Console.' },
          409,
        );
      }
      throw err;
    }
  },
);

// ── GET /integrations/ga4/stats ──────────────────────────────────────────────
integrationsRoute.get(
  '/ga4/stats',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  async (c) => {
    const org = c.get('org');

    const connection = await withOrgContext(org.organizationId, (tx) =>
      tx.integrations.findUnique({
        where: {
          organization_id_integration_type: {
            organization_id: org.organizationId,
            integration_type: 'ga4',
          },
        },
      }),
    );

    if (!connection || connection.status !== 'connected' || connection.deleted_at) {
      return c.json({ error: 'not_connected' }, 404);
    }

    const cfg = connection.config_enc as {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      propertyId?: string;
    } | null;

    if (!cfg?.accessToken || !cfg.propertyId) {
      return c.json({ error: 'not_connected' }, 404);
    }

    const tokenResult = await resolveAccessToken(
      org.organizationId,
      connection.id,
      cfg as { accessToken: string; refreshToken?: string; expiresAt?: number; propertyId?: string },
      'Please reconnect Google Analytics 4.',
    );
    if ('error' in tokenResult) return c.json({ error: tokenResult.error, message: tokenResult.message }, tokenResult.status);
    const { accessToken } = tokenResult;

    const rawDays = c.req.query('days');
    const days = Math.min(Math.max(rawDays ? parseInt(rawDays, 10) || 28 : 28, 1), 90);

    try {
      const provider = new GoogleAnalyticsProvider(accessToken, cfg.propertyId);
      const stats = await provider.getStats(days);
      return c.json(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('401') || message.includes('invalid_grant')) {
        return c.json(
          { error: 'token_expired', message: 'Please reconnect Google Analytics 4.' },
          409,
        );
      }
      throw err;
    }
  },
);

// ── POST /integrations/:provider/connect — mock flow (backward compat) ───────
// When real OAuth is configured, reject mock tokens to prevent accidentally
// storing a placeholder alongside a real OAuth flow.
integrationsRoute.post(
  '/:provider/connect',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('admin'),
  requirePermission(MANAGE),
  auditLog({ action: 'integration.connected', entityType: 'integrations' }),
  async (c) => {
    if (process.env.GOOGLE_CLIENT_ID) {
      return c.json(
        {
          error: 'use_oauth_flow',
          message: 'Google OAuth is configured — use GET /integrations/:provider/authorize to connect.',
        },
        400,
      );
    }

    const providerSlug = c.req.param('provider');
    const integrationType = PROVIDER_SLUGS[providerSlug];
    if (!integrationType) {
      return c.json(
        {
          error: 'unsupported_provider',
          message: `Unknown or not-yet-supported provider "${providerSlug}". Supported: ${Object.keys(PROVIDER_SLUGS).join(', ')}.`,
        },
        400,
      );
    }

    const org = c.get('org');
    const user = c.get('user');
    const now = new Date();

    const mockConfig = {
      accessTokenEnc: `mock:${providerSlug}:access:${randomUUID()}`,
      refreshTokenEnc: `mock:${providerSlug}:refresh:${randomUUID()}`,
    };

    const row = await withOrgContext(org.organizationId, (tx) =>
      tx.integrations.upsert({
        where: { organization_id_integration_type: { organization_id: org.organizationId, integration_type: integrationType } },
        create: {
          organization_id: org.organizationId,
          integration_type: integrationType,
          config_enc: mockConfig,
          status: 'connected',
          connected_at: now,
          disconnected_at: null,
          created_by: user.id,
        },
        update: {
          config_enc: mockConfig,
          status: 'connected',
          connected_at: now,
          disconnected_at: null,
          updated_at: now,
        },
      }),
    );

    return c.json(serializeIntegration(row), 201);
  },
);

// ── POST /integrations/:provider/disconnect ──────────────────────────────────
integrationsRoute.post(
  '/:provider/disconnect',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('admin'),
  requirePermission(MANAGE),
  auditLog({ action: 'integration.disconnected', entityType: 'integrations' }),
  async (c) => {
    const providerSlug = c.req.param('provider');
    const integrationType = PROVIDER_SLUGS[providerSlug];
    if (!integrationType) return c.json({ error: 'unsupported_provider' }, 400);

    const org = c.get('org');
    const now = new Date();

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.integrations.findUnique({
        where: { organization_id_integration_type: { organization_id: org.organizationId, integration_type: integrationType } },
      }),
    );
    if (!existing || existing.deleted_at) return c.json({ error: 'Not connected' }, 404);

    const row = await withOrgContext(org.organizationId, (tx) =>
      tx.integrations.update({
        where: { id: existing.id },
        data: { status: 'disconnected', disconnected_at: now, config_enc: {}, updated_at: now },
      }),
    );

    return c.json(serializeIntegration(row));
  },
);

export default integrationsRoute;
