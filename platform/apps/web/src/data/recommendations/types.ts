/**
 * Epic 10 — Recommendation Engine domain types.
 *
 * Mirrors `apps/api/src/lib/recommendations/serialize.ts`'s
 * `serializeRecommendation` exactly (read before writing this file, not
 * guessed from the epic spec's prose) — every field here is camelCase
 * because the API already returns a camelCase, whitelisted object. No
 * `Api*` + `map*` translation layer, same "comes across as-is" convention
 * `data/opportunities/types.ts`'s header documents for Epic 9.
 *
 * `status` reuses `opportunity_status` server-side (same enum, same four
 * values) and `RecommendationStatus` below is therefore structurally
 * identical to Epic 9's `OpportunityStatus` — imported, not redeclared, so
 * the two can never drift apart.
 */
import type { OpportunityStatus } from "@/data/opportunities/types";

export type RecommendationActionType = "create_page" | "update_page" | "fix_technical" | "build_citations";

/** `effort_level`/`impact_level` (Prisma enum, reused from Epic 9's own
 *  bucketing) — a closed low/medium/high scale, distinct from the
 *  opportunity's own 0-100 numeric scores. */
export type RecommendationLevel = "low" | "medium" | "high";

export type RecommendationStatus = OpportunityStatus;

export interface Recommendation {
  id: string;
  opportunityId: string;
  brandId: string;
  actionType: RecommendationActionType;
  effort: RecommendationLevel;
  impact: RecommendationLevel;
  /** Higher ranks first — `GET /brands/me/recommendations` sorts by this
   *  DESC server-side, never re-sorted client-side. */
  priorityRank: number;
  title: string;
  description: string;
  /** Quotes the source opportunity's real `opportunity_evidence` sentences
   *  verbatim (real keyword volumes, real competitor mention rates) — never
   *  a generic template string, per this epic's DoD. */
  evidenceSummary: string;
  /** `"SEO requirements: ...\n\nGEO requirements: ..."` — both halves always
   *  present for every `actionType`, per this epic's dual-requirement DoD. */
  implementationNotes: string;
  status: RecommendationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationsPage {
  recommendations: Recommendation[];
  pagination: { total: number; limit: number; offset: number };
}

export interface ListRecommendationsParams {
  status?: RecommendationStatus;
  actionType?: RecommendationActionType;
  limit?: number;
  offset?: number;
}

/** `POST /opportunities/:id/recommendations/generate`'s response — `created`
 *  is `true` on the first call for a given opportunity, `false` on every
 *  idempotent re-run (the SAME row, updated in place). */
export interface GenerateRecommendationResult {
  created: boolean;
  recommendation: Recommendation;
}
