import { apiClient, ApiError } from "@/lib/api-client";
import type { AiRun, AiRunResponsesPage, AiRunScore, AiVisibilityQueryMeta } from "./types";

/**
 * The AI Visibility Engine's data-access seam — same role as
 * `data/website/client.ts`/`data/query-universe/client.ts`: every screen
 * calls through here, never `apiClient` directly. Calls
 * `platform/apps/api`'s real, tested routes from the first line — no
 * fixture layer, per the epic's standing rule:
 *
 *   GET  /api/brands/me/ai-runs            -> listAiRuns()
 *   POST /api/brands/me/ai-runs            -> startAiRun()
 *   GET  /api/ai-runs/:id                  -> getAiRun()
 *   GET  /api/ai-runs/:id/score            -> getAiRunScore()
 *   GET  /api/ai-runs/:id/responses        -> getAiRunResponses() / getAllAiRunResponses()
 *   GET  /api/brands/me/query-sets/:id/queries -> getQuerySetQueries() (for intent/text labels only)
 *
 * All five `ai-runs`/`ai-run-details` routes resolve "the" brand from the
 * caller's own org server-side (the established `/brands/me/*` convention)
 * — no `brandId` is ever sent on the wire, so none of these functions take
 * one.
 */

/** Thrown when `POST /brands/me/ai-runs` is rejected by the
 *  `ai_queries_per_month` entitlement (402 `ai_query_limit_reached`) —
 *  BEFORE any `ai_runs` row exists or any provider is called (the epic's
 *  end-to-end flow step 1's literal invariant). Mirrors
 *  `query-universe/client.ts`'s `QueryLimitError`. */
export class AiQueryLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
    public readonly requested: number,
    public readonly plan: string,
    public readonly upgradeTo: string | null,
  ) {
    super(
      `Your ${plan} plan allows up to ${limit.toLocaleString()} AI queries per month (this run would use ${requested.toLocaleString()}, and you've already used ${current.toLocaleString()} this month).${
        upgradeTo ? ` Upgrade to ${upgradeTo} for a higher limit.` : ""
      }`,
    );
    this.name = "AiQueryLimitError";
  }
}

/** Thrown for the two PREPARE-step errors the backend names specifically
 *  (`no_active_query_set` / `query_set_empty`) so the empty state can tell
 *  a user exactly what to fix instead of a generic failure message. */
export class AiRunPreconditionError extends Error {
  constructor(
    public readonly code: "no_active_query_set" | "query_set_empty" | "no_brand",
    message: string,
  ) {
    super(message);
    this.name = "AiRunPreconditionError";
  }
}

interface StartAiRunErrorBody {
  error?: string;
  message?: string;
  limit?: number;
  current?: number;
  requested?: number;
  plan?: string;
  upgradeTo?: string | null;
}

function translateStartError(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as StartAiRunErrorBody | undefined;
    if (err.status === 402 && body?.error === "ai_query_limit_reached") {
      throw new AiQueryLimitError(body.limit ?? 0, body.current ?? 0, body.requested ?? 0, body.plan ?? "free", body.upgradeTo ?? null);
    }
    if (err.status === 404 && body?.error === "no_active_query_set") {
      throw new AiRunPreconditionError("no_active_query_set", body.message ?? "This brand has no active query set.");
    }
    if (err.status === 422 && body?.error === "query_set_empty") {
      throw new AiRunPreconditionError("query_set_empty", body.message ?? "The active query set has no queries.");
    }
    if (err.status === 404) {
      throw new AiRunPreconditionError("no_brand", "Complete brand onboarding before running AI Visibility.");
    }
  }
  throw err;
}

/** Newest first. A 404 means "no brand profile yet" (Epic 2 not completed)
 *  — resolves to an empty list rather than an error, same convention
 *  `fetchQueryUniverse` uses, so the screen just shows its empty state. */
export async function listAiRuns(): Promise<AiRun[]> {
  try {
    return await apiClient.get<AiRun[]>("/brands/me/ai-runs");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export async function getLatestAiRun(): Promise<AiRun | null> {
  const runs = await listAiRuns();
  return runs[0] ?? null;
}

export async function getAiRun(id: string): Promise<AiRun> {
  return apiClient.get<AiRun>(`/ai-runs/${id}`);
}

/** Kicks off a run against the brand's active query set. Body-less POST —
 *  the backend resolves brand/query-set/providers itself. Rethrows the
 *  entitlement/precondition failures as the typed errors above; anything
 *  else propagates as a plain `ApiError`. */
export async function startAiRun(): Promise<AiRun> {
  try {
    return await apiClient.post<AiRun>("/brands/me/ai-runs");
  } catch (err) {
    translateStartError(err);
  }
}

/** Always 200, even mid-run (`computed: false`) — poll it exactly like run
 *  status, no special-casing "not ready yet" as an error. */
export async function getAiRunScore(id: string): Promise<AiRunScore> {
  return apiClient.get<AiRunScore>(`/ai-runs/${id}/score`);
}

export interface ResponsesQuery {
  limit?: number;
  offset?: number;
  queryId?: string;
  provider?: string;
  extractionStatus?: string;
}

/** One page of the raw-response explorer, filtered server-side by
 *  `queryId`/`provider`/`extractionStatus` exactly as `routes/ai-run-details.ts`
 *  accepts them. Every item embeds its (at most one) `brand_observations`
 *  row inline — this is the endpoint that lets the UI walk
 *  score -> observation -> raw response in one request per page. */
export async function getAiRunResponses(id: string, params: ResponsesQuery = {}): Promise<AiRunResponsesPage> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.queryId) qs.set("queryId", params.queryId);
  if (params.provider) qs.set("provider", params.provider);
  if (params.extractionStatus) qs.set("extractionStatus", params.extractionStatus);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClient.get<AiRunResponsesPage>(`/ai-runs/${id}/responses${suffix}`);
}

const AGGREGATE_PAGE_SIZE = 200;
/** A sane ceiling on how many responses the client-side aggregate panels
 *  (model breakdown, intent breakdown, citation map, sentiment mix) will
 *  hold in memory and recompute on every poll tick. A Pro-tier run can be
 *  thousands of jobs (`docs/12-ai/AI_ARCHITECTURE.md`'s "5,600 jobs"
 *  example); the raw-response *explorer* stays server-paginated regardless
 *  (`getAiRunResponses` above) — this cap only bounds the summary panels. */
const AGGREGATE_FETCH_CAP = 2000;

export interface AllResponsesResult {
  items: AiRunResponsesPage["items"];
  total: number;
  /** True when `total` exceeds `AGGREGATE_FETCH_CAP` — the summary panels
   *  are computed over `items.length` of `total` responses, not all of
   *  them, and say so. */
  truncated: boolean;
}

/** Fetches every response for a run, up to `AGGREGATE_FETCH_CAP`, for the
 *  panels that need the full set to aggregate over (not just one page). */
export async function getAllAiRunResponses(id: string): Promise<AllResponsesResult> {
  const first = await getAiRunResponses(id, { limit: AGGREGATE_PAGE_SIZE, offset: 0 });
  const items = [...first.items];
  while (items.length < first.total && items.length < AGGREGATE_FETCH_CAP) {
    const page = await getAiRunResponses(id, { limit: AGGREGATE_PAGE_SIZE, offset: items.length });
    if (page.items.length === 0) break;
    items.push(...page.items);
  }
  return { items, total: first.total, truncated: first.total > items.length };
}

interface ApiQuerySetQuery {
  id: string;
  text: string;
  intentType: AiVisibilityQueryMeta["intentType"];
  category: string | null;
}

/** `GET /brands/me/query-sets/:id/queries` — used here only to label a
 *  response's query (text + intent type) for the "score by intent" panel
 *  and the response explorer's query column. A 404 (query set archived out
 *  from under an old run, or genuinely gone) degrades to an empty map
 *  rather than an error — every panel that consumes this falls back to
 *  showing the bare query id when a label is missing. */
export async function getQuerySetQueries(querySetId: string): Promise<AiVisibilityQueryMeta[]> {
  try {
    const rows = await apiClient.get<ApiQuerySetQuery[]>(`/brands/me/query-sets/${querySetId}/queries`);
    return rows.map((r) => ({ id: r.id, text: r.text, intentType: r.intentType, category: r.category }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}
