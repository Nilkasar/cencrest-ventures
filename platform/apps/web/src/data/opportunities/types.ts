/**
 * Epic 9 — Opportunity Engine domain types.
 *
 * Mirrors `apps/api/src/lib/opportunities/serialize.ts` exactly (read before
 * writing this file, not guessed from the epic spec's prose) — every field
 * here is camelCase because `serializeOpportunity`/`serializeOpportunityDetail`
 * already return camelCase, whitelisted objects. No `Api*` + `map*`
 * translation layer is needed, same "comes across as-is" situation
 * `data/seo/types.ts`'s header describes for Epic 4.
 */

/** `unified_opportunity_type` (Prisma enum). Only `seo`/`geo`/`unified` are
 *  ever produced by today's merge (`routes/opportunities.ts`'s `recompute`)
 *  — `content`/`technical` are reserved for a future epic sourced from Epic
 *  8's content/entity/source gap classifications (see the backend's own
 *  "known limitations" #2), but are valid values the API could return, so
 *  the union includes them. */
export type OpportunityType = "seo" | "geo" | "unified" | "content" | "technical";

export type OpportunityStatus = "new" | "in_progress" | "completed" | "dismissed";

/** Plain SmallInt server-side (1 = highest, 3 = lowest) — not an enum, but a
 *  closed 1-3 range in practice (`priorityFromScore` in `merge-scoring.ts`
 *  only ever emits these three values, and `PATCH` validates the same
 *  range). */
export type OpportunityPriority = 1 | 2 | 3;

export interface Opportunity {
  id: string;
  queryId: string;
  intentText: string;
  type: OpportunityType;
  /** `null` when this intent has no matched SEO keyword (a `geo`-only row). */
  seoDemandScore: number | null;
  /** `null` when this intent has no GEO gap finding (a `seo`-only row). */
  geoGapScore: number | null;
  effortScore: number;
  impactScore: number;
  opportunityScore: number;
  scoringFormulaVersion: string;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  dismissalReason: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** `source_table` is an open string server-side (`'seo_keywords'` or
 *  `'ai_runs'` today — see `routes/opportunities.ts`'s header comment #evidence
 *  section — but unconstrained, same precedent as `action_type` elsewhere in
 *  this codebase), so this is not a closed union. */
export interface OpportunityEvidence {
  id: string;
  opportunityId: string;
  sourceTable: string;
  sourceId: string;
  summary: string;
  rawData: unknown;
  createdAt: string;
}

/** `GET /opportunities/:id`'s shape — the evidence trail is inlined here,
 *  never a separate paginated fetch, per the epic's "evidence inline or one
 *  click away" requirement. The list endpoint (`Opportunity` above) does NOT
 *  inline evidence, which is why the "one click away" half of that
 *  requirement is real: `opportunity-card.tsx` lazy-fetches this shape the
 *  first time a card's evidence disclosure is opened. */
export interface OpportunityDetail extends Opportunity {
  evidence: OpportunityEvidence[];
}

export interface OpportunitiesPage {
  opportunities: Opportunity[];
  pagination: { total: number; limit: number; offset: number };
}

export interface RecomputeSummary {
  intentsConsidered: number;
  created: number;
  updated: number;
  reactivated: number;
  skippedDismissed: number;
  skippedNoSignal: number;
}

/** `POST /brands/me/opportunities/recompute`'s 200 response — only the rows
 *  touched by that specific run (created/updated/reactivated), sorted by
 *  `opportunityScore` desc; NOT the full list (that's a separate `GET`). */
export interface RecomputeResult {
  querySetId: string;
  summary: RecomputeSummary;
  opportunities: Opportunity[];
}

export interface ListOpportunitiesParams {
  status?: OpportunityStatus;
  type?: OpportunityType;
  priority?: OpportunityPriority;
  limit?: number;
  offset?: number;
}

/** `PATCH /opportunities/:id`'s body — at least one of `status`/`priority`
 *  is required server-side (Zod's own `.refine`), and `dismissalReason` is
 *  required when `status` is `"dismissed"`. Both refinements are re-checked
 *  client-side in `opportunity-card.tsx` before the request is even sent, so
 *  the 422 case is a defensive backstop, not the primary validation path. */
export interface OpportunityPatchInput {
  status?: OpportunityStatus;
  priority?: OpportunityPriority;
  dismissalReason?: string;
}
