import { apiClient, ApiError } from "@/lib/api-client";
import type {
  KeywordGroup,
  OpportunityStatus,
  SeoAnalyzeResult,
  SeoKeyword,
  SeoKeywordConfidence,
  SeoKeywordIntent,
  SeoOpportunity,
} from "./types";

/**
 * The SEO Intelligence data-access seam — same role `data/query-universe/client.ts`
 * and `data/website/client.ts` play for their epics: every screen calls
 * through here, never `apiClient` directly. Calls the real, tested routes
 * (`apps/api/src/routes/seo.ts`, mounted at `/brands/me/seo`) from the first
 * line — there is no fixture layer here, not even temporarily.
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
    const value = (err.body as { error?: unknown }).error;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function errorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "message" in err.body) {
    const value = (err.body as { message?: unknown }).message;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export class NoBrandProfileError extends Error {
  constructor() {
    super("Complete your brand profile before running SEO Intelligence.");
    this.name = "NoBrandProfileError";
  }
}

export type AnalyzeBlockedReason = "no_crawl_data" | "no_pages_crawled";

/** Thrown when `POST /analyze` 422s because there's nothing to analyze yet
 *  — distinct from a real failure, this is "the prerequisite step (crawl
 *  your site) hasn't happened," which the UI shows as a directed empty
 *  state, not an error panel. */
export class AnalyzeBlockedError extends Error {
  constructor(
    public readonly reason: AnalyzeBlockedReason,
    message: string,
  ) {
    super(message);
    this.name = "AnalyzeBlockedError";
  }
}

/** Thrown when `POST /keyword-groups/generate` 422s with `no_candidates` —
 *  the brand has no `categories`/`use_cases` yet for the generator to read. */
export class NoKeywordCandidatesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoKeywordCandidatesError";
  }
}

/** Every route in `routes/seo.ts` 404s with the exact same `NO_BRAND_ERROR`
 *  body (`{ error: "Brand profile not found" }`) when the caller's org has
 *  no brand at all — translated into a typed error every screen can branch
 *  on, the same shape `data/query-universe/client.ts`'s `translateError`
 *  gives `QueryLimitError`. A 404 with a DIFFERENT body (`"Keyword group not
 *  found"` etc. — a specific row missing, not the brand) is rethrown as-is;
 *  callers show a generic retry for that case. */
function translateSharedError(err: unknown): never {
  if (isNotFound(err) && errorCode(err) === "Brand profile not found") {
    throw new NoBrandProfileError();
  }
  throw err;
}

// ── POST /analyze ────────────────────────────────────────────────────────

/** Runs the technical + content checklist against the brand's most recent
 *  crawl. Always creates fresh `seo_analyses` rows server-side (see
 *  `docs/epics/04-seo-intelligence-backend.md` — re-running is not a no-op,
 *  it re-scores); there is no `GET` history route for these, so this
 *  client's only view of past results is whatever the last call returned
 *  (matches `POST /keyword-groups/generate`'s same "the action response IS
 *  the data" shape). */
export async function runSeoAnalysis(): Promise<SeoAnalyzeResult> {
  try {
    return await apiClient.post<SeoAnalyzeResult>("/brands/me/seo/analyze", {});
  } catch (err) {
    if (isNotFound(err)) return translateSharedError(err);
    if (err instanceof ApiError && err.status === 422) {
      const code = errorCode(err);
      if (code === "no_crawl_data" || code === "no_pages_crawled") {
        throw new AnalyzeBlockedError(code, errorMessage(err) ?? "Run a crawl before analyzing this brand's SEO.");
      }
    }
    throw err;
  }
}

// ── Page metadata (for the technical-analysis drill-down) ──────────────────
// `technicalAnalyses` rows only carry a `pageId` — no URL/title, since
// `seo_analyses` doesn't duplicate that. `GET /brands/me/pages` is the real
// source (same route Epic 3's `data/website/client.ts` reads), paginated the
// same way that file's own `fetchAllPagesForJob` is — kept as a small local
// copy here (only `id`/`url`/`title` needed) rather than importing Epic 3's
// private helper, so this epic's frontend doesn't reach into another epic's
// module internals for three fields.

export interface PageSummary {
  id: string;
  url: string;
  title: string | null;
}

interface ApiPageSummary {
  id: string;
  url: string;
  title: string | null;
}

interface ApiPagesResponse {
  pages: ApiPageSummary[];
  pagination: { total: number; limit: number; offset: number };
}

export async function listPageSummariesForCrawlJob(crawlJobId: string): Promise<Map<string, PageSummary>> {
  const limit = 100;
  let offset = 0;
  const summaries = new Map<string, PageSummary>();
  for (;;) {
    const query = new URLSearchParams({ crawlJobId, limit: String(limit), offset: String(offset) });
    const response = await apiClient.get<ApiPagesResponse>(`/brands/me/pages?${query.toString()}`);
    for (const page of response.pages) summaries.set(page.id, { id: page.id, url: page.url, title: page.title });
    offset += response.pages.length;
    if (response.pages.length === 0 || offset >= response.pagination.total) break;
  }
  return summaries;
}

// ── keyword_groups CRUD ──────────────────────────────────────────────────

export async function listKeywordGroups(): Promise<KeywordGroup[]> {
  try {
    return await apiClient.get<KeywordGroup[]>("/brands/me/seo/keyword-groups");
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

export async function createKeywordGroup(name: string): Promise<KeywordGroup> {
  try {
    return await apiClient.post<KeywordGroup>("/brands/me/seo/keyword-groups", { name });
  } catch (err) {
    return translateSharedError(err);
  }
}

export async function renameKeywordGroup(id: string, name: string): Promise<KeywordGroup> {
  try {
    return await apiClient.patch<KeywordGroup>(`/brands/me/seo/keyword-groups/${id}`, { name });
  } catch (err) {
    return translateSharedError(err);
  }
}

export async function deleteKeywordGroup(id: string): Promise<void> {
  try {
    await apiClient.delete(`/brands/me/seo/keyword-groups/${id}`);
  } catch (err) {
    translateSharedError(err);
  }
}

export interface GenerateKeywordGroupResult {
  keywordGroup: KeywordGroup;
  keywords: SeoKeyword[];
  opportunities: SeoOpportunity[];
}

/** `POST /keyword-groups/generate` — reads the brand's real `categories[]` +
 *  `use_cases` (never a fixture — end-to-end flow step 2's hard
 *  requirement), scores an opportunity for every resulting keyword in the
 *  same call. */
export async function generateKeywordGroup(name?: string): Promise<GenerateKeywordGroupResult> {
  try {
    return await apiClient.post<GenerateKeywordGroupResult>(
      "/brands/me/seo/keyword-groups/generate",
      name ? { name } : {},
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 422 && errorCode(err) === "no_candidates") {
      throw new NoKeywordCandidatesError(
        errorMessage(err) ?? "Add categories or use cases to your brand profile first.",
      );
    }
    return translateSharedError(err);
  }
}

// ── keywords CRUD (scoped to a keyword_group) ───────────────────────────

export async function listKeywords(groupId: string): Promise<SeoKeyword[]> {
  try {
    return await apiClient.get<SeoKeyword[]>(`/brands/me/seo/keyword-groups/${groupId}/keywords`);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

export interface NewKeywordInput {
  text: string;
  intent?: SeoKeywordIntent;
  monthlyVolume?: number | null;
  difficulty?: number | null;
  confidence?: SeoKeywordConfidence;
}

export async function addKeyword(groupId: string, input: NewKeywordInput): Promise<SeoKeyword> {
  try {
    return await apiClient.post<SeoKeyword>(`/brands/me/seo/keyword-groups/${groupId}/keywords`, input);
  } catch (err) {
    return translateSharedError(err);
  }
}

export type KeywordUpdateInput = Partial<NewKeywordInput>;

export async function updateKeyword(groupId: string, keywordId: string, patch: KeywordUpdateInput): Promise<SeoKeyword> {
  try {
    return await apiClient.patch<SeoKeyword>(`/brands/me/seo/keyword-groups/${groupId}/keywords/${keywordId}`, patch);
  } catch (err) {
    return translateSharedError(err);
  }
}

export async function removeKeyword(groupId: string, keywordId: string): Promise<void> {
  try {
    await apiClient.delete(`/brands/me/seo/keyword-groups/${groupId}/keywords/${keywordId}`);
  } catch (err) {
    translateSharedError(err);
  }
}

// ── seo_opportunities — list (server-sorted), get, dismiss ─────────────────

export interface ListOpportunitiesParams {
  status?: OpportunityStatus;
  limit?: number;
  offset?: number;
}

export interface OpportunitiesPage {
  opportunities: SeoOpportunity[];
  pagination: { total: number; limit: number; offset: number };
}

/** Sorted server-side by `opportunity_score` desc (tiebreak `created_at`
 *  asc, then `id` asc) — never re-sorted client-side, per the epic's
 *  end-to-end flow step 4's explicit requirement that the API's own
 *  ordering is authoritative. */
export async function listOpportunities(params: ListOpportunitiesParams = {}): Promise<OpportunitiesPage> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  try {
    return await apiClient.get<OpportunitiesPage>(`/brands/me/seo/opportunities?${query.toString()}`);
  } catch (err) {
    if (isNotFound(err)) {
      return { opportunities: [], pagination: { total: 0, limit: params.limit ?? 50, offset: 0 } };
    }
    throw err;
  }
}

export async function getOpportunity(id: string): Promise<SeoOpportunity> {
  return apiClient.get<SeoOpportunity>(`/brands/me/seo/opportunities/${id}`);
}

export async function dismissOpportunity(id: string): Promise<SeoOpportunity> {
  return apiClient.patch<SeoOpportunity>(`/brands/me/seo/opportunities/${id}/dismiss`);
}
