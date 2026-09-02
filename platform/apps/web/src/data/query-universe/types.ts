import type { Organization } from "@/data/types";

/**
 * Epic 5 — Intent & Query Universe domain types.
 *
 * Mirrors `docs/epics/05-intent-query-universe.md`'s "Domain model" and
 * "API surface" sections (query_sets: name/description/query_count/version/
 * status; queries: text/intent_type/category/tags/priority) — that spec is
 * the contract this frontend was briefed to build against.
 *
 * It is NOT a 1:1 mirror of the currently-ported `packages/database/prisma/
 * schema.prisma` — see this epic's frontend completion doc's "Schema
 * reconciliation" note (same posture Epic 2's frontend took, documented in
 * `data/types.ts` above the `Brand`/`UseCase` interfaces): the ported
 * `query_sets` table has no `status`/`version`/`query_count` columns yet,
 * and `questions.type` is a `who/what/how/best/compare/other` phrasing
 * enum, not the four-value `intent_type` the epic spec calls for, nor the
 * ten generation categories below. Backend work should implement toward
 * this file, not the other way around.
 */

/**
 * The ten query-generation categories, in the exact order
 * `docs/11-geo/GEO_ENGINE.md`'s "Query Categories" list numbers them —
 * every grouped view in this epic renders categories in this order, not
 * alphabetically, so the UI reads as the same taxonomy the doc defines.
 */
export const QUERY_CATEGORIES = [
  "category",
  "problem",
  "commercial",
  "comparison",
  "feature",
  "industry",
  "size",
  "geography",
  "intent",
  "authority",
] as const;

export type QueryCategory = (typeof QUERY_CATEGORIES)[number];

/** Matches the epic spec's `queries.intent_type` exactly. Not to be
 *  confused with the `intent` *category* above (job-to-be-done queries) —
 *  every category maps to one of these four broader intent types, see
 *  `constants.ts`'s `CATEGORY_INTENT_TYPE`. */
export type QueryIntentType = "informational" | "commercial" | "comparison" | "transactional";

/** 1 = high, 2 = medium, 3 = low — matches the spec's numbering exactly
 *  (same convention as Epic 2's `CompetitorPriority`). */
export type QueryPriority = 1 | 2 | 3;

export interface Query {
  id: string;
  querySetId: string;
  text: string;
  intentType: QueryIntentType;
  category: QueryCategory;
  tags: string[];
  priority: QueryPriority;
  /** Not in the spec's DB columns — added so the review screen can show
   *  provenance ("generated" vs a human addition) without a black-box feel,
   *  per the epic's "the customer effectively co-owns this" framing. Purely
   *  additive: dropping it loses nothing a backend implementation needs. */
  source: "generated" | "manual";
  createdAt: string;
  updatedAt: string;
}

export type QuerySetStatus = "draft" | "active" | "archived";

/** Reuses `Organization["plan"]` rather than a parallel union — see
 *  `data/crm/types.ts`'s `AccountPlan` for the identical precedent. */
export type PlanTier = Organization["plan"];

export interface QuerySet {
  id: string;
  brandId: string;
  organizationId: string;
  name: string;
  description: string | null;
  /** Kept in sync with the live `queries` count by every mutation in
   *  `client.ts` — never read as a separately-trusted number. */
  queryCount: number;
  /** Frozen at activation; a new generation starts the next draft at
   *  `currentActiveVersion + 1`, never mutates a version once active. */
  version: number;
  status: QuerySetStatus;
  planTier: PlanTier;
  /** The cap applied at generation time (see `constants.ts`'s
   *  `PLAN_QUERY_LIMITS`) — kept on the row so the review screen can always
   *  explain "why 500 and not more" even after the org's plan changes later. */
  planLimit: number;
  /** How many template combinations the brand profile could produce before
   *  the plan cap was applied — lets the UI say "500 of 812 possible" only
   *  when the cap actually bound, instead of implying a smaller universe
   *  than the brand profile supports. */
  potentialCount: number;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}
