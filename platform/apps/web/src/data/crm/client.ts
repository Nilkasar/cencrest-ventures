import { apiClient, ApiError } from "@/lib/api-client";
import type {
  Account,
  AccountContact,
  Activity,
  ActivityType,
  CrmUserRef,
  Deal,
  DealStage,
  Lead,
  LeadSource,
  LeadStatus,
} from "./types";

/**
 * The CRM's data-access seam. Every screen calls through here, never a
 * fixture layer — wired against `platform/apps/api`'s real, tested Epic 1
 * routes:
 *
 *   GET/POST   /api/leads[/:id]              -> fetchLeads/fetchLead/createLead
 *   PATCH      /api/leads/:id                -> updateLeadStatus
 *   POST       /api/leads/:id/convert        -> convertLead
 *   GET/POST   /api/deals[/:id]              -> fetchDeals/fetchDeal/createDeal
 *   POST       /api/deals/:id/stage          -> updateDealStage
 *   GET        /api/accounts[/:orgId]        -> fetchAccounts/fetchAccount
 *   GET/POST   /api/activities               -> fetchActivitiesForLead/logActivity
 *
 * One correction versus this file's old header comment (written before the
 * backend existed): the routes are NOT namespaced under `/crm` — they're
 * mounted flat at `/api/leads`, `/api/deals`, `/api/activities`,
 * `/api/accounts` (see `apps/api/src/app.ts`). Paths below match that.
 *
 * CRM is an internal BeBest ops tool, not scoped to a customer org
 * (`apps/api/src/middleware/crm-access.ts`) — every route below requires
 * the caller's *currently selected* org (the access token's org claim) to
 * be BeBest's own internal operations org, set once via `CRM_INTERNAL_ORG_ID`.
 * `crmRequest` below translates the specific 403/409/500 that produces into
 * a message `ErrorPanel` can show as-is; see this file's `docs/epics/
 * 01-crm-frontend-rewire.md` write-up for the full reasoning, including why
 * the org switcher's "act as a client org" flow (Epic 18) and the CRM are
 * mutually exclusive in this v1.
 */

// ---------------------------------------------------------------------------
// Error translation — CRM-specific 403/409/500 bodies turned into messages
// `ErrorPanel`/toasts can show directly, instead of apiClient's generic
// "Request to X failed with 403".

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

function bodyError(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
    const value = (err.body as { error?: unknown }).error;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

async function crmRequest<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      const reason = bodyError(err);
      if (err.status === 403 && reason?.includes("internal operations organization")) {
        throw new ApiError(
          "CRM data belongs to BeBest's internal operations workspace. Switch back to your home organization to use it.",
          err.status,
          err.body,
        );
      }
      if (err.status === 409 && reason?.includes("No organization selected")) {
        throw new ApiError("Select an organization before opening the CRM.", err.status, err.body);
      }
      if (err.status === 500 && reason === "CRM is not configured on this server") {
        throw new ApiError(
          "CRM isn't configured on this environment yet — ask an admin to set CRM_INTERNAL_ORG_ID.",
          err.status,
          err.body,
        );
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Staff refs (assignee/owner/actor display)
//
// The real API has no dedicated "CRM users" endpoint — staff are simply
// members of the internal ops org, so this resolves names the same way a
// person would: list orgs the caller belongs to (`GET /orgs`), then that
// org's members (`GET /orgs/:slug/members`). CRM access requires the
// caller's org to be the internal ops org already (see module doc comment
// above), so in practice the first membership that answers is it; cached
// for the tab's lifetime since staff rosters change rarely mid-session.

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface OrgMember {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  joinedAt: string;
}

let crmUsersCache: CrmUserRef[] | null = null;
let crmUsersInFlight: Promise<CrmUserRef[]> | null = null;

async function loadCrmUsers(): Promise<CrmUserRef[]> {
  let orgs: OrgSummary[];
  try {
    orgs = await apiClient.get<OrgSummary[]>("/orgs");
  } catch {
    return [];
  }
  for (const org of orgs) {
    try {
      const members = await apiClient.get<OrgMember[]>(`/orgs/${org.slug}/members`);
      return members.map((m) => ({ id: m.userId, name: m.name?.trim() || m.email }));
    } catch {
      // Not the internal ops org (403) or some other transient read error —
      // try the next org this caller belongs to.
      continue;
    }
  }
  return [];
}

/** BeBest staff, for assignee/owner pickers and name display. Never throws —
 *  a resolution failure degrades to unresolved ids (see `userRefOrFallback`)
 *  rather than blocking the lead/deal/activity list it's used to decorate. */
export async function fetchCrmUsers(): Promise<CrmUserRef[]> {
  if (crmUsersCache) return crmUsersCache;
  if (!crmUsersInFlight) {
    crmUsersInFlight = loadCrmUsers()
      .then((users) => {
        crmUsersCache = users;
        return users;
      })
      .finally(() => {
        crmUsersInFlight = null;
      });
  }
  return crmUsersInFlight;
}

function userRefOrFallback(id: string, usersById: Map<string, CrmUserRef>): CrmUserRef {
  return usersById.get(id) ?? { id, name: "Unknown teammate" };
}

async function usersById(): Promise<Map<string, CrmUserRef>> {
  return new Map((await fetchCrmUsers()).map((u) => [u.id, u]));
}

// ---------------------------------------------------------------------------
// Shared helpers

function normalizeUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // The real `createLeadSchema` requires an absolute `.url()` — this UI's
  // input (`add-lead-dialog.tsx`) collects a bare domain like
  // "northwindlogistics.com", so a scheme is added here rather than making
  // every caller of `createLead` do it.
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

// The real list routes cap `limit` at 100 (`.max(100)`) and have no
// "give me everything" mode. These screens' existing signatures return a
// plain array (no pagination UI built yet), so every list fetch below asks
// for the max page size — an org with more than 100 leads/deals in one
// filtered view won't show the rest. Documented as a known gap in
// `docs/epics/01-crm-frontend-rewire.md`, not silently swallowed.
const MAX_PAGE_SIZE = "100";

// ---------------------------------------------------------------------------
// Leads

interface RawLead {
  id: string;
  email: string;
  name: string;
  company: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  source: LeadSource;
  sourceUrl: string | null;
  status: LeadStatus;
  score: number | null;
  assignedTo: string | null;
  snapshotId: string | null;
  convertedOrganizationId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapLead(raw: RawLead, users: Map<string, CrmUserRef>): Lead {
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    company: raw.company,
    website: raw.website,
    category: raw.category,
    notes: raw.notes,
    source: raw.source,
    sourceUrl: raw.sourceUrl,
    status: raw.status,
    score: raw.score,
    assignedTo: raw.assignedTo ? userRefOrFallback(raw.assignedTo, users) : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    convertedAt: raw.convertedAt,
    organizationId: raw.convertedOrganizationId,
    snapshotId: raw.snapshotId,
  };
}

export interface LeadFilters {
  status?: LeadStatus | "all";
  source?: LeadSource | "all";
  assignedTo?: string | "all";
  q?: string;
}

export async function fetchLeads(filters: LeadFilters = {}): Promise<Lead[]> {
  return crmRequest(async () => {
    const params = new URLSearchParams({ limit: MAX_PAGE_SIZE });
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.source && filters.source !== "all") params.set("source", filters.source);
    if (filters.assignedTo && filters.assignedTo !== "all") params.set("assignedTo", filters.assignedTo);

    const [{ data }, users] = await Promise.all([
      apiClient.get<Paginated<RawLead>>(`/leads?${params}`),
      usersById(),
    ]);

    let results = data.map((raw) => mapLead(raw, users));

    // No free-text search on the real `GET /leads` — filtered client-side
    // over the fetched page, same as the search-adjacent limitation above.
    if (filters.q?.trim()) {
      const q = filters.q.trim().toLowerCase();
      results = results.filter(
        (lead) =>
          lead.name.toLowerCase().includes(q) ||
          (lead.company ?? "").toLowerCase().includes(q) ||
          lead.email.toLowerCase().includes(q),
      );
    }

    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  });
}

export async function fetchLead(id: string): Promise<Lead | null> {
  return crmRequest(async () => {
    try {
      const [raw, users] = await Promise.all([apiClient.get<RawLead>(`/leads/${id}`), usersById()]);
      return mapLead(raw, users);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  });
}

export interface NewLeadInput {
  name: string;
  email: string;
  company: string;
  website: string;
  source: LeadSource;
  notes: string;
}

export async function createLead(input: NewLeadInput): Promise<Lead> {
  return crmRequest(async () => {
    const [raw, users] = await Promise.all([
      apiClient.post<RawLead>("/leads", {
        email: input.email,
        name: input.name,
        company: input.company.trim() || undefined,
        website: normalizeUrl(input.website),
        notes: input.notes.trim() || undefined,
        source: input.source,
      }),
      usersById(),
    ]);
    return mapLead(raw, users);
  });
}

export async function updateLeadStatus(id: string, status: LeadStatus): Promise<Lead> {
  return crmRequest(async () => {
    const [raw, users] = await Promise.all([
      apiClient.patch<RawLead>(`/leads/${id}`, { status }),
      usersById(),
    ]);
    return mapLead(raw, users);
  });
}

interface ConvertLeadResponse {
  leadId: string;
  organizationId: string;
  organizationName: string;
  convertedAt: string;
}

export async function convertLead(id: string): Promise<{ lead: Lead; account: Account }> {
  return crmRequest(async () => {
    const users = await usersById();
    const before = await apiClient.get<RawLead>(`/leads/${id}`);
    const organizationName = before.company?.trim() || before.name;

    const converted = await apiClient.post<ConvertLeadResponse>(`/leads/${id}/convert`, {
      organizationName,
    });

    const [afterRaw, account] = await Promise.all([
      apiClient.get<RawLead>(`/leads/${id}`),
      fetchAccount(converted.organizationId),
    ]);
    if (!account) {
      throw new ApiError("The account was created but couldn't be reloaded. Refresh to see it.", 500);
    }
    return { lead: mapLead(afterRaw, users), account };
  });
}

// ---------------------------------------------------------------------------
// Deals

interface RawDeal {
  id: string;
  leadId: string | null;
  accountOrganizationId: string | null;
  title: string;
  valueCents: number;
  currency: string;
  stage: DealStage;
  probability: number | null;
  expectedCloseDate: string | null;
  ownerId: string;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapDeal(raw: RawDeal, users: Map<string, CrmUserRef>): Deal {
  return {
    id: raw.id,
    organizationId: raw.accountOrganizationId,
    leadId: raw.leadId,
    title: raw.title,
    valueCents: raw.valueCents,
    currency: raw.currency,
    stage: raw.stage,
    // The real schema allows an unset `probability` (null) — every screen
    // that reads this field treats it as a plain number (e.g. the weighted
    // pipeline total, `{deal.probability}%`), so it's normalized to 0 here
    // rather than widening `Deal.probability` to `number | null` and
    // touching every one of those display sites.
    probability: raw.probability ?? 0,
    expectedCloseDate: raw.expectedCloseDate,
    owner: userRefOrFallback(raw.ownerId, users),
    lostReason: raw.lostReason,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export interface DealFilters {
  stage?: DealStage | "all";
  ownerId?: string | "all";
  q?: string;
}

async function listDeals(params: URLSearchParams, users: Map<string, CrmUserRef>): Promise<Deal[]> {
  const { data } = await apiClient.get<Paginated<RawDeal>>(`/deals?${params}`);
  return data.map((raw) => mapDeal(raw, users));
}

export async function fetchDeals(filters: DealFilters = {}): Promise<Deal[]> {
  return crmRequest(async () => {
    const params = new URLSearchParams({ limit: MAX_PAGE_SIZE });
    if (filters.stage && filters.stage !== "all") params.set("stage", filters.stage);
    if (filters.ownerId && filters.ownerId !== "all") params.set("ownerId", filters.ownerId);

    const users = await usersById();
    let results = await listDeals(params, users);

    // No free-text search on the real `GET /deals` either.
    if (filters.q?.trim()) {
      const q = filters.q.trim().toLowerCase();
      results = results.filter((deal) => deal.title.toLowerCase().includes(q));
    }

    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  });
}

export async function fetchDeal(id: string): Promise<Deal | null> {
  return crmRequest(async () => {
    try {
      const [raw, users] = await Promise.all([apiClient.get<RawDeal>(`/deals/${id}`), usersById()]);
      return mapDeal(raw, users);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  });
}

// `GET /deals` has no `leadId`/`accountOrganizationId` filter — these two
// fetch the (max-100) list and filter client-side, same page-size caveat as
// `fetchDeals` above.
export async function fetchDealsForLead(leadId: string): Promise<Deal[]> {
  return crmRequest(async () => {
    const users = await usersById();
    const results = (await listDeals(new URLSearchParams({ limit: MAX_PAGE_SIZE }), users)).filter(
      (deal) => deal.leadId === leadId,
    );
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  });
}

export async function fetchDealsForAccount(accountId: string): Promise<Deal[]> {
  return crmRequest(async () => {
    const users = await usersById();
    const results = (await listDeals(new URLSearchParams({ limit: MAX_PAGE_SIZE }), users)).filter(
      (deal) => deal.organizationId === accountId,
    );
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  });
}

export interface NewDealInput {
  title: string;
  leadId: string | null;
  organizationId: string | null;
  valueCents: number;
  stage: DealStage;
  probability: number;
  expectedCloseDate: string | null;
  ownerId: string;
}

export async function createDeal(input: NewDealInput): Promise<Deal> {
  return crmRequest(async () => {
    const [raw, users] = await Promise.all([
      apiClient.post<RawDeal>("/deals", {
        title: input.title,
        valueCents: input.valueCents,
        currency: "USD",
        stage: input.stage,
        probability: input.probability,
        expectedCloseDate: input.expectedCloseDate ?? undefined,
        ownerId: input.ownerId,
        leadId: input.leadId ?? undefined,
        accountOrganizationId: input.organizationId ?? undefined,
      }),
      usersById(),
    ]);
    return mapDeal(raw, users);
  });
}

/** Stage transitions are always audit-logged server-side
 *  (`POST /deals/:id/stage`, `auditLog({ action: 'deal.stage_changed' })`)
 *  per `docs/epics/01-crm.md` ("treat 'moved a $65k deal to Won' as
 *  privileged") — this is the only path that can change `stage`; the plain
 *  `PATCH /deals/:id` rejects a `stage` field outright. */
export async function updateDealStage(id: string, stage: DealStage, lostReason?: string): Promise<Deal> {
  return crmRequest(async () => {
    const [raw, users] = await Promise.all([
      apiClient.post<RawDeal>(`/deals/${id}/stage`, { stage, lostReason }),
      usersById(),
    ]);
    return mapDeal(raw, users);
  });
}

// ---------------------------------------------------------------------------
// Accounts
//
// "Accounts" isn't a table on the real backend — `GET /accounts[/:orgId]`
// assembles a read view over `organizations` + the `leads` row that
// converted into it (`apps/api/src/routes/accounts.ts`'s own doc comment).
// Two fields on `Account` can't be reconciled against that real shape (see
// `docs/epics/01-crm-frontend-rewire.md` for the full writeup):
//   - `plan`: no route lets internal CRM staff read another org's plan by
//     id — always `null` here, never a guess.
//   - `contacts`: the real schema has `crm_contacts`/`crm_notes` tables but
//     no route exposes them yet — the one contact this file CAN populate
//     (the converting lead's real name + email) is used instead of an
//     empty array, which is closer to the truth than either fabricating
//     contacts or hiding the tab.

interface RawAccountListItem {
  organizationId: string | null;
  name: string | null;
  slug: string | null;
  leadId: string;
  convertedAt: string | null;
}

interface RawAccountDetail {
  organization: { id: string; name: string; slug: string; createdAt: string };
  lead: { id: string; email: string; name: string; company: string | null; source: string; convertedAt: string | null };
  deals: unknown[];
  activities: unknown[];
}

function leadContact(lead: { id: string; name: string; email: string } | null | undefined): AccountContact[] {
  if (!lead) return [];
  return [{ id: `contact_${lead.id}`, name: lead.name, email: lead.email, role: null, phone: null, primary: true }];
}

export async function fetchAccounts(): Promise<Account[]> {
  return crmRequest(async () => {
    const [{ data }, { data: leadsData }] = await Promise.all([
      apiClient.get<Paginated<RawAccountListItem>>(`/accounts?limit=${MAX_PAGE_SIZE}`),
      apiClient.get<Paginated<RawLead>>(`/leads?limit=${MAX_PAGE_SIZE}`),
    ]);
    const leadById = new Map(leadsData.map((l) => [l.id, l]));

    const results: Account[] = data
      .filter((item): item is RawAccountListItem & { organizationId: string } => item.organizationId !== null)
      .map((item) => {
        const lead = leadById.get(item.leadId);
        return {
          id: item.organizationId,
          name: item.name ?? lead?.company ?? lead?.name ?? "Untitled account",
          slug: item.slug ?? "",
          plan: null,
          domain: null,
          contacts: leadContact(lead ? { id: lead.id, name: lead.name, email: lead.email } : null),
          convertedFromLeadId: item.leadId,
          createdAt: item.convertedAt ?? new Date(0).toISOString(),
        };
      });

    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  });
}

export async function fetchAccount(id: string): Promise<Account | null> {
  return crmRequest(async () => {
    try {
      const raw = await apiClient.get<RawAccountDetail>(`/accounts/${id}`);
      return {
        id: raw.organization.id,
        name: raw.organization.name,
        slug: raw.organization.slug,
        plan: null,
        domain: null,
        contacts: leadContact(raw.lead),
        convertedFromLeadId: raw.lead?.id ?? null,
        createdAt: raw.organization.createdAt,
      };
    } catch (err) {
      // Covers both "no such organization" (404) and "this organization has
      // no converted CRM lead, so it isn't a CRM account yet" (also a 404,
      // per `accounts.ts`) — both are legitimately "not found" from this
      // screen's point of view.
      if (isNotFound(err)) return null;
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Activities

interface RawActivity {
  id: string;
  leadId: string | null;
  dealId: string | null;
  accountOrganizationId: string | null;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  metadata: unknown;
  actorId: string | null;
  createdAt: string;
}

function mapActivity(raw: RawActivity, users: Map<string, CrmUserRef>): Activity {
  return {
    id: raw.id,
    type: raw.type,
    subject: raw.subject ?? "",
    body: raw.body,
    metadata: (raw.metadata as Record<string, unknown> | null) ?? undefined,
    actor: raw.actorId ? userRefOrFallback(raw.actorId, users) : null,
    createdAt: raw.createdAt,
    leadId: raw.leadId,
    organizationId: raw.accountOrganizationId,
  };
}

async function listActivities(query: Record<string, string>): Promise<Activity[]> {
  const params = new URLSearchParams({ ...query, limit: MAX_PAGE_SIZE });
  const [{ data }, users] = await Promise.all([
    apiClient.get<Paginated<RawActivity>>(`/activities?${params}`),
    usersById(),
  ]);
  return data.map((raw) => mapActivity(raw, users)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function fetchActivitiesForLead(leadId: string): Promise<Activity[]> {
  return crmRequest(() => listActivities({ leadId }));
}

export async function fetchActivitiesForAccount(organizationId: string): Promise<Activity[]> {
  return crmRequest(() => listActivities({ accountOrganizationId: organizationId }));
}

export async function fetchActivitiesForDeal(deal: Deal): Promise<Activity[]> {
  return crmRequest(() => listActivities({ dealId: deal.id }));
}

export interface LogActivityInput {
  leadId?: string | null;
  organizationId?: string | null;
  dealId?: string | null;
  type: ActivityType;
  subject: string;
  body: string;
  /** Unused by the real API — `POST /activities` derives the actor from the
   *  caller's auth token server-side (`c.get('user')`), never from the
   *  request body. Kept in this interface only so `log-activity-dialog.tsx`
   *  (which still sources it from the app-wide, still-fixture-backed
   *  `currentUser` — see `data/fixtures.ts`, outside this epic's scope)
   *  doesn't need to change; the returned `Activity.actor` is resolved from
   *  the real `actorId` the server recorded, not from this value. */
  actor: CrmUserRef;
}

export async function logActivity(input: LogActivityInput): Promise<Activity> {
  return crmRequest(async () => {
    const [raw, users] = await Promise.all([
      apiClient.post<RawActivity>("/activities", {
        type: input.type,
        subject: input.subject.trim() || undefined,
        body: input.body.trim() || undefined,
        leadId: input.leadId ?? undefined,
        dealId: input.dealId ?? undefined,
        accountOrganizationId: input.organizationId ?? undefined,
      }),
      usersById(),
    ]);
    return mapActivity(raw, users);
  });
}
