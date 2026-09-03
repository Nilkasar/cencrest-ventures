import { describe, expect, it, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({ white_label_configs: { findUnique } }),
  ),
}));

describe('resolveWhiteLabelBranding', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('returns the documented BeBest default when no row exists', async () => {
    findUnique.mockResolvedValue(null);
    const { resolveWhiteLabelBranding, DEFAULT_BRANDING } = await import('./white-label.js');
    expect(await resolveWhiteLabelBranding('org-1')).toEqual(DEFAULT_BRANDING);
  });

  it('returns the default when a row exists but is disabled', async () => {
    findUnique.mockResolvedValue({ enabled: false, brand_name: 'Should Not Show', deleted_at: null });
    const { resolveWhiteLabelBranding, DEFAULT_BRANDING } = await import('./white-label.js');
    expect(await resolveWhiteLabelBranding('org-1')).toEqual(DEFAULT_BRANDING);
  });

  it('returns the default when the row is soft-deleted, even if enabled: true', async () => {
    findUnique.mockResolvedValue({ enabled: true, brand_name: 'Ghost', deleted_at: new Date() });
    const { resolveWhiteLabelBranding, DEFAULT_BRANDING } = await import('./white-label.js');
    expect(await resolveWhiteLabelBranding('org-1')).toEqual(DEFAULT_BRANDING);
  });

  it('returns the custom branding when enabled and not deleted', async () => {
    findUnique.mockResolvedValue({
      enabled: true,
      brand_name: 'Acme Agency',
      logo_url: 'https://acme.example.com/logo.png',
      primary_color: '#112233',
      secondary_color: null,
      custom_domain: 'reports.acme.example.com',
      support_email: 'support@acme.example.com',
      hide_powered_by: true,
      custom_terms_url: null,
      custom_privacy_url: null,
      deleted_at: null,
    });
    const { resolveWhiteLabelBranding } = await import('./white-label.js');
    const branding = await resolveWhiteLabelBranding('org-1');
    expect(branding.enabled).toBe(true);
    expect(branding.brandName).toBe('Acme Agency');
    expect(branding.hidePoweredBy).toBe(true);
  });
});
