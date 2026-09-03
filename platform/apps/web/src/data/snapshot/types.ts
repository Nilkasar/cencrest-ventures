import type { QueryCategory } from "@/data/query-universe/types";

/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — wire shapes for
 * `platform/apps/api`'s public `routes/snapshot.ts`. Field names/order
 * mirror `apps/api/src/lib/free-snapshot/report.ts`'s `FreeSnapshotReport`
 * (and friends) exactly, since `GET /snapshot/:token`'s `complete` response
 * is that module's return value serialized to `snapshot_requests.result_json`
 * and handed back as-is — this file does not reshape it.
 *
 * `QueryTemplateCategory` on the backend (`lib/query-generator.ts`) is the
 * exact same ten-value string union the authenticated Query Universe screen
 * already types as `QueryCategory` (`data/query-universe/types.ts`) — reused
 * here rather than redeclared so a category label only ever needs one home
 * (`QUERY_CATEGORY_META`).
 */
export type QueryTemplateCategory = QueryCategory;

// ── POST /snapshot ──────────────────────────────────────────────────────

/** The intake form's exact field list, `docs/epics/17-free-snapshot.md`
 *  step 1: name, work email, company name, website URL, industry/category
 *  (optional), biggest competitor (optional). */
export interface SnapshotIntakeInput {
  name: string;
  email: string;
  company: string;
  website: string;
  category?: string;
  biggestCompetitor?: string;
  marketingConsent?: boolean;
}

/** `routes/snapshot.ts`'s 202 response — the confirmation-screen payload.
 *  `token` is the ONE time the raw, unhashed report token is ever handed to
 *  a caller (`packages/database/DECISIONS.md` §22's hash-at-rest rule) —
 *  keep it in memory only, never persist it client-side beyond this flow. */
export interface SnapshotSubmitResponse {
  message: string;
  token: string;
  reportUrl: string;
}

// ── GET /snapshot/:token ────────────────────────────────────────────────

export interface AiGap {
  query: string;
  category: QueryTemplateCategory;
  competitorMentionedInstead: boolean;
}

export interface SeoGap {
  issueType: string;
  severity: "low" | "medium" | "high";
  pageCount: number;
}

export interface CompetitorAppearance {
  name: string;
  mentionRate: number;
  autoDetected: boolean;
}

export interface FreeSnapshotPriority {
  title: string;
  rationale: string;
}

export interface FreeSnapshotReportInput {
  name: string;
  company: string;
  website: string;
  category: string | null;
  biggestCompetitor: string | null;
}

export interface FreeSnapshotReport {
  generatedAt: string;
  input: FreeSnapshotReportInput;
  aiVisibility: {
    score: number;
    mentionScore: number;
    recommendationScore: number;
    positionScore: number;
    coverageScore: number;
    formulaVersion: string;
    queriesRun: number;
    providers: string[];
  };
  seo: {
    technicalScore: number;
    contentScore: number;
    pagesAnalyzed: number;
  };
  competitors: CompetitorAppearance[];
  topAiGaps: AiGap[];
  topSeoGaps: SeoGap[];
  topPriorities: FreeSnapshotPriority[];
  cta: string;
  simplificationNote: string;
}

/** `GET /snapshot/:token`'s three response shapes, discriminated by
 *  `status` — never a shared "maybe undefined" object, so a caller can
 *  switch on `status` and get real narrowing. */
export type SnapshotStatusResponse =
  | { status: "pending" | "processing"; message: string }
  | { status: "failed"; message: string }
  | { status: "complete"; report: FreeSnapshotReport };
