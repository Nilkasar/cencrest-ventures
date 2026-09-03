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

  it('queries the gsc integration_type specifically, scoped to the given org', async () => {
    integrationsFindUnique.mockResolvedValue(null);
    const { resolveSEODataProviderForOrg } = await import('./resolve-provider-for-org.js');
    await resolveSEODataProviderForOrg('org-42');
    expect(integrationsFindUnique).toHaveBeenCalledWith({
      where: { organization_id_integration_type: { organization_id: 'org-42', integration_type: 'gsc' } },
    });
  });
});
