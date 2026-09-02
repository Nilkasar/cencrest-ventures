import { ApiError } from "@/lib/api-client";
import { currentOrganization } from "@/data/fixtures";
import { NORTHWIND_GENERATION_SEED } from "./seed";
import { generateQueryCandidates } from "./generator";
import { queryLimitFor } from "./constants";
import type { PlanTier, Query, QueryCategory, QueryIntentType, QueryPriority, QuerySet } from "./types";

/**
 * The Query Universe's data-access seam — same shape as `data/crm/client.ts`:
 * every screen calls through here, never the seed/generator directly, so
 * wiring `platform/apps/api`'s real routes later (`POST /brands/:id/
 * query-sets/generate`, `query-sets` list/get/activate/archive, `queries`
 * list/add/edit/remove — see the epic's "API surface") is a swap inside
 * these functions, not a rewrite of any component. Until then: an in-memory
 * store, mutated directly, behind a simulated network delay.
 */

const LATENCY_MS = 400;

/** Same convention as `data/crm/client.ts`'s `?bbDemoError=1`. */
function shouldSimulateError(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("bbDemoError") === "1";
}

/** `?bbDemoPlan=free|starter|growth|pro|agency|managed|enterprise` overrides
 *  `currentOrganization.plan` for this screen only — lets you see the
 *  entitlement cap actually bind (Northwind's brand profile produces more
 *  candidates than the Free or Starter tier allows) without needing a
 *  second fixture organization. Falls back to the real plan for any
 *  missing/invalid value. */
function resolvePlanTier(): PlanTier {
  const validPlans: PlanTier[] = ["free", "starter", "growth", "pro", "agency", "managed", "enterprise"];
  if (typeof window !== "undefined") {
    const override = new URLSearchParams(window.location.search).get("bbDemoPlan");
    if (override && (validPlans as string[]).includes(override)) return override as PlanTier;
  }
  return currentOrganization.plan;
}

async function simulate<T>(value: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (shouldSimulateError()) {
    throw new ApiError(
      "The query universe service didn't respond in time. (Simulated via ?bbDemoError=1 — remove it to clear.)",
      503,
    );
  }
  return value;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string, store: { id: string }[]): string {
  return `${prefix}_${store.length + 1}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Thrown when an action would take a `query_sets` row past its plan's cap —
 *  the epic brief's "reject with a clear, specific error naming the limit
 *  and the upgrade path" (same posture as Epic 2's `EntitlementError`). */
export class QueryLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly plan: PlanTier,
  ) {
    super(`You've reached this set's ${limit.toLocaleString()}-query limit for the ${plan} plan.`);
    this.name = "QueryLimitError";
  }
}

export const DEFAULT_BRAND_ID = "brand_fixture_northwind";

let querySetStore: QuerySet[] = [];
let queryStore: Query[] = [];

export interface QueryUniverseSnapshot {
  /** The set currently open for curation, if any. */
  draft: QuerySet | null;
  /** The set live downstream epics (7/GEO, 4/SEO) would consume. */
  active: QuerySet | null;
  /** Superseded sets, newest first — kept for the version history the
   *  activation lifecycle implies (a new draft's activation archives the
   *  previously active set rather than silently overwriting it). */
  archived: QuerySet[];
  /** `draft ?? active` — whichever set the main review list renders. */
  focused: QuerySet | null;
  /** `focused`'s queries only. */
  queries: Query[];
}

function snapshotFor(brandId: string): QueryUniverseSnapshot {
  const sets = querySetStore.filter((s) => s.brandId === brandId);
  const draft = sets.find((s) => s.status === "draft") ?? null;
  const active = sets.find((s) => s.status === "active") ?? null;
  const archived = sets
    .filter((s) => s.status === "archived")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const focused = draft ?? active;
  const queries = focused
    ? queryStore
        .filter((q) => q.querySetId === focused.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  return { draft: clone(draft), active: clone(active), archived: clone(archived), focused: clone(focused), queries: clone(queries) };
}

export async function fetchQueryUniverse(brandId: string = DEFAULT_BRAND_ID): Promise<QueryUniverseSnapshot> {
  return simulate(snapshotFor(brandId));
}

/**
 * Runs the template generator against the (fixture) brand profile,
 * entitlement-capped, and returns a fresh `draft` set — mirrors
 * `POST /brands/:id/query-sets/generate`. Replaces any existing draft (a
 * user reviewing an unactivated draft who regenerates is discarding it, not
 * appending to it); a still-`active` set for the brand is left untouched —
 * activating the new draft is what retires it (see `activateQuerySet`).
 */
export async function generateQuerySet(brandId: string = DEFAULT_BRAND_ID): Promise<QueryUniverseSnapshot> {
  const existing = querySetStore.filter((s) => s.brandId === brandId);
  const activeSet = existing.find((s) => s.status === "active");
  const priorDraft = existing.find((s) => s.status === "draft");

  const plan = resolvePlanTier();
  const limit = queryLimitFor(plan);
  const { candidates, potentialCount } = generateQueryCandidates(NORTHWIND_GENERATION_SEED, limit);

  // Discard the prior draft (and its queries) — see doc comment above.
  if (priorDraft) {
    querySetStore = querySetStore.filter((s) => s.id !== priorDraft.id);
    queryStore = queryStore.filter((q) => q.querySetId !== priorDraft.id);
  }

  const version = priorDraft ? priorDraft.version : activeSet ? activeSet.version + 1 : 1;
  const now = nowIso();
  const querySet: QuerySet = {
    id: nextId("qset", querySetStore),
    brandId,
    organizationId: currentOrganization.id,
    name: `Query Universe v${version}`,
    description: `Generated from your brand profile — ${NORTHWIND_GENERATION_SEED.categories.join(", ")}.`,
    queryCount: candidates.length,
    version,
    status: "draft",
    planTier: plan,
    planLimit: limit,
    potentialCount,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
  };

  const queries: Query[] = candidates.map((c, index) => ({
    id: `qry_${version}_${index + 1}_${Math.random().toString(36).slice(2, 7)}`,
    querySetId: querySet.id,
    text: c.text,
    intentType: c.intentType,
    category: c.category,
    tags: c.tags,
    priority: c.priority,
    source: "generated",
    createdAt: now,
    updatedAt: now,
  }));

  querySetStore = [...querySetStore, querySet];
  queryStore = [...queryStore, ...queries];

  return simulate(snapshotFor(brandId));
}

export interface NewQueryInput {
  text: string;
  category: QueryCategory;
  intentType: QueryIntentType;
  priority: QueryPriority;
}

/** Manual curation — "add missing ones" per the epic's UI surface. Only
 *  valid against a `draft` set; an `active` set's version is frozen (see
 *  `types.ts`'s `QuerySet.version` doc comment). */
export async function addQuery(querySetId: string, input: NewQueryInput): Promise<Query> {
  const set = querySetStore.find((s) => s.id === querySetId);
  if (!set) throw new ApiError(`Query set ${querySetId} not found`, 404);
  if (set.status !== "draft") {
    throw new ApiError(`"${set.name}" is ${set.status} — only a draft set can be edited.`, 409);
  }
  const text = input.text.trim();
  if (!text) throw new Error("Enter the query text.");
  const existingQueries = queryStore.filter((q) => q.querySetId === querySetId);
  if (existingQueries.some((q) => q.text.toLowerCase() === text.toLowerCase())) {
    throw new Error("That query is already in this set.");
  }
  if (set.queryCount >= set.planLimit) {
    throw new QueryLimitError(set.planLimit, set.planTier);
  }

  const now = nowIso();
  const query: Query = {
    id: nextId("qry", queryStore),
    querySetId,
    text,
    intentType: input.intentType,
    category: input.category,
    tags: [input.category, "manual"],
    priority: input.priority,
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
  queryStore = [...queryStore, query];
  set.queryCount = existingQueries.length + 1;
  set.updatedAt = now;

  return simulate(clone(query));
}

/** Removes an irrelevant query — "remove irrelevant queries" per the epic's
 *  UI surface. Same draft-only guard as `addQuery`. */
export async function removeQuery(querySetId: string, queryId: string): Promise<void> {
  const set = querySetStore.find((s) => s.id === querySetId);
  if (!set) throw new ApiError(`Query set ${querySetId} not found`, 404);
  if (set.status !== "draft") {
    throw new ApiError(`"${set.name}" is ${set.status} — only a draft set can be edited.`, 409);
  }
  const before = queryStore.length;
  queryStore = queryStore.filter((q) => q.id !== queryId);
  if (queryStore.length === before) throw new ApiError(`Query ${queryId} not found`, 404);

  set.queryCount = queryStore.filter((q) => q.querySetId === querySetId).length;
  set.updatedAt = nowIso();
  await simulate(undefined);
}

/**
 * `draft` → `active`, freezing `version`. Per DoD #4: activating one set
 * archives whatever was previously active for the same brand instead of
 * letting two sets claim "active" at once — Epic 6/7 consume exactly one
 * active query_set per brand.
 */
export async function activateQuerySet(querySetId: string): Promise<QuerySet> {
  const set = querySetStore.find((s) => s.id === querySetId);
  if (!set) throw new ApiError(`Query set ${querySetId} not found`, 404);
  if (set.status !== "draft") {
    throw new ApiError(`"${set.name}" is already ${set.status}.`, 409);
  }
  if (set.queryCount === 0) {
    throw new Error("Add at least one query before activating this set.");
  }

  const now = nowIso();
  for (const other of querySetStore) {
    if (other.brandId === set.brandId && other.status === "active") {
      other.status = "archived";
      other.archivedAt = now;
      other.updatedAt = now;
    }
  }
  set.status = "active";
  set.activatedAt = now;
  set.updatedAt = now;

  return simulate(clone(set));
}

/** Retires a set — a `draft` being discarded, or an `active` set being
 *  taken out of service without a replacement ready yet. */
export async function archiveQuerySet(querySetId: string): Promise<QuerySet> {
  const set = querySetStore.find((s) => s.id === querySetId);
  if (!set) throw new ApiError(`Query set ${querySetId} not found`, 404);
  if (set.status === "archived") {
    throw new ApiError(`"${set.name}" is already archived.`, 409);
  }
  const now = nowIso();
  set.status = "archived";
  set.archivedAt = now;
  set.updatedAt = now;
  return simulate(clone(set));
}
