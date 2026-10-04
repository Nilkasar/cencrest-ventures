/**
 * Epic 22 (Workspace Views) Phase 2 — the two Settings tabs that were
 * "Coming soon": Notifications and Autonomy. Mounted at `/api/orgs/me`;
 * the org is the one selected in the access token (`requireOrgFromToken`),
 * like `/api/orgs/me/subscription`.
 *
 *   GET  /notification-preferences   the caller's own preferences in this org
 *   PUT  /notification-preferences   update some or all of them (any member)
 *   GET  /autonomy                   org ceiling + plan ceiling (any member)
 *   PUT  /autonomy                   change the org ceiling (owner/admin)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { db, withOrgContext, type notif_channel } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { writeAuditEvent } from '../lib/audit.js';
import { clientIp } from '../lib/client-ip.js';
import { resolvePlanLimits } from '../lib/entitlements.js';
import { isAtLeast } from '../lib/rbac.js';
import {
  assertAutonomyLevelAllowed,
  AutonomyLevelRejectedError,
  MAX_AUTONOMY_LEVEL,
} from '../lib/agents/autonomy.js';
import {
  listChannelPreferences,
  NOTIFICATION_PREFERENCE_TYPES,
  NOTIFICATION_TYPE_META,
  type ChannelPreference,
  type NotificationPreferenceType,
} from '../lib/notifications/preferences.js';
import type { AppEnv } from '../types/context.js';

const orgSettings = new Hono<AppEnv>();

function serializePreferences(map: Map<NotificationPreferenceType, ChannelPreference>) {
  return {
    preferences: NOTIFICATION_PREFERENCE_TYPES.map((type) => ({
      eventType: type,
      label: NOTIFICATION_TYPE_META[type].label,
      description: NOTIFICATION_TYPE_META[type].description,
      emailApplicable: NOTIFICATION_TYPE_META[type].emailApplicable,
      inApp: map.get(type)!.inApp,
      email: map.get(type)!.email,
    })),
  };
}

// ── GET /notification-preferences ──────────────────────────────────────────
orgSettings.get('/notification-preferences', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const map = await withOrgContext(org.organizationId, (tx) =>
    listChannelPreferences(tx, org.organizationId, user.id),
  );
  return c.json(serializePreferences(map));
});

// ── PUT /notification-preferences ──────────────────────────────────────────
// Partial: only the listed types/channels change; everything else keeps its
// current value (or the default). Always the CALLER's own preferences — no
// user id is accepted from the body.
const putPreferencesSchema = z.object({
  preferences: z
    .array(
      z
        .object({
          eventType: z.enum(NOTIFICATION_PREFERENCE_TYPES),
          inApp: z.boolean().optional(),
          email: z.boolean().optional(),
        })
        .refine((p) => p.inApp !== undefined || p.email !== undefined, {
          message: 'Each entry must set inApp and/or email',
        }),
    )
    .min(1)
    .max(NOTIFICATION_PREFERENCE_TYPES.length)
    .refine((list) => new Set(list.map((p) => p.eventType)).size === list.length, {
      message: 'Each eventType may appear only once',
    }),
});

orgSettings.put('/notification-preferences', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = putPreferencesSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

  const org = c.get('org');
  const user = c.get('user');

  const writes: { type: NotificationPreferenceType; channel: notif_channel; enabled: boolean }[] = [];
  for (const p of parsed.data.preferences) {
    if (p.inApp !== undefined) writes.push({ type: p.eventType, channel: 'in_app', enabled: p.inApp });
    if (p.email !== undefined) writes.push({ type: p.eventType, channel: 'email', enabled: p.email });
  }

  const map = await withOrgContext(org.organizationId, async (tx) => {
    for (const w of writes) {
      await tx.notification_preferences.upsert({
        where: {
          org_user_type_channel: {
            organization_id: org.organizationId,
            user_id: user.id,
            notification_type: w.type,
            channel: w.channel,
          },
        },
        create: {
          organization_id: org.organizationId,
          user_id: user.id,
          notification_type: w.type,
          channel: w.channel,
          enabled: w.enabled,
        },
        update: { enabled: w.enabled },
      });
    }
    return listChannelPreferences(tx, org.organizationId, user.id);
  });

  await writeAuditEvent({
    userId: user.id,
    organizationId: org.organizationId,
    actorType: 'user',
    actorRole: org.role,
    action: 'settings.changed',
    entityType: 'notification_preferences',
    entityId: null,
    ipAddress: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
    result: 'success',
    newValue: parsed.data.preferences,
    details: { setting: 'notification_preferences' },
  });

  return c.json(serializePreferences(map));
});

// ── Autonomy ─────────────────────────────────────────────────────────────────
// `level` is the org's ceiling for any agent run (organizations.
// autonomy_level_max, default 3 — migration 0025). `planMax` is the plan's own
// `autonomy_level_max` entitlement (null = the plan sets no cap of its own).
// `maxAllowed` is the highest level this org may currently choose:
// min(3, planMax). `effectiveMax` is what an agent trigger is actually held
// to: min(level, maxAllowed). Level 4 is never offered — lib/agents/autonomy.ts.
async function autonomyState(organizationId: string, role: Parameters<typeof isAtLeast>[0]) {
  const [orgRow, { plan, limits }] = await Promise.all([
    db.organizations.findUnique({ where: { id: organizationId }, select: { autonomy_level_max: true } }),
    resolvePlanLimits(organizationId),
  ]);
  const planMax = limits.autonomy_level_max;
  // A missing row cannot happen for a resolved org context; if it did, the
  // most conservative value is reported (same as lib/agents/runner.ts).
  const level = orgRow?.autonomy_level_max ?? 1;
  const maxAllowed = Math.min(MAX_AUTONOMY_LEVEL, planMax ?? MAX_AUTONOMY_LEVEL);
  return {
    level,
    effectiveMax: Math.min(level, maxAllowed),
    planMax,
    maxAllowed,
    plan,
    agentsAvailable: limits.agents === true,
    canEdit: isAtLeast(role, 'admin'),
  };
}

orgSettings.get('/autonomy', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  return c.json(await autonomyState(org.organizationId, org.role));
});

orgSettings.put('/autonomy', requireAuth, authenticatedRateLimit, requireOrgFromToken('admin'), async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (body === null || typeof body !== 'object' || !('level' in body)) {
    return c.json({ error: 'Validation failed', message: '`level` (1–3) is required.' }, 422);
  }

  let level: number;
  try {
    // The same single gate every agent trigger goes through: 1, 2 or 3 —
    // anything else (4, 0, 2.5, "3", null) is rejected identically.
    level = assertAutonomyLevelAllowed((body as { level: unknown }).level);
  } catch (err) {
    if (err instanceof AutonomyLevelRejectedError) {
      return c.json({ error: 'autonomy_level_rejected', message: err.message }, 422);
    }
    throw err;
  }

  const org = c.get('org');
  const before = await autonomyState(org.organizationId, org.role);
  if (level > before.maxAllowed) {
    return c.json(
      {
        error: 'autonomy_level_rejected',
        code: 'exceeds_plan',
        message: `Your ${before.plan} plan allows agent autonomy up to level ${before.maxAllowed}.`,
        maxAllowed: before.maxAllowed,
      },
      422,
    );
  }

  if (level !== before.level) {
    await db.organizations.update({
      where: { id: org.organizationId },
      data: { autonomy_level_max: level, updated_at: new Date() },
    });

    const user = c.get('user');
    await writeAuditEvent({
      userId: user.id,
      organizationId: org.organizationId,
      actorType: 'user',
      actorRole: org.role,
      action: 'settings.changed',
      entityType: 'organization',
      entityId: org.organizationId,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: 'success',
      oldValue: { autonomyLevelMax: before.level },
      newValue: { autonomyLevelMax: level },
      details: { setting: 'autonomy_level_max', viaAgencyOrgId: org.viaAgencyOrgId ?? null },
    });
  }

  return c.json({ ...before, level, effectiveMax: Math.min(level, before.maxAllowed) });
});

export default orgSettings;
