/**
 * Epic 18 (Agency / White Label / Integrations) —
 * `POST /integrations/:provider/connect` (mock), `POST
 * /integrations/:provider/disconnect`, `GET /integrations`. Backed by the
 * pre-existing, already-hardened `integrations` table (see
 * `@bebest/database` DECISIONS.md's Epic 18 section) — no OAuth flow, no
 * real network call, ever: `config_enc` is populated with a clearly-tagged
 * mock string, never a real token, and is never included in any response
 * or log line.
 *
 * `:provider` is a small, closed allowlist mapping a friendly URL slug onto
 * the DB's `integration_type` enum — currently exactly one real target
 * (`google_search_console` -> `gsc`), since that is the one this epic's
 * `MockSearchConsoleProvider` actually backs. See this file's "not done"
 * note at the bottom for Bing Webmaster.
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { withOrgContext, type integration_type } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import type { AppEnv } from '../types/context.js';

const integrationsRoute = new Hono<AppEnv>();

const MANAGE = 'manage_integrations' as const;

// Friendly URL slug -> DB enum. Only providers with a real (mocked)
// `SEODataProvider`/consumer belong here — adding a slug with no consumer
// would be exactly the "connection record exists but nothing ever reads
// it" gap the epic's end-to-end flow step 5 explicitly asks to be traced
// and avoided.
const PROVIDER_SLUGS: Record<string, integration_type> = {
  google_search_console: 'gsc',
};

function slugForType(type: integration_type): string {
  const found = Object.entries(PROVIDER_SLUGS).find(([, t]) => t === type);
  return found ? found[0] : type;
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

// ── GET /integrations — list this org's connections. Never returns
// `config_enc` (the "encrypted at rest, never logged" token blob). ────────
integrationsRoute.get('/', requireAuth, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.integrations.findMany({
      where: { organization_id: org.organizationId, deleted_at: null },
      orderBy: { created_at: 'asc' },
    }),
  );
  return c.json(rows.map(serializeIntegration));
});

// ── POST /integrations/:provider/connect — mock OAuth completion. A real
// implementation would land here AFTER a genuine OAuth redirect/callback
// (the deployment-time integration point the epic spec asks to be clearly
// marked); this build skips straight to "connected" with a tagged mock
// token, per the epic's explicit "no real OAuth flow" constraint. ─────────
integrationsRoute.post(
  '/:provider/connect',
  requireAuth,
  requireOrgFromToken('admin'),
  requirePermission(MANAGE),
  auditLog({ action: 'integration.connected', entityType: 'integrations' }),
  async (c) => {
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

    // DEPLOYMENT-TIME INTEGRATION POINT: a real connect flow exchanges an
    // OAuth authorization code for real access/refresh tokens here. This
    // mock never makes that call — the string below is clearly tagged as a
    // placeholder, never mistakeable for a real credential, and is stored
    // only inside `config_enc` (this table's documented "encrypted at
    // rest" boundary — see @bebest/database DECISIONS.md), never logged.
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

// ── POST /integrations/:provider/disconnect ─────────────────────────────
integrationsRoute.post(
  '/:provider/disconnect',
  requireAuth,
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
        // config_enc cleared, not merely left stale — a disconnected
        // integration must not leave a usable (mock) credential behind.
        data: { status: 'disconnected', disconnected_at: now, config_enc: {}, updated_at: now },
      }),
    );

    return c.json(serializeIntegration(row));
  },
);

export default integrationsRoute;

// NOT DONE: Bing Webmaster Tools. `docs/10-seo/SEO_ENGINE.md`'s "Available
// Without Paid APIs" list names both GSC and Bing; this build wires only
// Google Search Console end-to-end (the one `MockSearchConsoleProvider`
// backs). Adding Bing is: one more `integration_type` enum value (schema
// never applied to a database — safe to add), one more `PROVIDER_SLUGS`
// entry, and a `MockBingWebmasterProvider` alongside
// `mock-search-console-provider.ts` — no other file in this epic would
// need to change.
