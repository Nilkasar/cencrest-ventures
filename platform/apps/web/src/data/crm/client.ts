import { ApiError } from "@/lib/api-client";
import { accounts, activities, crmUsers, deals, leads } from "./fixtures";
import type {
  Account,
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
 * The CRM's data-access seam. Every screen calls through here, never
 * `fixtures.ts` directly — so wiring `platform/apps/api`'s real routes
 * (built in parallel this epic) is a one-line change per function, e.g.:
 *
 *   export async function fetchLeads(filters?: LeadFilters): Promise<Lead[]> {
 *     return apiClient.get<Lead[]>(`/crm/leads?${toQuery(filters)}`);
 *   }
 *
 * Until then: an in-memory copy of the fixtures, mutated directly, behind a
 * simulated network delay. Mutations persist for the life of the browser
 * tab (not across a hard refresh) — enough to make convert/log-activity/
 * change-stage feel real when clicking through the app, without pretending
 * there's a database underneath.
 */

const LATENCY_MS = 450;

/** Append `?bbDemoError=1` to any CRM URL to see the error state + retry
 *  path on every list/detail screen without a real backend to fail against. */
function shouldSimulateError(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("bbDemoError") === "1";
}

async function simulate<T>(value: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (shouldSimulateError()) {
    throw new ApiError(
      "The CRM service didn't respond in time. (Simulated via ?bbDemoError=1 — remove it to clear.)",
      503,
    );
  }
  return value;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

let leadStore = clone(leads);
let dealStore = clone(deals);
let accountStore = clone(accounts);
let activityStore = clone(activities);

function nextId(prefix: string, store: { id: string }[]): string {
  return `${prefix}_${store.length + 1}_${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Leads

export interface LeadFilters {
  status?: LeadStatus | "all";
  source?: LeadSource | "all";
  assignedTo?: string | "all";
  q?: string;
}

export async function fetchLeads(filters: LeadFilters = {}): Promise<Lead[]> {
  let results = clone(leadStore);
  if (filters.status && filters.status !== "all") {
    results = results.filter((lead) => lead.status === filters.status);
  }
  if (filters.source && filters.source !== "all") {
    results = results.filter((lead) => lead.source === filters.source);
  }
  if (filters.assignedTo && filters.assignedTo !== "all") {
    results = results.filter((lead) => lead.assignedTo?.id === filters.assignedTo);
  }
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
  return simulate(results);
}

export async function fetchLead(id: string): Promise<Lead | null> {
  const lead = leadStore.find((l) => l.id === id) ?? null;
  return simulate(lead ? clone(lead) : null);
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
  const lead: Lead = {
    id: nextId("lead", leadStore),
    email: input.email,
    name: input.name,
    company: input.company || null,
    website: input.website || null,
    category: null,
    notes: input.notes || null,
    source: input.source,
    sourceUrl: null,
    status: "new",
    score: null,
    assignedTo: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    convertedAt: null,
    organizationId: null,
    snapshotId: null,
  };
  leadStore = [lead, ...leadStore];
  return simulate(clone(lead));
}

export async function updateLeadStatus(id: string, status: LeadStatus): Promise<Lead> {
  const lead = leadStore.find((l) => l.id === id);
  if (!lead) throw new ApiError(`Lead ${id} not found`, 404);
  lead.status = status;
  lead.updatedAt = nowIso();
  return simulate(clone(lead));
}

export async function convertLead(id: string): Promise<{ lead: Lead; account: Account }> {
  const lead = leadStore.find((l) => l.id === id);
  if (!lead) throw new ApiError(`Lead ${id} not found`, 404);

  const organizationId = nextId("org", accountStore);
  lead.status = "converted";
  lead.convertedAt = nowIso();
  lead.organizationId = organizationId;
  lead.updatedAt = nowIso();

  const account: Account = {
    id: organizationId,
    name: lead.company ?? lead.name,
    slug: (lead.company ?? lead.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    plan: "starter",
    domain: lead.website,
    convertedFromLeadId: lead.id,
    createdAt: nowIso(),
    contacts: [{ id: nextId("ct", []), name: lead.name, email: lead.email, role: null, phone: null, primary: true }],
  };
  accountStore = [account, ...accountStore];

  activityStore = [
    {
      id: nextId("act", activityStore),
      type: "signup",
      subject: "Converted to a customer",
      body: null,
      actor: null,
      createdAt: nowIso(),
      leadId: null,
      organizationId,
    },
    ...activityStore,
  ];

  return simulate({ lead: clone(lead), account: clone(account) });
}

// ---------------------------------------------------------------------------
// Deals

export interface DealFilters {
  stage?: DealStage | "all";
  ownerId?: string | "all";
  q?: string;
}

export async function fetchDeals(filters: DealFilters = {}): Promise<Deal[]> {
  let results = clone(dealStore);
  if (filters.stage && filters.stage !== "all") {
    results = results.filter((deal) => deal.stage === filters.stage);
  }
  if (filters.ownerId && filters.ownerId !== "all") {
    results = results.filter((deal) => deal.owner.id === filters.ownerId);
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim().toLowerCase();
    results = results.filter((deal) => deal.title.toLowerCase().includes(q));
  }
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return simulate(results);
}

export async function fetchDeal(id: string): Promise<Deal | null> {
  const deal = dealStore.find((d) => d.id === id) ?? null;
  return simulate(deal ? clone(deal) : null);
}

export async function fetchDealsForLead(leadId: string): Promise<Deal[]> {
  const results = clone(dealStore).filter((deal) => deal.leadId === leadId);
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return simulate(results);
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
  const owner = crmUsers.find((u) => u.id === input.ownerId) ?? crmUsers[0]!;
  const deal: Deal = {
    id: nextId("deal", dealStore),
    organizationId: input.organizationId,
    leadId: input.leadId,
    title: input.title,
    valueCents: input.valueCents,
    currency: "USD",
    stage: input.stage,
    probability: input.probability,
    expectedCloseDate: input.expectedCloseDate,
    owner,
    lostReason: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  dealStore = [deal, ...dealStore];
  return simulate(clone(deal));
}

/** Stage transitions are audit-logged at the API layer per
 *  `docs/epics/01-crm.md` ("treat 'moved a $65k deal to Won' as
 *  privileged") — this stub only mutates local state, but the real
 *  handler is where that audit-log call belongs. */
export async function updateDealStage(id: string, stage: DealStage, lostReason?: string): Promise<Deal> {
  const deal = dealStore.find((d) => d.id === id);
  if (!deal) throw new ApiError(`Deal ${id} not found`, 404);
  deal.stage = stage;
  deal.updatedAt = nowIso();
  if (stage === "lost") {
    deal.lostReason = lostReason ?? deal.lostReason;
  } else if (stage === "won") {
    deal.probability = 100;
    deal.lostReason = null;
  }
  return simulate(clone(deal));
}

// ---------------------------------------------------------------------------
// Accounts

export async function fetchAccounts(): Promise<Account[]> {
  const results = clone(accountStore).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return simulate(results);
}

export async function fetchAccount(id: string): Promise<Account | null> {
  const account = accountStore.find((a) => a.id === id) ?? null;
  return simulate(account ? clone(account) : null);
}

export async function fetchDealsForAccount(accountId: string): Promise<Deal[]> {
  const results = clone(dealStore).filter((deal) => deal.organizationId === accountId);
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return simulate(results);
}

// ---------------------------------------------------------------------------
// Activities

export async function fetchActivitiesForLead(leadId: string): Promise<Activity[]> {
  const results = clone(activityStore)
    .filter((a) => a.leadId === leadId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return simulate(results);
}

export async function fetchActivitiesForAccount(organizationId: string): Promise<Activity[]> {
  const results = clone(activityStore)
    .filter((a) => a.organizationId === organizationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return simulate(results);
}

export async function fetchActivitiesForDeal(deal: Deal): Promise<Activity[]> {
  const results = clone(activityStore)
    .filter((a) => a.metadata?.dealId === deal.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return simulate(results);
}

export interface LogActivityInput {
  leadId?: string | null;
  organizationId?: string | null;
  dealId?: string | null;
  type: ActivityType;
  subject: string;
  body: string;
  actor: CrmUserRef;
}

export async function logActivity(input: LogActivityInput): Promise<Activity> {
  const activity: Activity = {
    id: nextId("act", activityStore),
    type: input.type,
    subject: input.subject,
    body: input.body || null,
    actor: input.actor,
    createdAt: nowIso(),
    leadId: input.leadId ?? null,
    organizationId: input.organizationId ?? null,
    metadata: input.dealId ? { dealId: input.dealId } : undefined,
  };
  activityStore = [activity, ...activityStore];
  return simulate(clone(activity));
}

// ---------------------------------------------------------------------------
// Shared reference data

export async function fetchCrmUsers(): Promise<CrmUserRef[]> {
  return simulate(clone(crmUsers));
}
