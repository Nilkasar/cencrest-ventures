import { ApiError, apiClient } from "@/lib/api-client";
import type {
  CancelJobResponse,
  CapabilitiesResponse,
  JobType,
  MagicLinkSentResponse,
  Paginated,
  PlatformAgencyClientsResponse,
  PlatformAgencyListItem,
  PlatformAuditItem,
  PlatformJob,
  PlatformOrgDetail,
  PlatformOrgListItem,
  PlatformOverview,
  PlatformSnapshotRequest,
  PlatformUserDetail,
  PlatformUserListItem,
} from "./types";

/**
 * Data-access seam for the Platform view (Epic 22 Phase 1). Every call goes
 * to the real `/api/platform/*` routes; there is no fixture fallback.
 *
 * Error contract the screens rely on (see `PlatformErrorState`):
 *   503 {error:'Platform database not configured'} — environment, not a bug
 *   403 — role missing/insufficient (support calling an admin action)
 *   404 — the org/user/job doesn't exist
 *   409 — cancel of a job that is no longer active
 */

export const PLATFORM_PAGE_SIZE = 25;

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function apiErrorBody(err: unknown): { error?: string; status?: string | null } | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object") return err.body as { error?: string };
  return undefined;
}

export function isPlatformDbUnconfigured(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** A human message for anything else (never the raw "Request to … failed with 500"). */
export function platformErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = apiErrorBody(err)?.error;
    if (err.status === 429) return "Too many requests in a short time. Wait a moment and try again.";
    if (err.status === 422 && reason) return reason;
    if (err.status >= 500) return "The platform API had a problem answering. Nothing was changed — try again.";
    if (reason) return reason;
    return `The platform API answered ${err.status}.`;
  }
  return "Couldn't reach the platform API. Check your connection and try again.";
}

const page = (p: number, limit = PLATFORM_PAGE_SIZE) => ({ limit, offset: Math.max(0, (p - 1) * limit) });

// ── Overview ────────────────────────────────────────────────────────────────

export const fetchPlatformOverview = () => apiClient.get<PlatformOverview>("/platform/overview");
export const fetchCapabilities = () => apiClient.get<CapabilitiesResponse>("/platform/capabilities");

// ── Organizations ───────────────────────────────────────────────────────────

export interface OrgFilters {
  q?: string;
  kind?: string;
  plan?: string;
  status?: string;
  page: number;
}

export const fetchPlatformOrgs = (f: OrgFilters) =>
  apiClient.get<Paginated<PlatformOrgListItem>>(
    `/platform/orgs${qs({ q: f.q, kind: f.kind, plan: f.plan, status: f.status, ...page(f.page) })}`,
  );

export const fetchPlatformOrg = (id: string) => apiClient.get<PlatformOrgDetail>(`/platform/orgs/${encodeURIComponent(id)}`);

// ── Users ───────────────────────────────────────────────────────────────────

export interface UserFilters {
  q?: string;
  platformRole?: string;
  page: number;
}

export const fetchPlatformUsers = (f: UserFilters) =>
  apiClient.get<Paginated<PlatformUserListItem>>(`/platform/users${qs({ q: f.q, platformRole: f.platformRole, ...page(f.page) })}`);

export const fetchPlatformUser = (id: string) => apiClient.get<PlatformUserDetail>(`/platform/users/${encodeURIComponent(id)}`);

export const sendUserMagicLink = (id: string) =>
  apiClient.post<MagicLinkSentResponse>(`/platform/users/${encodeURIComponent(id)}/magic-link`);

// ── Agencies ────────────────────────────────────────────────────────────────

export const fetchPlatformAgencies = (f: { q?: string; page: number }) =>
  apiClient.get<Paginated<PlatformAgencyListItem>>(`/platform/agencies${qs({ q: f.q, ...page(f.page) })}`);

export const fetchAgencyClients = (id: string, f: { status?: string; page: number }) =>
  apiClient.get<PlatformAgencyClientsResponse>(
    `/platform/agencies/${encodeURIComponent(id)}/clients${qs({ status: f.status, ...page(f.page) })}`,
  );

// ── Operations ──────────────────────────────────────────────────────────────

export interface JobFilters {
  type?: string;
  status?: string;
  orgId?: string;
  stuck?: boolean;
  page: number;
}

export const fetchPlatformJobs = (f: JobFilters) =>
  apiClient.get<Paginated<PlatformJob>>(
    `/platform/jobs${qs({ type: f.type, status: f.status, orgId: f.orgId, stuck: f.stuck ? "true" : undefined, ...page(f.page) })}`,
  );

export const cancelPlatformJob = (type: JobType, id: string) =>
  apiClient.post<CancelJobResponse>(`/platform/jobs/${type}/${encodeURIComponent(id)}/cancel`);

// ── Audit ───────────────────────────────────────────────────────────────────

export interface AuditFilters {
  source?: string;
  orgId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
}

export const fetchPlatformAudit = (f: AuditFilters) =>
  apiClient.get<Paginated<PlatformAuditItem>>(
    `/platform/audit${qs({ source: f.source, orgId: f.orgId, userId: f.userId, action: f.action, from: f.from, to: f.to, ...page(f.page) })}`,
  );

// ── Growth ──────────────────────────────────────────────────────────────────

export const fetchSnapshotRequests = (f: { status?: string; page: number }) =>
  apiClient.get<Paginated<PlatformSnapshotRequest>>(`/platform/growth/snapshots${qs({ status: f.status, ...page(f.page) })}`);
