/**
 * Epic 18 (Agency / White Label / Integrations) — the `whiteLabel` wire
 * shape `GET/PATCH /orgs/me/settings/white-label` both speak
 * (`apps/api/src/lib/white-label.ts`'s `DEFAULT_BRANDING`/
 * `serializeWhiteLabelConfig`, unchanged by this response). Every field is
 * already camelCase and optional-write, so `WhiteLabelPatch` is a `Partial`
 * of the same shape minus nothing — the API itself defines "any subset."
 */
export interface WhiteLabelBranding {
  enabled: boolean;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  /** Display-only per the epic spec — "no real DNS/custom-domain infra."
   *  Stored and returned, never used to actually route traffic. */
  customDomain: string | null;
  supportEmail: string | null;
  hidePoweredBy: boolean;
  customTermsUrl: string | null;
  customPrivacyUrl: string | null;
}

export type WhiteLabelPatch = Partial<WhiteLabelBranding>;
