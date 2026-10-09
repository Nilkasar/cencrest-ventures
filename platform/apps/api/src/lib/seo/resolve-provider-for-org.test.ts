import { describe, expect, it, vi, beforeEach } from 'vitest';

const integrationsFindUnique = vi.fn();

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({ integrations: { findUnique: integrationsFindUnique } }),
  ),
}));

describe('resolveSEODataProviderForOrg', () => {
  beforeEach(() => {
    integrationsFindUnique.mockReset();
  });

  it("returns the NullSEODataProvider singleton when there is no integrations row at all", async () => {
    integrationsFindUnique.mockResolvedValue(null);
    const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
    const { getSEODataProvider } = await import('./seo-data-provider.js');
    const provider = await resolveSEODataProviderForOrg('org-1');
    expect(provider).toBe(getSEODataProvider()); // the exact process-lifetime singleton
    expect(provider.name).toBe('null_provider');
  });

  it('returns the NullSEODataProvider when the connection exists but is disconnected', async () => {
    integrationsFindUnique.mockResolvedValue({ status: 'disconnected', deleted_at: null });
    const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
    const provider = await resolveSEODataProviderForOrg('org-1');
    expect(provider.name).toBe('null_provider');
  });

  it('returns the NullSEODataProvider when the connection row is soft-deleted, even if status still says connected', async () => {
    integrationsFindUnique.mockResolvedValue({ status: 'connected', deleted_at: new Date() });
    const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
    const provider = await resolveSEODataProviderForOrg('org-1');
    expect(provider.name).toBe('null_provider');
  });

  it('PREFERS MockSearchConsoleProvider once the integration is connected — provider selection actually changes', async () => {
    integrationsFindUnique.mockResolvedValue({ status: 'connected', deleted_at: null });
    const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
    const provider = await resolveSEODataProviderForOrg('org-1');
    expect(provider.name).toBe('search_console');
  });

  it('NEVER serves the fabricated-volume mock in production when there is no real token', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      integrationsFindUnique.mockResolvedValue({ status: 'connected', deleted_at: null });
      const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
      const provider = await resolveSEODataProviderForOrg('org-1');
      expect(provider.name).toBe('null_provider');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('a `mock:` placeholder token is not a real token, so production still refuses it', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      integrationsFindUnique.mockResolvedValue({
        status: 'connected',
        deleted_at: null,
        config_enc: { accessToken: 'mock:placeholder', siteUrl: 'https://x.example' },
      });
      const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
      const provider = await resolveSEODataProviderForOrg('org-1');
      expect(provider.name).toBe('null_provider');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('does NOT block the real Search Console provider in production — the guard is about fabricated data, not about production', async () => {
    // This is the property the guard must not break. Refusing real measured
    // data in production would be a worse bug than the one it prevents.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      integrationsFindUnique.mockResolvedValue({
        status: 'connected',
        deleted_at: null,
        config_enc: { accessToken: 'ya29.real-token', siteUrl: 'https://x.example' },
      });
      const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
      const provider = await resolveSEODataProviderForOrg('org-1');
      expect(provider.name).not.toBe('null_provider');
      expect(provider.name).not.toBe('search_console_mock');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('queries the gsc integration_type specifically, scoped to the given org', async () => {
    integrationsFindUnique.mockResolvedValue(null);
    const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
    await resolveSEODataProviderForOrg('org-42');
    expect(integrationsFindUnique).toHaveBeenCalledWith({
      where: { organization_id_integration_type: { organization_id: 'org-42', integration_type: 'gsc' } },
    });
  });
});
