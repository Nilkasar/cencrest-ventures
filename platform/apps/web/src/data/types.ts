/**
 * Shapes the Epic 0 shell needs to render (org switcher, user menu). These
 * mirror what `platform/apps/api` will eventually return — kept here,
 * typed, so the fixtures in `fixtures.ts` and the real API responses next
 * epic can share a contract without the components changing.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "starter" | "growth" | "pro" | "agency" | "enterprise";
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
}

/**
 * Epic 2 — Brand Intelligence domain model. Field names follow
 * `docs/epics/02-brand-intelligence.md` §"Domain model" (which is what this
 * frontend was briefed to build against) rather than the literal Prisma
 * model names in `packages/database/prisma/schema.prisma` — the two are
 * close but not identical yet (see the frontend completion doc's "Schema
 * reconciliation" note: no `use_cases`/`brand_claims` tables exist in the
 * ported schema yet, and `competitors` has no `priority` column). Backend
 * work should treat this file as the contract to implement against, not
 * the other way around.
 */

/** 1 = primary (main head-to-head competitor), 2 = secondary, 3 = watch
 *  (worth monitoring, not a direct threat) — matches the spec's numbering. */
export type CompetitorPriority = 1 | 2 | 3;

export interface Competitor {
  id: string;
  brandId: string;
  name: string;
  websiteUrl: string;
  priority: CompetitorPriority;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

export type ClaimConfidence = "high" | "medium" | "low";

export interface BrandClaim {
  id: string;
  brandId: string;
  claim: string;
  evidence: string;
  confidence: ClaimConfidence;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UseCase {
  id: string;
  brandId: string;
  title: string;
  industries: string[];
  companySizes: string[];
  painPoints: string[];
  solution: string;
  createdAt: string;
  updatedAt: string;
}

export interface Brand {
  id: string;
  organizationId: string;
  name: string;
  websiteUrl: string;
  description: string;
  industries: string[];
  categories: string[];
  markets: string[];
  aliases: string[];
  positioning: string;
  differentiators: string[];
  createdAt: string;
  updatedAt: string;
}

export const ONBOARDING_STEP_KEYS = [
  "brand-basics",
  "competitors",
  "industry",
  "use-cases",
  "claims",
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export type OnboardingStatus = "not_started" | "in_progress" | "completed";

/** The full saved-progress record for one organization's brand onboarding.
 *  Persisted step-by-step (see `src/lib/onboarding-client.ts`) so a user who
 *  leaves mid-wizard resumes instead of restarting. */
export interface BrandProfile {
  organizationId: string;
  status: OnboardingStatus;
  completedSteps: Record<OnboardingStepKey, boolean>;
  brand: Brand;
  competitors: Competitor[];
  useCases: UseCase[];
  brandClaims: BrandClaim[];
  completedAt?: string;
}
