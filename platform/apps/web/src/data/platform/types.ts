/**
 * Response shapes for Epic 22 Phase 1's Platform API (`/api/platform/*`).
 * Mirrors apps/api/src/routes/platform/*.ts and
 * apps/api/src/lib/platform/capabilities.ts field for field — the web app
 * cannot import from the API package, so these are kept in step by hand.
 */

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type StatusCounts = Record<string, number>;

export type JobType = "crawl" | "ai_run" | "agent_run" | "snapshot";
export const JOB_TYPES: readonly JobType[] = ["crawl", "ai_run", "agent_run", "snapshot"];

// ── /overview ──────────────────────────────────────────────────────────────

export interface PlatformOverview {
  generatedAt: string;
  organizations: {
    total: number;
    byKind: Record<string, number>;
    byPlan: Record<string, number>;
    byStatus: Record<string, number>;
    new7d: number;
  };
  users: { total: number; active7d: number; active30d: number; new7d: number; platformStaff: number };
  aiRuns: {
    today: number;
    todayFailed: number;
    last7d: number;
    byStatus7d: StatusCounts;
    failureRate7d: number | null;
  };
  agentRuns: { last7d: number; byStatus7d: StatusCounts; failureRate7d: number | null };
  crawlJobs: { last7d: number; byStatus7d: StatusCounts; failureRate7d: number | null };
  stuckJobs: { thresholdMinutes: number; total: number; byType: Record<JobType, number> };
  leads: { new7d: number; bySource7d: StatusCounts } | null;
  snapshots: { last7d: number; byStatus7d: StatusCounts };
}

// ── /capabilities ──────────────────────────────────────────────────────────

export type CapabilityStatus = "working" | "partial" | "blocked" | "stub";
export type CapabilityGroup = "Core product" | "Intelligence" | "Execution" | "Growth & revenue" | "Platform";

export interface CapabilityDependency {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  severity: "required" | "degrades" | "stub";
  source: "live" | "static";
}

export interface Capability {
  key: string;
  name: string;
  group: CapabilityGroup;
  status: CapabilityStatus;
  summary: string;
  dependencies: CapabilityDependency[];
}

export interface CapabilitiesResponse {
  checkedAt: string;
  cached: boolean;
  summary: Record<CapabilityStatus, number>;
  capabilities: Capability[];
}

// ── /orgs ──────────────────────────────────────────────────────────────────

export const ORG_KINDS = ["customer", "agency", "internal"] as const;
export const ORG_STATUSES = ["active", "cancelled"] as const;
export const PLAN_TIERS = ["free", "starter", "growth", "pro", "agency", "managed", "enterprise"] as const;

export interface PlatformOrgListItem {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  plan: string | null;
  subscriptionStatus: string | null;
  memberCount: number;
  createdAt: string;
  deletedAt: string | null;
  lastActivityAt: string | null;
  brand: { id: string; name: string; websiteUrl: string | null } | null;
}

export interface UsageMetric {
  used: number | null;
  limit: number | null;
}

export type UsageKey =
  | "competitors_tracked"
  | "queries_per_query_set"
  | "ai_queries_per_month"
  | "team_members"
  | "pages_analyzed"
  | "snapshots_per_month"
  | "agent_runs_per_month"
  | "autonomy_level_max"
  | "client_accounts";

export interface AgencyLink {
  id: string;
  status: string;
  accessLevel: string;
  relationshipType: string;
  consentedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  org: { id: string; name: string; slug: string; kind: string };
}

export interface PlatformOrgDetail {
  organization: { id: string; name: string; slug: string; kind: string; status: string; createdAt: string; deletedAt: string | null };
  subscription: {
    plan: string;
    planName: string | null;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelledAt: string | null;
    hasExternalCustomer: boolean;
  } | null;
  plan: { slug: string; limits: Record<UsageKey, number | null> };
  usage: Record<UsageKey, UsageMetric>;
  members: {
    userId: string;
    name: string;
    email: string;
    role: string;
    platformRole: string;
    lastLoginAt: string | null;
    joinedAt: string;
  }[];
  brand: { id: string; name: string; websiteUrl: string | null; industries: string[]; categories: string[]; createdAt: string } | null;
  recentRuns: {
    aiRuns: {
      id: string;
      status: string;
      providers: string[];
      totalJobs: number;
      completedJobs: number;
      failedJobs: number;
      aiVisibilityScore: number | null;
      error: string | null;
      createdAt: string;
      completedAt: string | null;
    }[];
    crawlJobs: {
      id: string;
      status: string;
      rootUrl: string;
      pagesCrawled: number;
      pagesFound: number;
      pagesFailed: number;
      error: string | null;
      createdAt: string;
      completedAt: string | null;
    }[];
    agentRuns: {
      id: string;
      agentName: string;
      status: string;
      triggeredBy: string;
      stepsCompleted: number;
      totalSteps: number;
      error: string | null;
      createdAt: string;
      completedAt: string | null;
    }[];
  };
  agencyLinks: { asAgency: AgencyLink[]; asClient: AgencyLink[] };
  recentAudit: {
    id: string;
    createdAt: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorType: string;
    actorRole: string | null;
    result: string;
    userId: string | null;
    userEmail: string | null;
  }[];
}

// ── /users ─────────────────────────────────────────────────────────────────

export const PLATFORM_ROLES = ["none", "support", "admin"] as const;

export interface PlatformUserListItem {
  id: string;
  email: string;
  name: string;
  platformRole: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  membershipCount: number;
}

export interface PlatformUserDetail {
  user: {
    id: string;
    email: string;
    name: string;
    platformRole: string;
    emailVerified: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    deletedAt: string | null;
  };
  memberships: {
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    organizationKind: string;
    organizationStatus: string;
    role: string;
    joinedAt: string;
  }[];
  recentAuthEvents: { id: string; eventType: string; createdAt: string; ipAddress: string | null; userAgent: string | null }[];
  recentAudit: { id: string; createdAt: string; action: string; entityType: string; entityId: string | null; organizationId: string | null; result: string }[];
}

export interface MagicLinkSentResponse {
  sent: true;
  userId: string;
  email: string;
}

// ── /agencies ──────────────────────────────────────────────────────────────

export const AGENCY_LINK_STATUSES = ["pending", "active", "paused", "terminated", "revoked"] as const;

export interface PlatformAgencyListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  memberCount: number;
  createdAt: string;
  clientCounts: Record<string, number>;
  totalClients: number;
}

export interface PlatformAgencyClient {
  linkId: string;
  status: string;
  accessLevel: string;
  relationshipType: string;
  consentedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  client: { id: string; name: string; slug: string; kind: string; status: string; deletedAt: string | null };
}

export interface PlatformAgencyClientsResponse extends Paginated<PlatformAgencyClient> {
  agency: { id: string; name: string; slug: string; kind: string };
}

// ── /jobs ──────────────────────────────────────────────────────────────────

export interface PlatformJob {
  type: JobType;
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  status: string;
  label: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  progress: { done: number; total: number | null; failed: number | null } | null;
  stuck: boolean;
  cancellable: boolean;
}

export interface CancelJobResponse {
  type: JobType;
  id: string;
  previousStatus: string;
  status: string;
  error: string;
}

/** Every status any job table can hold (apps/api/src/routes/platform/jobs.ts JOB_SPECS). */
export const JOB_STATUSES = ["queued", "running", "pending", "processing", "completed", "complete", "failed", "cancelled"] as const;

// ── /audit ─────────────────────────────────────────────────────────────────

export interface PlatformAuditItem {
  source: "app" | "platform";
  id: string;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorType: string | null;
  actorRole: string | null;
  result: string | null;
  details: Record<string, unknown> | null;
  platformRole: string | null;
  method: string | null;
  path: string | null;
  targetUserId: string | null;
}

// ── /growth/snapshots ──────────────────────────────────────────────────────

export const SNAPSHOT_STATUSES = ["pending", "processing", "complete", "failed"] as const;

export interface PlatformSnapshotRequest {
  id: string;
  domain: string;
  email: string;
  status: string;
  marketingConsent: boolean;
  aiVisibilityScore: number | null;
  error: string | null;
  convertedToOrgId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lead: { id: string; name: string; email: string; company: string | null; status: string; createdAt: string } | null;
}
