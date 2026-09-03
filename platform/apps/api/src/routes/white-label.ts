/**
 * Epic 18 (Agency / White Label / Integrations) —
 * `GET/PATCH /orgs/me/settings/white-label`, this epic's literal route
 * shape, backed by the pre-existing `white_label_configs` table (see
 * `lib/white-label.ts`'s header comment for why that table, not a JSONB
 * blob in `organizations.settings`, is what actually gets read/written).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { auditLog } from '../middleware/audit-log.js';
import { resolvePlanLimits } from '../lib/entitlements.js';
import { DEFAULT_BRANDING, serializeWhiteLabelConfig } from '../lib/white-label.js';
import type { AppEnv } from '../types/context.js';

const whiteLabel = new Hono<AppEnv>();

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  brandName: z.string().trim().min(1).max(255).optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  primaryColor: z.string().regex(HEX_COLOR).nullable().optional(),
  secondaryColor: z.string().regex(HEX_COLOR).nullable().optional(),
  // Display-only per the epic spec ("no real DNS/custom-domain infra") —
  // stored and returned, never used to actually route traffic anywhere in
  // this build.
  customDomain: z.string().trim().max(255).nullable().optional(),
  supportEmail: z.string().email().nullable().optional(),
  hidePoweredBy: z.boolean().optional(),
  customTermsUrl: z.string().url().max(2048).nullable().optional(),
  customPrivacyUrl: z.string().url().max(2048).nullable().optional(),
});

// ── GET — any member (viewer+) can see their own org's current setting;
// always 200, defaulting shape when nothing has been configured yet. ──────
whiteLabel.get('/', requireAuth, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  const row = await withOrgContext(org.organizationId, (tx) =>
    tx.white_label_configs.findUnique({ where: { organization_id: org.organizationId } }),
  );
  if (!row || row.deleted_at) return c.json(DEFAULT_BRANDING);
  return c.json(serializeWhiteLabelConfig(row));
});

// ── PATCH — admin+, gated by the agency+ tier's `white_label` feature flag
// (Epic 16's real `plans.limits`, not a hardcoded tier list). Upserts: the
// first PATCH for an org creates its `white_label_configs` row. ───────────
whiteLabel.patch(
  '/',
  requireAuth,
  requireOrgFromToken('admin'),
  auditLog({ action: 'settings.changed', entityType: 'white_label_configs' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');

    const { limits, plan } = await resolvePlanLimits(org.organizationId);
    if (!limits.white_label) {
      return c.json(
        {
          error: 'feature_not_available',
          message: `White-label branding is not available on the ${plan} plan.`,
          feature: 'white_label',
          plan,
        },
        402,
      );
    }

    const d = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.white_label_configs.upsert({
        where: { organization_id: org.organizationId },
        create: {
          organization_id: org.organizationId,
          brand_name: d.brandName ?? DEFAULT_BRANDING.brandName,
          logo_url: d.logoUrl ?? null,
          primary_color: d.primaryColor ?? null,
          secondary_color: d.secondaryColor ?? null,
          custom_domain: d.customDomain ?? null,
          support_email: d.supportEmail ?? null,
          hide_powered_by: d.hidePoweredBy ?? false,
          custom_terms_url: d.customTermsUrl ?? null,
          custom_privacy_url: d.customPrivacyUrl ?? null,
          enabled: d.enabled ?? true,
          created_by: user.id,
        },
        update: {
          ...(d.brandName !== undefined && { brand_name: d.brandName }),
          ...(d.logoUrl !== undefined && { logo_url: d.logoUrl }),
          ...(d.primaryColor !== undefined && { primary_color: d.primaryColor }),
          ...(d.secondaryColor !== undefined && { secondary_color: d.secondaryColor }),
          ...(d.customDomain !== undefined && { custom_domain: d.customDomain }),
          ...(d.supportEmail !== undefined && { support_email: d.supportEmail }),
          ...(d.hidePoweredBy !== undefined && { hide_powered_by: d.hidePoweredBy }),
          ...(d.customTermsUrl !== undefined && { custom_terms_url: d.customTermsUrl }),
          ...(d.customPrivacyUrl !== undefined && { custom_privacy_url: d.customPrivacyUrl }),
          ...(d.enabled !== undefined && { enabled: d.enabled }),
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serializeWhiteLabelConfig(updated));
  },
);

export default whiteLabel;
