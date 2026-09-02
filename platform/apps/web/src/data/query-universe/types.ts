import type { Organization } from "@/data/types";

/**
 * Epic 5 — Intent & Query Universe domain types.
 *
 * Mirrors `docs/epics/05-intent-query-universe.md`'s "Domain model" and
 * "API surface" sections (query_sets: name/description/query_count/version/
 * status; queries: text/intent_type/category/tags/priority) — that spec is
 * the contract this frontend was briefed to build against.
 *
 * Post-verification fix (qa-flow-tester pass — see
 * `docs/epics/05-intent-query-universe-frontend.md`'s "Post-verification
 * fixes" section and `packages/database/DECISIONS.md` §18): this used to
 * describe a gap against the ported schema; `apps/api`'s real
 * `/brands/me/query-sets` routes now implement exactly this contract.
 * `QuerySet` previously also had `brandId`/`organizationId` — checked
 * against every component in `components/query-universe/` and found
 * genuinely unused (no display, no client-side filtering once the real API
 * scopes by the caller's org/brand implicitly), so they were removed here
 * rather than added to the backend. The remaining fields
 * (`planTier`/`planLimit`/`potentialCount`/`activatedAt`/`archivedAt`,
 * `Query.source`) were each checked the same way and found genuinely
 * displayed, so `apps/api` now persists and serializes all of them.
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
  /** Not in the spec's literal DDL, but genuinely displayed — a "Manual"
   *  badge in `category-section.tsx` and the "All queries" table
   *  distinguishes what a human curated from what the template generator
   *  produced, per the epic's "the customer effectively co-owns this"
   *  framing. Post-verification fix: checked against those components (not
   *  assumed) and confirmed load-bearing, so `apps/api`'s `queries` table
   *  now has a real `source` column instead of this being a frontend-only
   *  field — see `packages/database/DECISIONS.md` §18. */
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
  name: string;
  description: string | null;
  /** Kept in sync with the live `queries` count by every mutation in
   *  `client.ts` — never read as a separately-trusted number. */
  queryCount: number;
  /** Frozen at activation — a subsequent edit is rejected (409), never
   *  silently mutates an activated set's queries. Post-verification fix: this
   *  comment previously said a new generation starts the next draft at
   *  `currentActiveVersion + 1`; the real backend (`POST .../generate`)
   *  always creates a fresh draft at `version: 1` — there is no
   *  duplicate-into-a-new-draft-version flow yet (an intentional gap, see
   *  `docs/epics/05-intent-query-universe-backend.md`'s "What was NOT
   *  done"). "Frozen" here means locked against further edits, not
   *  incremented. */
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
