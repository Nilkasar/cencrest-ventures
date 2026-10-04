import { apiClient, ApiError } from "@/lib/api-client";
import type { AutonomyLevel } from "@/data/agents/types";

/**
 * Epic 22 Phase 2 — Settings > Organization / Notifications / Autonomy.
 * Real routes only (`apps/api/src/routes/{orgs,org-settings}.ts`):
 *
 *   PATCH  /api/orgs/:slug                            -> renameOrganization()
 *   DELETE /api/orgs/:slug  { confirmName }           -> deleteOrganization()
 *   GET    /api/orgs/me/notification-preferences      -> getNotificationPreferences()
 *   PUT    /api/orgs/me/notification-preferences      -> updateNotificationPreferences()
 *   GET    /api/orgs/me/autonomy                      -> getAutonomy()
 *   PUT    /api/orgs/me/autonomy  { level }           -> setAutonomy()
 */

interface ErrorBody {
  error?: string;
  code?: string;
  message?: string;
  issues?: { message?: string }[];
}

function bodyOf(err: ApiError): ErrorBody {
  return (err.body && typeof err.body === "object" ? err.body : {}) as ErrorBody;
}

/** A refusal the UI can show verbatim. `code` is the API's machine code
 *  (`confirmation_mismatch`, `internal_org`, `exceeds_plan`, …) or the
 *  HTTP status as a string when the body carries none. */
export class OrganizationSettingsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OrganizationSettingsError";
  }
}

function translate(err: unknown, fallbacks: Partial<Record<number, string>>): never {
  if (err instanceof ApiError) {
    const body = bodyOf(err);
    const code = body.code ?? body.error ?? String(err.status);
    const message = body.message ?? body.issues?.[0]?.message ?? fallbacks[err.status] ?? "Something went wrong — try again.";
    throw new OrganizationSettingsError(message, code, err.status);
  }
  throw err;
}

// ── Organization profile ────────────────────────────────────────────────────

/** Mirrors `routes/orgs.ts`'s `updateOrgSchema` name rule (trimmed 2–100
 *  chars, at least one slug character) so errors show while typing. */
export function validateOrganizationName(raw: string): string | undefined {
  const name = raw.trim();
  if (name.length < 2) return "Use at least 2 characters.";
  if (name.length > 100) return "Keep it to 100 characters or fewer.";
  if (!/[a-z0-9]/i.test(name)) return "Include at least one letter or number.";
  return undefined;
}

export async function renameOrganization(slug: string, name: string): Promise<{ id: string; name: string; slug: string }> {
  try {
    return await apiClient.patch(`/orgs/${encodeURIComponent(slug)}`, { name: name.trim() });
  } catch (err) {
    translate(err, { 403: "Only an owner or admin can rename the organization.", 404: "This organization no longer exists." });
  }
}

export async function deleteOrganization(slug: string, confirmName: string): Promise<void> {
  try {
    await apiClient.delete(`/orgs/${encodeURIComponent(slug)}`, { body: { confirmName } });
  } catch (err) {
    translate(err, { 403: "Only the owner can delete the organization." });
  }
}

// ── Notification preferences ────────────────────────────────────────────────

export interface NotificationPreference {
  eventType: string;
  label: string;
  description: string;
  /** False for an org-wide-only type — those are never emailed. */
  emailApplicable: boolean;
  inApp: boolean;
  email: boolean;
}

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  const res = await apiClient.get<{ preferences: NotificationPreference[] }>("/orgs/me/notification-preferences");
  return res.preferences;
}

export async function updateNotificationPreferences(
  changes: { eventType: string; inApp?: boolean; email?: boolean }[],
): Promise<NotificationPreference[]> {
  try {
    const res = await apiClient.put<{ preferences: NotificationPreference[] }>("/orgs/me/notification-preferences", {
      preferences: changes,
    });
    return res.preferences;
  } catch (err) {
    translate(err, {});
  }
}

// ── Autonomy ────────────────────────────────────────────────────────────────

export interface AutonomySettings {
  /** The org's own ceiling (`organizations.autonomy_level_max`). */
  level: AutonomyLevel;
  /** The plan's cap, or null when the plan sets none. */
  planMax: number | null;
  /** Highest level this org may choose: min(3, planMax). */
  maxAllowed: AutonomyLevel;
  /** What an agent run is held to: min(level, maxAllowed). */
  effectiveMax: AutonomyLevel;
  plan: string;
  agentsAvailable: boolean;
  canEdit: boolean;
}

export async function getAutonomy(): Promise<AutonomySettings> {
  return apiClient.get<AutonomySettings>("/orgs/me/autonomy");
}

export async function setAutonomy(level: AutonomyLevel): Promise<AutonomySettings> {
  try {
    return await apiClient.put<AutonomySettings>("/orgs/me/autonomy", { level });
  } catch (err) {
    translate(err, { 403: "Only an owner or admin can change the autonomy limit." });
  }
}
