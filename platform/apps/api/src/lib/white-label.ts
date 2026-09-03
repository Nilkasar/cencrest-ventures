/**
 * Epic 18 (Agency / White Label / Integrations) — white-label branding
 * resolution. Backed by the pre-existing, already-hardened
 * `white_label_configs` table (see `@bebest/database` DECISIONS.md's Epic
 * 18 section for why this is used as-is instead of the epic spec's own
 * prose suggestion of a JSONB `whiteLabel` shape inside
 * `organizations.settings`), projected to/from the `whiteLabel` response
 * shape `GET/PATCH /orgs/me/settings/white-label` (this epic's literal
 * route) actually speaks.
 *
 * `resolveWhiteLabelBranding` is the one function any future report/page
 * renderer should call to answer "what branding does this org's output get
 * — custom or default BeBest." It is intentionally the ONLY place that
 * knows the default fallback values, so a report renderer, the public
 * snapshot page, or anything else never needs its own copy of "what does
 * unbranded look like."
 *
 * NOT WIRED INTO A REPORT RENDERER YET — see this epic's backend doc's
 * "what's not done" section for exactly why: Epic 15 (Reporting) has no
 * `-backend.md` yet (not built as of this epic), and Epic 17's public
 * snapshot page (`routes/snapshot.ts`) is a pre-signup, anonymous flow tied
 * to BeBest's own internal ops org (`getInternalOrgId()`) with no customer
 * `organization_id` at all — there is structurally no real per-org page to
 * wire this into today. This function is the ready-made seam for whichever
 * future epic becomes that consumer.
 */
import { withOrgContext, type white_label_configs } from '@bebest/database';

export const DEFAULT_BRANDING = {
  enabled: false,
  brandName: 'BeBest',
  logoUrl: null as string | null,
  primaryColor: null as string | null,
  secondaryColor: null as string | null,
  customDomain: null as string | null,
  supportEmail: null as string | null,
  hidePoweredBy: false,
  customTermsUrl: null as string | null,
  customPrivacyUrl: null as string | null,
};

export type WhiteLabelBranding = typeof DEFAULT_BRANDING;

export function serializeWhiteLabelConfig(row: white_label_configs): WhiteLabelBranding {
  return {
    enabled: row.enabled,
    brandName: row.brand_name,
    logoUrl: row.logo_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    customDomain: row.custom_domain,
    supportEmail: row.support_email,
    hidePoweredBy: row.hide_powered_by,
    customTermsUrl: row.custom_terms_url,
    customPrivacyUrl: row.custom_privacy_url,
  };
}

/**
 * Resolves the EFFECTIVE branding for `organizationId` — its own
 * `white_label_configs` row when one exists AND `enabled` is true, the
 * documented BeBest default otherwise (no row at all, a row that was
 * explicitly disabled, or a soft-deleted row). Never throws for the
 * "no custom branding" case — that is the normal, expected result for
 * every non-white-labeled org (every free/starter/growth/pro-tier org
 * today, since `white_label` is an agency+-tier feature flag — see
 * `routes/white-label.ts`'s PATCH handler for where THAT gate lives; this
 * function itself only ever reads, it never enforces the entitlement).
 */
export async function resolveWhiteLabelBranding(organizationId: string): Promise<WhiteLabelBranding> {
  const row = await withOrgContext(organizationId, (tx) =>
    tx.white_label_configs.findUnique({ where: { organization_id: organizationId } }),
  );

  if (!row || row.deleted_at || !row.enabled) return DEFAULT_BRANDING;
  return serializeWhiteLabelConfig(row);
}
