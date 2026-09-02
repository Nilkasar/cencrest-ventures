/**
 * Epic 4 — SEO Intelligence domain types.
 *
 * Mirrors `apps/api/src/routes/seo.ts`'s actual serializers exactly (read
 * before writing this file, not guessed from the spec's prose) — every
 * field name here is camelCase because that route's `serialize*` functions
 * already return camelCase, whitelisted objects. No `Api*` wire-shape +
 * `map*` translation layer is needed the way `data/query-universe/client.ts`
 * needs one for nullable-vs-optional coercion; this is the same "comes
 * across as-is" situation `data/website/types.ts`'s header describes for
 * Epic 3.
 */

/** `keyword_intent` (Prisma enum, reused from an earlier epic) —
 *  deliberately NOT the same union as Epic 5's `QueryIntentType`
 *  (`informational | commercial | comparison | transactional`): this one has
 *  `navigational` instead of `comparison`. Two different enums that happen
 *  to share three of four labels — do not conflate them. */
export type SeoKeywordIntent = "informational" | "navigational" | "commercial" | "transactional";

export type SeoKeywordConfidence = "high" | "medium" | "low" | "estimate";

export type SeoProviderSource =
  | "null_provider"
  | "search_console"
  | "dataforseo"
  | "semrush"
  | "ahrefs"
  | "serper"
  | "manual";

export interface KeywordGroup {
  id: string;
  name: string;
  /** Only present on `GET /keyword-groups` (its `_count` include) —
   *  `undefined` on the row a create/rename call returns, since neither
   *  includes it. Compute a fresh count from the keywords list instead when
   *  it's missing (see `keyword-group-card.tsx`). */
  keywordCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SeoKeyword {
  id: string;
  keywordGroupId: string;
  text: string;
  intent: SeoKeywordIntent | null;
  monthlyVolume: number | null;
  difficulty: number | null;
  confidence: SeoKeywordConfidence;
  source: SeoProviderSource;
  createdAt: string;
  updatedAt: string;
}

/** One Page Analysis Checklist item's result, as `technical-checklist.ts`
 *  returns it. `id` is either one of Epic 3's `IssueType` values (an issue
 *  the crawler already found) or one of this epic's two new synthetic check
 *  ids (`https`, `homepage_organization_schema`) — see
 *  `data/seo/labels.ts`'s `checkLabel`. */
export interface ChecklistCheck {
  id: string;
  passed: boolean;
  severity: "low" | "medium" | "high" | null;
  detail: string | null;
}

export interface TechnicalAnalysis {
  id: string;
  pageId: string;
  analysisType: "technical";
  score: number;
  findings: { checks: ChecklistCheck[] };
  analyzedAt: string;
}

export interface ContentAnalysisFindings {
  pagesAnalyzed: number;
  averageWordCount: number;
  thinContentPages: number;
  pagesWithSchemaMarkup: number;
  pagesWithoutSchemaMarkup: number;
}

export interface ContentAnalysis {
  id: string;
  pageId: null;
  analysisType: "content";
  score: number;
  findings: ContentAnalysisFindings;
  analyzedAt: string;
}

/** `POST /brands/me/seo/analyze`'s 200 response. */
export interface SeoAnalyzeResult {
  crawlJobId: string;
  pagesAnalyzed: number;
  issuesCreated: number;
  technicalAnalyses: TechnicalAnalysis[];
  contentAnalysis: ContentAnalysis;
}

export type OpportunityStatus = "new" | "in_progress" | "completed" | "dismissed";

/** The raw formula-v1.0 inputs behind an opportunity's score — the epic's
 *  "each opportunity shows its evidence" requirement, verbatim from
 *  `opportunity-scoring.ts`'s `OpportunityScoringInput`. `demandScore`/
 *  `contentComplexity`/`technicalDifficulty` are 0-100; `currentCoverage` is
 *  a 0-1 fraction (display as a percentage, not a raw number). */
export interface OpportunityEvidence {
  demandScore: number;
  currentCoverage: number;
  contentComplexity: number;
  technicalDifficulty: number;
}

export interface SeoOpportunity {
  id: string;
  keywordId: string | null;
  title: string;
  /** Open string server-side, not a closed enum — see
   *  `apps/api/src/lib/seo/keyword-to-opportunity.ts`'s `classifyOpportunityType`
   *  doc comment. `data/seo/labels.ts`'s `opportunityTypeLabel` humanizes any
   *  value this hasn't seen a label for yet. */
  opportunityType: string;
  valueScore: number;
  effortScore: number;
  opportunityScore: number;
  scoringFormulaVersion: string;
  status: OpportunityStatus;
  /** `null` only in the never-actually-produced case a future write path
   *  creates a `seo_opportunities` row with no evidence; every row this
   *  epic's backend creates today always carries one. */
  evidence: OpportunityEvidence | null;
  createdAt: string;
  updatedAt: string;
}
