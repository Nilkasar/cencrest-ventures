/**
 * CRM domain types — mirror `docs/epics/01-crm.md`'s domain model 1:1 so the
 * fixture data in `fixtures.ts` and the real `@bebest/api` responses (once
 * Epic 1's backend half lands) can share a contract without these types, or
 * the components that consume them, changing.
 *
 * Field names are camelCase here (vs. the spec's snake_case DB columns) —
 * that's the one deliberate transform this layer makes; `client.ts` is
 * where a real API response gets mapped into this shape.
 */

import type { Organization } from "@/data/types";

export type LeadSource = "free_snapshot" | "apply_form" | "direct" | "referral";
export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";

/** The ordered pipeline a lead moves through. "lost" is a branch reachable
 *  from any non-terminal state, not a step in this sequence. */
export const LEAD_STATUS_SEQUENCE: LeadStatus[] = ["new", "contacted", "qualified", "converted"];

export interface CrmUserRef {
  id: string;
  name: string;
}

export interface Lead {
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
  /** 0–100, or null when a lead hasn't been scored yet (e.g. added manually,
   *  no snapshot run against it). */
  score: number | null;
  assignedTo: CrmUserRef | null;
  createdAt: string;
  updatedAt: string;
  convertedAt: string | null;
  /** Set only on conversion — the tenant organization this lead became. */
  organizationId: string | null;
  snapshotId: string | null;
}

export type ActivityType = "note" | "email" | "call" | "snapshot_requested" | "signup";

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  /** Freeform, e.g. `{ dealId: "deal_2" }` to scope a note to a deal even
   *  though activities attach to a lead or an org, per the domain model. */
  metadata?: Record<string, unknown>;
  actor: CrmUserRef | null;
  createdAt: string;
  leadId: string | null;
  organizationId: string | null;
}

export type DealStage = "new" | "qualifying" | "proposal" | "negotiation" | "won" | "lost";

export const DEAL_STAGE_SEQUENCE: DealStage[] = [
  "new",
  "qualifying",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

export const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  new: "New",
  qualifying: "Qualifying",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export interface Deal {
  id: string;
  organizationId: string | null;
  leadId: string | null;
  title: string;
  valueCents: number;
  currency: string;
  stage: DealStage;
  probability: number;
  expectedCloseDate: string | null;
  owner: CrmUserRef;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `data/types.ts`'s `Organization["plan"]` exactly — an account
 *  literally is an organization for CRM purposes, so this is a type alias,
 *  not a parallel enum that could drift from it. */
export type AccountPlan = Organization["plan"];

export interface AccountContact {
  id: string;
  name: string;
  email: string;
  role: string | null;
  phone: string | null;
  primary: boolean;
}

/**
 * A thin view over `organizations`, per the Epic 1 spec's model decision —
 * there is no separate `accounts` table. `id`/`name`/`slug`/`plan` mirror
 * `organizations`; everything else (contacts, convertedFromLeadId) is
 * CRM-surface-only composition the account detail read assembles.
 */
export interface Account {
  id: string;
  name: string;
  slug: string;
  plan: AccountPlan;
  domain: string | null;
  contacts: AccountContact[];
  convertedFromLeadId: string | null;
  createdAt: string;
}
