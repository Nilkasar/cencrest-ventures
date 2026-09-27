/**
 * Epic 18 (Agency / White Label / Integrations) — org-aware
 * `SEODataProvider` selection, preferring a connected
 * `MockSearchConsoleProvider` over the null default. This is the literal
 * "customer-connected Search Console data (best)" seam
 * `seo-data-provider.ts`'s own header comment describes as left open for a
 * future epic to implement — this is that epic. Kept in its own file
 * (rather than added to `seo-data-provider.ts` directly) purely to avoid a
 * module import cycle: this function needs BOTH `seo-data-provider.ts`
 * (the `SEODataProvider` type + `getSEODataProvider`) and
 * `mock-search-console-provider.ts` (which itself imports FROM
 * `seo-data-provider.ts`).
 */
import { withOrgContext } from '@bebest/database';
import { getSEODataProvider, type SEODataProvider } from './seo-data-provider.js';
import { MockSearchConsoleProvider } from './mock-search-console-provider.js';
import { GoogleSearchConsoleProvider } from './google-search-console-provider.js';

/**
 * Resolves which `SEODataProvider` `organizationId` should get: a
 * `MockSearchConsoleProvider` if (and only if) that org has a `connected`
 * `integrations` row for Search Console (`integration_type: 'gsc'`), the
 * same process-lifetime `NullSEODataProvider` singleton otherwise. Callers
 * that already have `org.organizationId` in scope (every `requireOrgFromToken`
 * route) should call this instead of the bare `getSEODataProvider()` — see
 * `routes/seo.ts`'s one call site (end-to-end flow step 5: "confirm Epic
 * 4's `SEODataProvider` selection logic actually prefers it... trace the
 * provider-resolution code"). Fresh DB read every call, no caching:
 * disconnecting the integration takes effect on the very next call, same
 * "no stale grant" discipline `lib/agency-access.ts` follows for the
 * acting-as-client-org check.
 */
export async function resolveSEODataProviderForOrg(organizationId: string): Promise<SEODataProvider> {
  const connection = await withOrgContext(organizationId, (tx) =>
    tx.integrations.findUnique({
      where: { organization_id_integration_type: { organization_id: organizationId, integration_type: 'gsc' } },
    }),
  );

  if (connection && connection.status === 'connected' && connection.deleted_at === null) {
    // A real access token means real Search Console data — always preferred.
    const config = connection.config_enc as { accessToken?: string; siteUrl?: string } | null;
    if (config?.accessToken && !config.accessToken.startsWith('mock:')) {
      return new GoogleSearchConsoleProvider(config.accessToken, config.siteUrl);
    }

    // No real token (absent, or a `mock:` placeholder). The fallback below,
    // `MockSearchConsoleProvider`, derives `monthlyVolume` from a hash of the
    // keyword and labels it `confidence: 'high'` — so in production it would
    // present invented numbers to a customer who had connected their own
    // account, which is worse than admitting we have no data. Outside dev/test
    // such a connection therefore falls through to `NullSEODataProvider`, whose
    // volumes are at least honestly marked `confidence: 'estimate'`.
    if (process.env.NODE_ENV === 'production') {
      return getSEODataProvider();
    }

    return new MockSearchConsoleProvider();
  }

  return getSEODataProvider();
}
