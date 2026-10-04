/**
 * Real persistence layer for Epic 2 (Brand Intelligence) onboarding + the
 * Settings > Brand profile tab, wired through `apiClient` against
 * `platform/apps/api`'s brand/competitor/use-case/brand-claim routes
 * (`src/routes/{brands,competitors,use-cases,brand-claims}.ts`).
 *
 * Post-verification fix: this file used to be a `localStorage`-only mock —
 * see `platform/docs/epics/02-brand-intelligence-frontend.md`'s
 * "Post-verification fixes" section for the full account of what changed
 * and why. Every exported function keeps its original name/signature (the
 * doc comment on the original file called this "a near-drop-in for a real
 * `apiClient` call" — it was), so no call site needed to change shape, only
 * `addCompetitor` (dropped its now-redundant `plan` argument — the
 * entitlement limit is enforced server-side, this file no longer needs to
 * pre-check it client-side to know which error to throw).
 *
 * Resumability ("leave mid-wizard, come back, resume") now comes from
 * re-fetching the brand + its children and DERIVING which steps are done
 * from what actually exists, not from a persisted "completedSteps" flag —
 * the API has no such field (there is no onboarding-progress table; the
 * spec's five tables are the only persisted state). Two steps have no
 * inherent minimum ("competitors" only blocks Continue at zero via this
 * app's own client-side rule, "claims" is genuinely optional per the epic
 * spec), so a small `localStorage` cache supplements the derivation for
 * exactly those steps' "visited with zero items" case — see
 * `readVisitedSteps`/`markVisited` below. This is the "optional local
 * draft/cache" the brief allowed for; it is never the only source for
 * anything the API can answer itself (brand fields, competitor/use-case/
 * claim rows, counts) — losing it just means a step you left empty asks
 * you to revisit it, not silent data loss.
 */

import { apiClient, ApiError } from "@/lib/api-client";
import type {
  Brand,
  BrandClaim,
  BrandProfile,
  Competitor,
  CompetitorPriority,
  OnboardingStepKey,
  Organization,
  UseCase,
} from "@/data/types";
import { ONBOARDING_STEP_KEYS } from "@/data/types";

export class EntitlementError extends Error {
  constructor(
    message: string,
    public readonly limit: number,
    public readonly plan: Organization["plan"],
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Wire shapes returned by apps/api's serializers (camelCase, whitelisted
// fields — see each route's `serialize*` function) ─────────────────────────

interface ApiBrand {
  id: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  industries: string[];
  categories: string[];
  markets: string[];
  aliases: string[];
  positioning: string | null;
  differentiators: string[];
  /** Epic 22 Phase 2 — null until `POST /brands/me/onboarding/complete`. */
  onboardingCompletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiCompetitor {
  id: string;
  name: string;
  websiteUrl: string | null;
  priority: CompetitorPriority;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

interface ApiUseCase {
  id: string;
  title: string;
  industries: string[];
  companySizes: string[];
  painPoints: string[];
  solutions: string[];
  createdAt: string;
  updatedAt: string;
}

interface ApiBrandClaim {
  id: string;
  claim: string;
  evidence: string | null;
  confidence: BrandClaim["confidence"];
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiErrorBody {
  message?: string;
  limit?: number;
  plan?: string;
}

function blankBrand(organizationId: string): Brand {
  const now = new Date().toISOString();
  return {
    id: "",
    organizationId,
    name: "",
    websiteUrl: "",
    description: "",
    industries: [],
    categories: [],
    markets: [],
    aliases: [],
    positioning: "",
    differentiators: [],
    createdAt: now,
    updatedAt: now,
  };
}

function mapBrand(api: ApiBrand, organizationId: string): Brand {
  return {
    id: api.id,
    organizationId,
    name: api.name,
    websiteUrl: api.websiteUrl ?? "",
    description: api.description ?? "",
    industries: api.industries ?? [],
    categories: api.categories ?? [],
    markets: api.markets ?? [],
    aliases: api.aliases ?? [],
    positioning: api.positioning ?? "",
    differentiators: api.differentiators ?? [],
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

function mapCompetitor(api: ApiCompetitor, brandId: string): Competitor {
  return {
    id: api.id,
    brandId,
    name: api.name,
    websiteUrl: api.websiteUrl ?? "",
    priority: api.priority,
    aliases: api.aliases ?? [],
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

function mapUseCase(api: ApiUseCase, brandId: string): UseCase {
  return {
    id: api.id,
    brandId,
    title: api.title,
    industries: api.industries ?? [],
    companySizes: api.companySizes ?? [],
    painPoints: api.painPoints ?? [],
    solutions: api.solutions ?? [],
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

function mapBrandClaim(api: ApiBrandClaim, brandId: string): BrandClaim {
  return {
    id: api.id,
    brandId,
    claim: api.claim,
    evidence: api.evidence ?? "",
    confidence: api.confidence,
    verified: api.verified,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** Rethrows a 402 (entitlement) as `EntitlementError` and a 422
 *  (validation) as `ValidationError`; anything else is rethrown as-is. */
function translateError(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as ApiErrorBody | undefined;
    if (err.status === 402) {
      throw new EntitlementError(
        body?.message ?? "You've reached your plan's tracked-competitor limit.",
        body?.limit ?? 0,
        (body?.plan as Organization["plan"] | undefined) ?? "free",
      );
    }
    if (err.status === 422) {
      throw new ValidationError(body?.message ?? "That didn't pass validation — check the highlighted fields.");
    }
  }
  throw err;
}

// ── `localStorage` cache — ONLY for the two things the API genuinely has no
// field for (see the file header). Never read as a substitute for real data
// that's available; only ever added on top of it. ──────────────────────────

// Completion itself is NOT here: it lives on the server
// (`brands.onboarding_completed_at`, Epic 22 Phase 2), so a second device
// sees it too. Only the "visited with zero items" hint stays local.
const VISITED_PREFIX = "bebest.onboarding-visited.v1.";

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readVisitedSteps(organizationId: string): Set<OnboardingStepKey> {
  if (!hasLocalStorage()) return new Set();
  try {
    const raw = window.localStorage.getItem(`${VISITED_PREFIX}${organizationId}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed as OnboardingStepKey[]) : new Set();
  } catch {
    return new Set();
  }
}

function markVisited(organizationId: string, step: OnboardingStepKey): void {
  if (!hasLocalStorage()) return;
  try {
    const visited = readVisitedSteps(organizationId);
    visited.add(step);
    window.localStorage.setItem(`${VISITED_PREFIX}${organizationId}`, JSON.stringify([...visited]));
  } catch {
    // Storage full/blocked — worst case this step re-prompts on next visit
    // if it has zero items. Not worth failing the save over.
  }
}

function deriveCompletedSteps(
  brand: Brand,
  competitors: Competitor[],
  useCases: UseCase[],
  brandClaims: BrandClaim[],
  visited: Set<OnboardingStepKey>,
): Record<OnboardingStepKey, boolean> {
  return {
    "brand-basics": brand.id !== "" && brand.name.trim() !== "",
    competitors: competitors.length > 0 || visited.has("competitors"),
    industry: brand.industries.length > 0,
    "use-cases": useCases.length >= 3,
    claims: brandClaims.length > 0 || visited.has("claims"),
  };
}

/** "completed" comes ONLY from the server's `onboardingCompletedAt` — every
 *  step being filled in is not the same as having finished (the Done step
 *  is what starts the first crawl and query set). */
function deriveStatus(
  completedSteps: Record<OnboardingStepKey, boolean>,
  onboardingCompletedAt: string | null | undefined,
): BrandProfile["status"] {
  if (onboardingCompletedAt) return "completed";
  return ONBOARDING_STEP_KEYS.some((key) => completedSteps[key]) ? "in_progress" : "not_started";
}

/** Fetches the brand + its competitors/use cases/claims and assembles the
 *  full `BrandProfile` the wizard and Settings panel render — the single
 *  real "load" path both share (via `useBrandProfile`). A 404 on
 *  `GET /brands/me` means "this org hasn't started onboarding yet," not an
 *  error: it resolves to a blank brand with nothing completed. */
export async function getBrandProfile(organizationId: string): Promise<BrandProfile> {
  let brand: Brand;
  let competitors: Competitor[] = [];
  let useCases: UseCase[] = [];
  let brandClaims: BrandClaim[] = [];

  let apiBrand: ApiBrand | null = null;
  try {
    apiBrand = await apiClient.get<ApiBrand>("/brands/me");
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  if (apiBrand) {
    brand = mapBrand(apiBrand, organizationId);
    const brandId = brand.id;
    const [competitorsResult, useCasesResult, claimsResult] = await Promise.all([
      apiClient.get<ApiCompetitor[]>("/brands/me/competitors").catch((err: unknown) => {
        if (isNotFound(err)) return [] as ApiCompetitor[];
        throw err;
      }),
      apiClient.get<ApiUseCase[]>("/brands/me/use-cases").catch((err: unknown) => {
        if (isNotFound(err)) return [] as ApiUseCase[];
        throw err;
      }),
      apiClient.get<ApiBrandClaim[]>("/brands/me/claims").catch((err: unknown) => {
        if (isNotFound(err)) return [] as ApiBrandClaim[];
        throw err;
      }),
    ]);
    competitors = competitorsResult.map((c) => mapCompetitor(c, brandId));
    useCases = useCasesResult.map((u) => mapUseCase(u, brandId));
    brandClaims = claimsResult.map((c) => mapBrandClaim(c, brandId));
  } else {
    brand = blankBrand(organizationId);
  }

  const visited = readVisitedSteps(organizationId);
  const completedSteps = deriveCompletedSteps(brand, competitors, useCases, brandClaims, visited);
  const status = deriveStatus(completedSteps, apiBrand?.onboardingCompletedAt);

  return {
    organizationId,
    status,
    completedSteps,
    brand,
    competitors,
    useCases,
    brandClaims,
    completedAt: apiBrand?.onboardingCompletedAt ?? undefined,
  };
}

export async function saveBrandBasics(
  organizationId: string,
  data: Pick<Brand, "name" | "websiteUrl" | "description" | "aliases" | "positioning" | "differentiators">,
): Promise<BrandProfile> {
  try {
    await apiClient.patch("/brands/me", {
      name: data.name,
      websiteUrl: data.websiteUrl || null,
      description: data.description || null,
      aliases: data.aliases,
      positioning: data.positioning || null,
      differentiators: data.differentiators,
    });
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function saveIndustryCategory(
  organizationId: string,
  data: Pick<Brand, "industries" | "categories" | "markets">,
): Promise<BrandProfile> {
  try {
    await apiClient.patch("/brands/me", data);
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function addCompetitor(
  organizationId: string,
  input: { name: string; websiteUrl: string; priority: CompetitorPriority; aliases: string[] },
): Promise<BrandProfile> {
  try {
    await apiClient.post("/brands/me/competitors", {
      name: input.name,
      websiteUrl: input.websiteUrl || null,
      priority: input.priority,
      aliases: input.aliases,
    });
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function updateCompetitor(
  organizationId: string,
  id: string,
  patch: Partial<Pick<Competitor, "name" | "websiteUrl" | "priority" | "aliases">>,
): Promise<BrandProfile> {
  try {
    await apiClient.patch(`/brands/me/competitors/${id}`, patch);
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function removeCompetitor(organizationId: string, id: string): Promise<BrandProfile> {
  await apiClient.delete(`/brands/me/competitors/${id}`);
  return getBrandProfile(organizationId);
}

export async function addUseCase(
  organizationId: string,
  input: Omit<UseCase, "id" | "brandId" | "createdAt" | "updatedAt">,
): Promise<BrandProfile> {
  try {
    await apiClient.post("/brands/me/use-cases", input);
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function updateUseCase(
  organizationId: string,
  id: string,
  patch: Partial<Omit<UseCase, "id" | "brandId" | "createdAt" | "updatedAt">>,
): Promise<BrandProfile> {
  try {
    await apiClient.patch(`/brands/me/use-cases/${id}`, patch);
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function removeUseCase(organizationId: string, id: string): Promise<BrandProfile> {
  await apiClient.delete(`/brands/me/use-cases/${id}`);
  return getBrandProfile(organizationId);
}

export async function addBrandClaim(
  organizationId: string,
  input: Omit<BrandClaim, "id" | "brandId" | "createdAt" | "updatedAt">,
): Promise<BrandProfile> {
  try {
    await apiClient.post("/brands/me/claims", { ...input, evidence: input.evidence || null });
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function updateBrandClaim(
  organizationId: string,
  id: string,
  patch: Partial<Omit<BrandClaim, "id" | "brandId" | "createdAt" | "updatedAt">>,
): Promise<BrandProfile> {
  try {
    await apiClient.patch(`/brands/me/claims/${id}`, patch);
  } catch (err) {
    translateError(err);
  }
  return getBrandProfile(organizationId);
}

export async function removeBrandClaim(organizationId: string, id: string): Promise<BrandProfile> {
  await apiClient.delete(`/brands/me/claims/${id}`);
  return getBrandProfile(organizationId);
}

/** Called on every step's "Continue" for the two steps with no inherent
 *  minimum (`competitors` already blocks at zero client-side; `claims` is
 *  genuinely optional per the spec) — records "visited" locally, then
 *  returns the freshly re-derived profile. For steps whose completion is
 *  fully data-derived (`brand-basics`, `industry`, `use-cases`) this is
 *  harmless but redundant; called uniformly from every step for one code
 *  path rather than special-casing which steps need it. */
export async function markStepComplete(organizationId: string, step: OnboardingStepKey): Promise<BrandProfile> {
  markVisited(organizationId, step);
  return getBrandProfile(organizationId);
}

/** What the server started (or why it didn't) when onboarding completed —
 *  `POST /brands/me/onboarding/complete` (`apps/api/src/lib/onboarding/complete.ts`). */
export type CrawlKickoff =
  | { status: "started"; jobId: string }
  | {
      status: "skipped";
      jobId?: string;
      reason: "no_website_url" | "crawl_already_in_progress" | "already_crawled" | "onboarding_already_completed";
    };

export type QuerySetKickoff =
  | { status: "created"; id: string }
  | { status: "skipped"; id?: string; reason: "active_query_set_exists" | "onboarding_already_completed" };

export interface OnboardingCompletion {
  completedAt: string;
  alreadyCompleted: boolean;
  crawl: CrawlKickoff;
  querySet: QuerySetKickoff;
}

/** The server's 422 `onboarding_incomplete` — `missing` lists the step keys
 *  (claims is optional and never listed). */
export class OnboardingIncompleteError extends Error {
  constructor(
    message: string,
    public readonly missing: OnboardingStepKey[],
  ) {
    super(message);
    this.name = "OnboardingIncompleteError";
  }
}

/** Completes onboarding ON THE SERVER. Idempotent: a repeat call starts
 *  nothing and reports `alreadyCompleted: true`. A 404 (no brand yet) is
 *  reported as every required step missing. */
export async function completeOnboarding(): Promise<OnboardingCompletion> {
  try {
    return await apiClient.post<OnboardingCompletion>("/brands/me/onboarding/complete");
  } catch (err) {
    if (err instanceof ApiError) {
      const body = (err.body ?? {}) as { message?: string; missing?: OnboardingStepKey[] };
      if (err.status === 422 && Array.isArray(body.missing)) {
        throw new OnboardingIncompleteError(body.message ?? "Some setup steps still need attention.", body.missing);
      }
      if (err.status === 404) {
        throw new OnboardingIncompleteError(body.message ?? "Create your brand profile first.", [
          "brand-basics",
          "competitors",
          "industry",
          "use-cases",
        ]);
      }
    }
    throw err;
  }
}

export function resumeStep(profile: BrandProfile): OnboardingStepKey {
  return ONBOARDING_STEP_KEYS.find((key) => !profile.completedSteps[key]) ?? ONBOARDING_STEP_KEYS[ONBOARDING_STEP_KEYS.length - 1]!;
}

export function completedStepCount(profile: BrandProfile): number {
  return ONBOARDING_STEP_KEYS.filter((key) => profile.completedSteps[key]).length;
}

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname.includes(".")) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
