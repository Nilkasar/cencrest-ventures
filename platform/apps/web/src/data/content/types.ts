/**
 * Epic 11 — Content Intelligence & Generation domain types.
 *
 * Mirrors `apps/api/src/lib/content/serialize.ts` exactly (read before
 * writing this file, not guessed from the epic spec's prose) — every field
 * here is camelCase because the API already returns a camelCase, whitelisted
 * object. No `Api*` + `map*` translation layer, same "comes across as-is"
 * convention `data/opportunities/types.ts`/`data/recommendations/types.ts`
 * already establish.
 */

/** `content_briefs.status` — checked directly against `schema.prisma`'s
 *  column comment (`draft, in_review, approved, archived`). No route in
 *  this epic's backend ever transitions a brief past `draft` (there is no
 *  brief-status-update endpoint at all yet) — every brief this epic's UI
 *  will ever see is `"draft"` in practice, but the full vocabulary is kept
 *  here (and offered as a filter) so the UI doesn't need a second update
 *  when a future epic starts writing the other values. */
export type ContentBriefStatus = "draft" | "in_review" | "approved" | "archived";

/** `content_drafts.status` — CHECK-constrained server-side to exactly these
 *  two values (ADR-007: a `content_drafts` row can never even represent
 *  `"published"`). `"generated"` means "awaiting approval." */
export type ContentDraftStatus = "generated" | "approved";

export type QualityCheckType = "fact_check" | "brand_voice" | "duplicate_content" | "seo_checklist" | "geo_structure";
export type QualityCheckStatus = "pass" | "fail" | "warning";

export interface OutlineSection {
  section: string;
  notes: string;
}

export interface ResearchNotes {
  brandClaims?: Array<{ id: string; claim: string; confidence: string; verified: boolean }>;
  opportunityEvidence?: Array<{ sourceTable: string; summary: string }>;
}

export interface ContentBrief {
  id: string;
  brandId: string;
  recommendationId: string;
  pageId: string | null;
  contentType: string;
  title: string;
  targetQuery: string | null;
  targetStage: string | null;
  targetIntent: string | null;
  keywords: string[];
  outline: OutlineSection[];
  /** The source recommendation's `evidence_summary`, snapshotted at
   *  brief-creation time — never re-read live (see `packages/database/
   *  DECISIONS.md` §25). */
  evidenceSummary: string;
  /** `"SEO requirements: ...\n\nGEO requirements: ..."` — the recommendation's
   *  dual requirement, carried forward VERBATIM, never summarized. */
  implementationNotes: string;
  researchNotes: ResearchNotes;
  status: ContentBriefStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ContentDraft {
  id: string;
  briefId: string;
  brandId: string;
  version: number;
  providerName: string;
  modelName: string | null;
  promptVersion: string;
  title: string | null;
  metaDescription: string | null;
  body: string;
  wordCount: number;
  structuredDataTypes: string[];
  status: ContentDraftStatus;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** `details` genuinely differs per `checkType` (see `apps/api/src/lib/
 *  content/quality-checks.ts`, read directly rather than guessed) — kept as
 *  a loose bag here and narrowed per-check-type at the render site
 *  (`quality-check-list.tsx`), same "cast at the point that actually knows
 *  the shape" approach the rest of this app takes for check-specific JSON. */
export interface ContentQualityCheck {
  id: string;
  draftId: string;
  checkType: QualityCheckType;
  status: QualityCheckStatus;
  score: number | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ContentApproval {
  id: string;
  draftId: string;
  approvedBy: string | null;
  approvedRole: string;
  notes: string | null;
  approvedAt: string;
}

export interface ContentBriefsPage {
  briefs: ContentBrief[];
  pagination: { total: number; limit: number; offset: number };
}

export interface ListContentBriefsParams {
  status?: ContentBriefStatus;
  limit?: number;
  offset?: number;
}

/** `POST /recommendations/:id/content-brief`'s response — `created` is
 *  `true` on the first call for a given recommendation, `false` on an
 *  idempotent re-run (the SAME brief row, updated in place). */
export interface GenerateContentBriefResult {
  created: boolean;
  brief: ContentBrief;
}

/** `GET /content-briefs/:id`'s response — brief + every draft version
 *  generated under it, version desc. */
export interface ContentBriefDetail {
  brief: ContentBrief;
  drafts: ContentDraft[];
}

/** `POST /content-briefs/:id/draft`'s response. */
export interface GenerateDraftResult {
  draft: ContentDraft;
  qualityChecks: ContentQualityCheck[];
}

/** `GET /content-drafts/:id`'s response — draft + its brief inlined, so the
 *  approval screen can show both without a second round trip
 *  (`docs/epics/11-content-intelligence-generation.md`'s literal UI
 *  requirement: "the approval screen must show the draft alongside its
 *  brief's original requirements"). */
export interface ContentDraftDetail {
  draft: ContentDraft;
  brief: ContentBrief;
}

export interface QualityChecksResult {
  draftId: string;
  checks: ContentQualityCheck[];
}

/** `POST /content-drafts/:id/approve`'s response — idempotent, so
 *  `alreadyApproved` distinguishes "just approved" from "was already
 *  approved" without the caller needing to compare timestamps. */
export interface ApproveDraftResult {
  alreadyApproved: boolean;
  approval: ContentApproval;
  draft: ContentDraft;
}
