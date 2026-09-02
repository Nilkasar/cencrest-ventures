import { apiClient, ApiError } from "@/lib/api-client";
import { QUERY_CATEGORIES } from "./types";
import type { PlanTier, Query, QueryCategory, QueryIntentType, QueryPriority, QuerySet } from "./types";

/**
 * The Query Universe's data-access seam — same shape as `data/crm/client.ts`
 * and (the closest real precedent) `lib/onboarding-client.ts`: every screen
 * calls through here, never a fixture or `apiClient` directly.
 *
 * Post-verification fix (qa-flow-tester pass — see
 * `docs/epics/05-intent-query-universe-frontend.md`'s "Post-verification
 * fixes" section): this file used to be a self-contained in-memory fixture
 * store (`seed.ts` + `generator.ts`, both now removed — nothing else
 * imported them) with zero calls to `apiClient`, even though
 * `apps/api/src/routes/query-sets.ts`'s real, tested routes
 * (`/brands/me/query-sets/...`) existed the whole time. Every exported
 * function keeps its original name and signature except `fetchQueryUniverse`
 * and `generateQuerySet`, which drop their now-meaningless `brandId`
 * parameter — the real API scopes to the caller's org's one brand
 * implicitly (same "single-brand-per-org" convention every other epic's
 * routes use), so there is nothing for the frontend to pass. Neither call
 * site (`query-universe-view.tsx`) ever passed one.
 */

export class QueryLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly plan: PlanTier,
  ) {
    super(`You've reached this set's ${limit.toLocaleString()}-query limit for the ${plan} plan.`);
    this.name = "QueryLimitError";
  }
}

// ── Wire shapes returned by apps/api's serializers (camelCase, whitelisted
// fields — see routes/query-sets.ts's `serializeQuerySet`/`serializeQuery`) ─

interface ApiQuerySet {
  id: string;
  name: string;
  description: string | null;
  queryCount: number;
  version: number;
  status: QuerySet["status"];
  planTier: PlanTier;
  planLimit: number;
  potentialCount: number;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}

interface ApiQuery {
  id: string;
  querySetId: string;
  text: string;
  // The backend keeps these nullable in the schema (see
  // packages/database/DECISIONS.md §18) but both write routes now guarantee
  // a non-null value on every row this API creates — `mapQuery` below falls
  // back defensively rather than trusting that at the type level.
  intentType: QueryIntentType | null;
  category: string | null;
  tags: string[];
  priority: QueryPriority;
  source: "generated" | "manual";
  createdAt: string;
  updatedAt: string;
}

interface ApiErrorBody {
  message?: string;
  limit?: number;
  plan?: PlanTier;
}

function mapQuerySet(api: ApiQuerySet): QuerySet {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    queryCount: api.queryCount,
    version: api.version,
    status: api.status,
    planTier: api.planTier,
    planLimit: api.planLimit,
    potentialCount: api.potentialCount,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
    activatedAt: api.activatedAt,
    archivedAt: api.archivedAt,
  };
}

/** `category` is only closed to the ten template values by convention (the
 *  manual-add dialog's `<Select>` only offers those ten) — the backend
 *  itself stores it as an open string (a human curator may use any label,
 *  see DECISIONS.md §16). A row outside the ten falls back to `"category"`
 *  rather than producing a `QueryCategory` value the UI's lookup tables
 *  (`QUERY_CATEGORY_META`, etc.) don't have an entry for. */
function mapQuery(api: ApiQuery): Query {
  return {
    id: api.id,
    querySetId: api.querySetId,
    text: api.text,
    intentType: api.intentType ?? "informational",
    category: isQueryCategory(api.category) ? api.category : "category",
    tags: api.tags,
    priority: api.priority,
    source: api.source,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

const QUERY_CATEGORY_SET = new Set<string>(QUERY_CATEGORIES);

function isQueryCategory(value: string | null): value is QueryCategory {
  return value !== null && QUERY_CATEGORY_SET.has(value);
}

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** Rethrows a 402 (entitlement) as `QueryLimitError`; anything else is
 *  rethrown as-is — same shape as `onboarding-client.ts`'s
 *  `translateError`. */
function translateError(err: unknown): never {
  if (err instanceof ApiError && err.status === 402) {
    const body = err.body as ApiErrorBody | undefined;
    throw new QueryLimitError(body?.limit ?? 0, body?.plan ?? "free");
  }
  throw err;
}

export interface QueryUniverseSnapshot {
  /** The set currently open for curation, if any. */
  draft: QuerySet | null;
  /** The set live downstream epics (7/GEO, 4/SEO) would consume. */
  active: QuerySet | null;
  /** Superseded sets, newest first. */
  archived: QuerySet[];
  /** `draft ?? active` — whichever set the main review list renders. */
  focused: QuerySet | null;
  /** `focused`'s queries only. */
  queries: Query[];
}

/** Mirrors `GET /brands/me/query-sets` (+ `GET .../:id/queries` for the
 *  focused set) — the full snapshot the review screen renders. A 404 on the
 *  list call means "no brand profile yet" (Epic 2 not completed), not an
 *  error: it resolves to an all-empty snapshot so the screen just shows its
 *  empty state rather than an error panel. */
export async function fetchQueryUniverse(): Promise<QueryUniverseSnapshot> {
  let sets: QuerySet[];
  try {
    const apiSets = await apiClient.get<ApiQuerySet[]>("/brands/me/query-sets");
    sets = apiSets.map(mapQuerySet);
  } catch (err) {
    if (isNotFound(err)) {
      return { draft: null, active: null, archived: [], focused: null, queries: [] };
    }
    throw err;
  }

  const draft = sets.find((s) => s.status === "draft") ?? null;
  const active = sets.find((s) => s.status === "active") ?? null;
  const archived = sets.filter((s) => s.status === "archived").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const focused = draft ?? active;

  let queries: Query[] = [];
  if (focused) {
    const apiQueries = await apiClient.get<ApiQuery[]>(`/brands/me/query-sets/${focused.id}/queries`);
    queries = apiQueries.map(mapQuery);
  }

  return { draft, active, archived, focused, queries };
}

/** Mirrors `POST /brands/me/query-sets/generate` — the template generator,
 *  entitlement-capped server-side, returns a fresh `draft` set. */
export async function generateQuerySet(): Promise<QueryUniverseSnapshot> {
  try {
    await apiClient.post("/brands/me/query-sets/generate", {});
  } catch (err) {
    translateError(err);
  }
  return fetchQueryUniverse();
}

export interface NewQueryInput {
  text: string;
  category: QueryCategory;
  intentType: QueryIntentType;
  priority: QueryPriority;
}

/** Mirrors `POST /brands/me/query-sets/:id/queries` — draft-only and
 *  entitlement-capped server-side (a 409/402 surfaces as an `ApiError`/
 *  `QueryLimitError` respectively). */
export async function addQuery(querySetId: string, input: NewQueryInput): Promise<Query> {
  try {
    const created = await apiClient.post<ApiQuery>(`/brands/me/query-sets/${querySetId}/queries`, {
      text: input.text,
      category: input.category,
      intentType: input.intentType,
      priority: input.priority,
    });
    return mapQuery(created);
  } catch (err) {
    return translateError(err);
  }
}

/** Mirrors `DELETE /brands/me/query-sets/:id/queries/:queryId` — soft
 *  delete, draft-only server-side. */
export async function removeQuery(querySetId: string, queryId: string): Promise<void> {
  await apiClient.delete(`/brands/me/query-sets/${querySetId}/queries/${queryId}`);
}

/** Mirrors `PATCH /brands/me/query-sets/:id/activate` — draft → active. The
 *  backend archives the brand's previously-active set (if any) in the same
 *  transaction (post-verification fix — see
 *  `docs/epics/05-intent-query-universe-backend.md`), so there is nothing
 *  left for this client to orchestrate client-side. */
export async function activateQuerySet(querySetId: string): Promise<QuerySet> {
  try {
    const updated = await apiClient.patch<ApiQuerySet>(`/brands/me/query-sets/${querySetId}/activate`);
    return mapQuerySet(updated);
  } catch (err) {
    return translateError(err);
  }
}

/** Mirrors `PATCH /brands/me/query-sets/:id/archive`. */
export async function archiveQuerySet(querySetId: string): Promise<QuerySet> {
  try {
    const updated = await apiClient.patch<ApiQuerySet>(`/brands/me/query-sets/${querySetId}/archive`);
    return mapQuerySet(updated);
  } catch (err) {
    return translateError(err);
  }
}
