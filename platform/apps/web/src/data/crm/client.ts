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
 * The CRM's data-access seam. Every screen calls through here, wired
 * against `platform/apps/api`'s real Epic 1 routes:
 *
 *   GET/POST   /api/leads[/:id]              -> fetchLeads/fetchLead/createLead
 *   PATCH      /api/leads/:id                -> updateLeadStatus
 *   POST       /api/leads/:id/convert        -> convertLead
 *   GET/POST   /api/deals[/:id]              -> fetchDeals/fetchDeal/createDeal
 *   POST       /api/deals/:id/stage          -> updateDealStage
 *   GET        /api/accounts[/:orgId]        -> fetchAccounts/fetchAccount
 *   GET/POST   /api/activities               -> fetchActivitiesForX, logActivity
 *   GET        /api/crm/users                -> fetchCrmUsers
 *
 * The routes are NOT namespaced under `/crm` (except the staff roster) —
 * they're mounted flat at `/api/leads`, `/api/deals`, `/api/activities`,
 * `/api/accounts` (see `apps/api/src/app.ts`).
 *
 * Three things this file deliberately no longer does, because the API now
 * answers them directly:
 *
 *   1. Resolve staff names. Every list/detail response carries the
 *      resolved person (`assignedToUser`, `owner`, `actor`), so a screen
 *      no longer waits on `GET /orgs` → `GET /orgs/:slug/members` before it
 *      can render a row. That was two extra serialized requests per screen.
 *   2. Filter or search in the browser. `q`, `leadId` and
 *      `accountOrganizationId` are real query parameters now, so a search
 *      matches every row in the database rather than only the first page
 *      that happened to be fetched.
 *   3. Re-read a lead and its new account after converting it. `POST
 *      /leads/:id/convert` returns both.
 *
 * CRM is an internal BeBest ops tool, not scoped to a customer org
 * (`apps/api/src/middleware/crm-access.ts`) — every route below requires
 * the caller's *currently selected* org (the access token's org claim) to
 * be BeBest's own internal operations org, set once via `CRM_INTERNAL_ORG_ID`.
 * `crmRequest` below translates the specific 403/409/500 that produces into
 * a message `ErrorPanel` can show as-is.
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
// Shared shapes

/** How the API returns a person on any CRM row. */
interface RawUserRef {
  id: string;
  name: string;
  email: string;
}

function toUserRef(raw: RawUserRef | null | undefined): CrmUserRef | null {
  return raw ? { id: raw.id, name: raw.name } : null;
}

interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

/** A page of results plus the counters a `<Pagination>` control needs. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export const DEFAULT_PAGE_SIZE = 25;

function pageParams(params: URLSearchParams, page: number, limit: number): URLSearchParams {
  params.set("page", String(page));
  params.set("limit", String(limit));
  return params;
}

// ---------------------------------------------------------------------------
// Staff roster (assignee/owner pickers)
//
// One request to a route that knows which org is the internal ops org,
// instead of the client discovering it by trying each org it belongs to.
// Cached for the tab's lifetime — staff rosters change rarely mid-session.

interface RawCrmUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

let crmUsersCache: CrmUserRef[] | null = null;
let crmUsersInFlight: Promise<CrmUserRef[]> | null = null;

/** BeBest staff, for assignee/owner pickers. Never throws — a failure here
 *  degrades to an empty picker rather than taking down the screen that
 *  merely wanted to offer one. */
export async function fetchCrmUsers(): Promise<CrmUserRef[]> {
  if (crmUsersCache) return crmUsersCache;
  if (!crmUsersInFlight) {
    crmUsersInFlight = apiClient
      .get<{ data: RawCrmUser[] }>("/crm/users")
      .then(({ data }) => data.map((user) => ({ id: user.id, name: user.name })))
      .catch(() => [])
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
  assignedToUser: RawUserRef | null;
  snapshotId: string | null;
  convertedOrganizationId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapLead(raw: RawLead): Lead {
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
    assignedTo: toUserRef(raw.assignedToUser),
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
  page?: number;
  limit?: number;
}

/** Counts across the whole filtered set, not just the current page — the
 *  API computes them alongside the page (see `routes/leads.ts`). */
export type LeadStatusCounts = Record<LeadStatus, number>;

export interface LeadPage extends Page<Lead> {
  statusCounts: LeadStatusCounts;
}

export async function fetchLeads(filters: LeadFilters = {}): Promise<LeadPage> {
  return crmRequest(async () => {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.source && filters.source !== "all") params.set("source", filters.source);
    if (filters.assignedTo && filters.assignedTo !== "all") params.set("assignedTo", filters.assignedTo);
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    pageParams(params, filters.page ?? 1, filters.limit ?? DEFAULT_PAGE_SIZE);

    const response = await apiClient.get<Paginated<RawLead> & { statusCounts: LeadStatusCounts }>(
      `/leads?${params}`,
    );
    return {
      items: response.data.map(mapLead),
      page: response.page,
      limit: response.limit,
      total: response.total,
      statusCounts: response.statusCounts,
    };
  });
}

export async function fetchLead(id: string): Promise<Lead | null> {
  return crmRequest(async () => {
    try {
      return mapLead(await apiClient.get<RawLead>(`/leads/${id}`));
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
  return crmRequest(async () =>
    mapLead(
      await apiClient.post<RawLead>("/leads", {
        email: input.email,
        name: input.name,
        company: input.company.trim() || undefined,
        website: normalizeUrl(input.website),
        notes: input.notes.trim() || undefined,
        source: input.source,
      }),
    ),
  );
}

export async function updateLeadStatus(id: string, status: LeadStatus): Promise<Lead> {
  return crmRequest(async () => mapLead(await apiClient.patch<RawLead>(`/leads/${id}`, { status })));
}

interface ConvertLeadResponse {
  leadId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  convertedAt: string;
  lead: RawLead;
}

export async function convertLead(id: string): Promise<{ lead: Lead; account: Account }> {
  return crmRequest(async () => {
    const before = await apiClient.get<RawLead>(`/leads/${id}`);
    const organizationName = before.company?.trim() || before.name;

    const converted = await apiClient.post<ConvertLeadResponse>(`/leads/${id}/convert`, {
      organizationName,
    });

    // Everything the caller needs is in the conversion response: the
    // updated lead, and the organization it became. Re-reading either one
    // would only add a round trip to a flow the user is waiting on.
    const lead = mapLead(converted.lead);
    return {
      lead,
      account: {
        id: converted.organizationId,
        name: converted.organizationName,
        slug: converted.organizationSlug,
        plan: null,
        domain: null,
        contacts: leadContact({ id: lead.id, name: lead.name, email: lead.email }),
        convertedFromLeadId: lead.id,
        createdAt: converted.convertedAt,
      },
    };
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
  owner: RawUserRef | null;
  lead: { id: string; name: string; company: string | null } | null;
  account: { id: string; name: string; slug: string } | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapDeal(raw: RawDeal): Deal {
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
    owner: toUserRef(raw.owner) ?? { id: raw.ownerId, name: "Unknown teammate" },
    // Resolved by the API in the same query as the deal itself — the board
    // no longer fetches every lead and every account to label a card.
    linkedTo: raw.account
      ? { kind: "account", id: raw.account.id, name: raw.account.name }
      : raw.lead
        ? { kind: "lead", id: raw.lead.id, name: raw.lead.company ?? raw.lead.name }
        : null,
    lostReason: raw.lostReason,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export interface DealFilters {
  stage?: DealStage | "all";
  ownerId?: string | "all";
  q?: string;
  page?: number;
  limit?: number;
}

/** The deals board renders every stage at once, so it asks for the API's
 *  maximum page. `total` still comes back, so the board can say so honestly
 *  when there are more deals than one page holds. */
export const DEALS_BOARD_PAGE_SIZE = 100;

export async function fetchDeals(filters: DealFilters = {}): Promise<Page<Deal>> {
  return crmRequest(async () => {
    const params = new URLSearchParams();
    if (filters.stage && filters.stage !== "all") params.set("stage", filters.stage);
    if (filters.ownerId && filters.ownerId !== "all") params.set("ownerId", filters.ownerId);
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    pageParams(params, filters.page ?? 1, filters.limit ?? DEALS_BOARD_PAGE_SIZE);

    const response = await apiClient.get<Paginated<RawDeal>>(`/deals?${params}`);
    return {
      items: response.data.map(mapDeal),
      page: response.page,
      limit: response.limit,
      total: response.total,
    };
  });
}

export async function fetchDeal(id: string): Promise<Deal | null> {
  return crmRequest(async () => {
    try {
      return mapDeal(await apiClient.get<RawDeal>(`/deals/${id}`));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  });
}

async function listDealsBy(params: URLSearchParams): Promise<Deal[]> {
  pageParams(params, 1, DEALS_BOARD_PAGE_SIZE);
  const { data } = await apiClient.get<Paginated<RawDeal>>(`/deals?${params}`);
  return data.map(mapDeal).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function fetchDealsForLead(leadId: string): Promise<Deal[]> {
  return crmRequest(() => listDealsBy(new URLSearchParams({ leadId })));
}

export async function fetchDealsForAccount(accountId: string): Promise<Deal[]> {
  return crmRequest(() =>
    listDealsBy(new URLSearchParams({ accountOrganizationId: accountId })),
  );
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
  return crmRequest(async () =>
    mapDeal(
      await apiClient.post<RawDeal>("/deals", {
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
    ),
  );
}

/** Stage transitions are always audit-logged server-side
 *  (`POST /deals/:id/stage`, `auditLog({ action: 'deal.stage_changed' })`)
 *  per `docs/epics/01-crm.md` ("treat 'moved a $65k deal to Won' as
 *  privileged") — this is the only path that can change `stage`; the plain
 *  `PATCH /deals/:id` rejects a `stage` field outright. */
export async function updateDealStage(id: string, stage: DealStage, lostReason?: string): Promise<Deal> {
  return crmRequest(async () =>
    mapDeal(await apiClient.post<RawDeal>(`/deals/${id}/stage`, { stage, lostReason })),
  );
}

// ---------------------------------------------------------------------------
// Accounts
//
// "Accounts" isn't a table on the real backend — `GET /accounts[/:orgId]`
// assembles a read view over `organizations` + the `leads` row that
// converted into it (`apps/api/src/routes/accounts.ts`'s own doc comment).
// Two fields on `Account` can't be reconciled against that real shape:
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
  leadName: string;
  leadEmail: string;
  leadCompany: string | null;
}

interface RawAccountDetail {
  organization: { id: string; name: string; slug: string; createdAt: string };
  lead: {
    id: string;
    email: string;
    name: string;
    company: string | null;
    source: string;
    convertedAt: string | null;
  };
  deals: unknown[];
  activities: unknown[];
}

function leadContact(lead: { id: string; name: string; email: string } | null | undefined): AccountContact[] {
  if (!lead) return [];
  return [{ id: `contact_${lead.id}`, name: lead.name, email: lead.email, role: null, phone: null, primary: true }];
}

export interface AccountFilters {
  q?: string;
  page?: number;
  limit?: number;
}

export async function fetchAccounts(filters: AccountFilters = {}): Promise<Page<Account>> {
  return crmRequest(async () => {
    const params = new URLSearchParams();
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    pageParams(params, filters.page ?? 1, filters.limit ?? DEFAULT_PAGE_SIZE);
    const response = await apiClient.get<Paginated<RawAccountListItem>>(`/accounts?${params}`);

    const items: Account[] = response.data
      .filter((item): item is RawAccountListItem & { organizationId: string } => item.organizationId !== null)
      .map((item) => ({
        id: item.organizationId,
        name: item.name ?? item.leadCompany ?? item.leadName,
        slug: item.slug ?? "",
        plan: null,
        domain: null,
        contacts: leadContact({ id: item.leadId, name: item.leadName, email: item.leadEmail }),
        convertedFromLeadId: item.leadId,
        createdAt: item.convertedAt ?? new Date(0).toISOString(),
      }));

    return { items, page: response.page, limit: response.limit, total: response.total };
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
  actor: RawUserRef | null;
  createdAt: string;
}

function mapActivity(raw: RawActivity): Activity {
  return {
    id: raw.id,
    type: raw.type,
    subject: raw.subject ?? "",
    body: raw.body,
    metadata: (raw.metadata as Record<string, unknown> | null) ?? undefined,
    actor: toUserRef(raw.actor),
    createdAt: raw.createdAt,
    leadId: raw.leadId,
    organizationId: raw.accountOrganizationId,
  };
}

const ACTIVITY_PAGE_SIZE = 100;

async function listActivities(query: Record<string, string>): Promise<Activity[]> {
  const params = pageParams(new URLSearchParams(query), 1, ACTIVITY_PAGE_SIZE);
  const { data } = await apiClient.get<Paginated<RawActivity>>(`/activities?${params}`);
  return data.map(mapActivity).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
}

export async function logActivity(input: LogActivityInput): Promise<Activity> {
  return crmRequest(async () =>
    mapActivity(
      await apiClient.post<RawActivity>("/activities", {
        type: input.type,
        subject: input.subject.trim() || undefined,
        body: input.body.trim() || undefined,
        leadId: input.leadId ?? undefined,
        dealId: input.dealId ?? undefined,
        accountOrganizationId: input.organizationId ?? undefined,
      }),
    ),
  );
}
