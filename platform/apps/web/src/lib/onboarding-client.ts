/**
 * Mock persistence layer for Epic 2 (Brand Intelligence) onboarding + the
 * Settings > Brand profile tab. Stands in for what will become real calls
 * through `apiClient` (`GET/PATCH /brands/me`, `/competitors`, `/use-cases`,
 * `/brand-claims`) once `platform/apps/api`'s Epic 2 routes exist — see
 * `apiClient`'s own header comment for the same pattern. Every exported
 * function here has the shape it will keep once it's a real fetch call:
 * async, throws a typed error on failure, returns the updated `BrandProfile`.
 *
 * Persistence is `localStorage` (namespaced per organization) specifically
 * so the wizard's "leave and resume" requirement is real, not simulated —
 * closing the tab mid-wizard and coming back actually resumes, because the
 * data actually survives. A real backend swap is a rewrite of this file's
 * internals only; every call site (`useBrandProfile`, the wizard steps,
 * the Settings panel) is written against the function signatures below.
 */

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
import { buildBrandProfileSeed } from "@/data/fixtures";
import { competitorLimitFor, describeUpgradePath, isUnlimited } from "@/data/brand-constants";

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

const STORAGE_PREFIX = "bebest.brand-profile.v1.";

function storageKey(organizationId: string): string {
  return `${STORAGE_PREFIX}${organizationId}`;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readProfile(organizationId: string): BrandProfile {
  if (hasLocalStorage()) {
    try {
      const raw = window.localStorage.getItem(storageKey(organizationId));
      if (raw) {
        return JSON.parse(raw) as BrandProfile;
      }
    } catch {
      // Corrupted JSON (hand-edited storage, a partial write from a crashed
      // tab, etc.) — fall through to reseeding rather than surfacing this
      // as a hard error. The seed below is written back immediately so the
      // corruption doesn't resurface on the next read.
    }
  }
  const seed = buildBrandProfileSeed(organizationId);
  writeProfile(seed);
  return seed;
}

function writeProfile(profile: BrandProfile): BrandProfile {
  if (hasLocalStorage()) {
    try {
      window.localStorage.setItem(storageKey(profile.organizationId), JSON.stringify(profile));
    } catch {
      // Storage full or blocked (private browsing, quota) — the in-memory
      // value returned below is still correct for this session; it just
      // won't survive a reload. Not worth failing the save over.
    }
  }
  return profile;
}

function simulateLatency(ms = 450): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function genId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
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

export async function getBrandProfile(organizationId: string): Promise<BrandProfile> {
  await simulateLatency(350);
  return readProfile(organizationId);
}

export async function saveBrandBasics(
  organizationId: string,
  data: Pick<Brand, "name" | "websiteUrl" | "description" | "aliases" | "positioning" | "differentiators">,
): Promise<BrandProfile> {
  await simulateLatency();
  const profile = readProfile(organizationId);
  profile.brand = { ...profile.brand, ...data, updatedAt: new Date().toISOString() };
  profile.completedSteps["brand-basics"] = true;
  profile.status = deriveStatus(profile);
  return writeProfile(profile);
}

export async function saveIndustryCategory(
  organizationId: string,
  data: Pick<Brand, "industries" | "categories" | "markets">,
): Promise<BrandProfile> {
  await simulateLatency();
  const profile = readProfile(organizationId);
  profile.brand = { ...profile.brand, ...data, updatedAt: new Date().toISOString() };
  profile.completedSteps.industry = true;
  profile.status = deriveStatus(profile);
  return writeProfile(profile);
}

export async function addCompetitor(
  organizationId: string,
  plan: Organization["plan"],
  input: { name: string; websiteUrl: string; priority: CompetitorPriority; aliases: string[] },
): Promise<BrandProfile> {
  const profile = readProfile(organizationId);
  const limit = competitorLimitFor(plan);
  if (profile.competitors.length >= limit) {
    const upgrade = describeUpgradePath(plan);
    const limitLabel = isUnlimited(limit) ? "unlimited" : `${limit}`;
    throw new EntitlementError(
      `You've reached your ${planLabel(plan)} plan's limit of ${limitLabel} tracked competitors.${upgrade ? ` ${upgrade}` : ""}`,
      limit,
      plan,
    );
  }
  await simulateLatency();
  const now = new Date().toISOString();
  const competitor: Competitor = {
    id: genId("comp"),
    brandId: profile.brand.id,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  profile.competitors = [...profile.competitors, competitor];
  return writeProfile(profile);
}

export async function updateCompetitor(
  organizationId: string,
  id: string,
  patch: Partial<Pick<Competitor, "name" | "websiteUrl" | "priority" | "aliases">>,
): Promise<BrandProfile> {
  await simulateLatency();
  const profile = readProfile(organizationId);
  profile.competitors = profile.competitors.map((c) =>
    c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
  );
  return writeProfile(profile);
}

export async function removeCompetitor(organizationId: string, id: string): Promise<BrandProfile> {
  await simulateLatency(300);
  const profile = readProfile(organizationId);
  profile.competitors = profile.competitors.filter((c) => c.id !== id);
  return writeProfile(profile);
}

export async function addUseCase(
  organizationId: string,
  input: Omit<UseCase, "id" | "brandId" | "createdAt" | "updatedAt">,
): Promise<BrandProfile> {
  await simulateLatency();
  const profile = readProfile(organizationId);
  const now = new Date().toISOString();
  const useCase: UseCase = { id: genId("uc"), brandId: profile.brand.id, createdAt: now, updatedAt: now, ...input };
  profile.useCases = [...profile.useCases, useCase];
  return writeProfile(profile);
}

export async function updateUseCase(
  organizationId: string,
  id: string,
  patch: Partial<Omit<UseCase, "id" | "brandId" | "createdAt" | "updatedAt">>,
): Promise<BrandProfile> {
  await simulateLatency();
  const profile = readProfile(organizationId);
  profile.useCases = profile.useCases.map((uc) =>
    uc.id === id ? { ...uc, ...patch, updatedAt: new Date().toISOString() } : uc,
  );
  return writeProfile(profile);
}

export async function removeUseCase(organizationId: string, id: string): Promise<BrandProfile> {
  await simulateLatency(300);
  const profile = readProfile(organizationId);
  profile.useCases = profile.useCases.filter((uc) => uc.id !== id);
  return writeProfile(profile);
}

export async function addBrandClaim(
  organizationId: string,
  input: Omit<BrandClaim, "id" | "brandId" | "createdAt" | "updatedAt">,
): Promise<BrandProfile> {
  await simulateLatency();
  const profile = readProfile(organizationId);
  const now = new Date().toISOString();
  const claim: BrandClaim = { id: genId("claim"), brandId: profile.brand.id, createdAt: now, updatedAt: now, ...input };
  profile.brandClaims = [...profile.brandClaims, claim];
  return writeProfile(profile);
}

export async function updateBrandClaim(
  organizationId: string,
  id: string,
  patch: Partial<Omit<BrandClaim, "id" | "brandId" | "createdAt" | "updatedAt">>,
): Promise<BrandProfile> {
  await simulateLatency();
  const profile = readProfile(organizationId);
  profile.brandClaims = profile.brandClaims.map((c) =>
    c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
  );
  return writeProfile(profile);
}

export async function removeBrandClaim(organizationId: string, id: string): Promise<BrandProfile> {
  await simulateLatency(300);
  const profile = readProfile(organizationId);
  profile.brandClaims = profile.brandClaims.filter((c) => c.id !== id);
  return writeProfile(profile);
}

export async function markStepComplete(organizationId: string, step: OnboardingStepKey): Promise<BrandProfile> {
  await simulateLatency(300);
  const profile = readProfile(organizationId);
  profile.completedSteps[step] = true;
  profile.status = deriveStatus(profile);
  return writeProfile(profile);
}

export async function completeOnboarding(organizationId: string): Promise<BrandProfile> {
  await simulateLatency(500);
  const profile = readProfile(organizationId);
  const incomplete = ONBOARDING_STEP_KEYS.filter((key) => !profile.completedSteps[key]);
  if (incomplete.length > 0) {
    throw new ValidationError(
      `Finish the remaining step${incomplete.length > 1 ? "s" : ""} before completing setup: ${incomplete.join(", ")}.`,
    );
  }
  profile.status = "completed";
  profile.completedAt = new Date().toISOString();
  return writeProfile(profile);
}

export function deriveStatus(profile: Pick<BrandProfile, "completedSteps" | "status">): BrandProfile["status"] {
  if (profile.status === "completed") return "completed";
  const anyDone = ONBOARDING_STEP_KEYS.some((key) => profile.completedSteps[key]);
  return anyDone ? "in_progress" : "not_started";
}

export function resumeStep(profile: BrandProfile): OnboardingStepKey {
  return ONBOARDING_STEP_KEYS.find((key) => !profile.completedSteps[key]) ?? ONBOARDING_STEP_KEYS[ONBOARDING_STEP_KEYS.length - 1]!;
}

export function completedStepCount(profile: BrandProfile): number {
  return ONBOARDING_STEP_KEYS.filter((key) => profile.completedSteps[key]).length;
}

function planLabel(plan: Organization["plan"]): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
