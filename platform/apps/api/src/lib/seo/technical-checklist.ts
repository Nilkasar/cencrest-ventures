/**
 * Epic 4's slice of `docs/10-seo/SEO_ENGINE.md`'s "Page Analysis Checklist."
 *
 * Epic 3's crawler (`lib/crawler/engine.ts`) already runs most of this
 * checklist AT CRAWL TIME and writes the results as `page_issues` rows
 * (`missing_title`, `title_too_long`, `duplicate_title`, `missing_meta`,
 * `meta_too_long`, `missing_h1`, `missing_canonical`, `thin_content`,
 * `noindex`, `missing_alt`, `broken_link` — verified by reading
 * `engine.ts` before writing this file, per the task brief's "read
 * src/routes/pages.ts for the real shape — do not guess"). `POST
 * /brands/me/seo/analyze` does NOT re-derive those — that would just be a
 * second, potentially-drifting copy of logic Epic 3 already owns and ran.
 *
 * What this module actually does:
 *   1. Runs the TWO checklist items the crawler does not cover from stored
 *      data alone (see the header comment on `runTechnicalChecklist` below
 *      for exactly why only these two, not more) and returns any NEW
 *      `page_issues` rows they produce.
 *   2. Aggregates ALL of a page's issues (Epic 3's pre-existing ones, plus
 *      the new ones from step 1) into one deterministic technical health
 *      score (0-100) and a `findings` JSON blob (`seo_analyses.findings`).
 *
 * Checklist items deliberately NOT implemented, and why (so this gap is a
 * documented decision, not a silent omission):
 *   - "Contains primary keyword" (title/meta/H1/content) — there is no
 *     "primary keyword for this page" field anywhere in the schema; a page
 *     is never associated with one specific target keyword today. Scoring
 *     this would require guessing which of a brand's keywords a page
 *     "should" rank for, which is a real feature (keyword-to-page mapping)
 *     no epic has built yet, not a two-line heuristic.
 *   - Heading hierarchy (H2s exist, no skipped levels) — `pages` stores only
 *     a single `h1` string, no structured heading array. Cannot be computed
 *     from data that was never captured; adding H2-N capture is a Website
 *     Intelligence (Epic 3) crawler change, out of scope for this epic's
 *     backend-only task.
 *   - Robots.txt accessibility / "in sitemap" — both require either a live
 *     fetch (disallowed — this epic makes zero real network calls) or a
 *     join against `sitemaps.url_count`, which records a COUNT per sitemap
 *     URL, not which individual page URLs are listed inside it (Epic 3
 *     never parses that far) — there is nothing to join against per-page.
 *   - Redirect chains, "no broken internal links FROM this page" — Epic 3's
 *     crawler already flags a page that IS a broken link's target
 *     (`broken_link` on the 404'd page itself); tracing every outbound link
 *     ON a page and checking each one's live status is a graph-traversal
 *     feature belonging to the crawler, not a checklist read over already-
 *     stored rows.
 */

import type { issue_severity, issue_type, page_issues, pages } from '@bebest/database';

/**
 * The minimal shape `runTechnicalChecklist` actually reads (`url`,
 * `schema_types`, and each existing issue's `issue_type`/`severity`/
 * `detail`) — deliberately narrower than the full `pages`/`page_issues`
 * Prisma models so the function stays reusable anywhere a page has been
 * fetched but was never persisted as a real `pages` row (Epic 17's
 * free-snapshot orchestrator, which crawls a small, unauthenticated sample
 * with no `brand_id`/`organization_id` to attach a real row to — see
 * `lib/free-snapshot/seo-analysis.ts`). A real `pages & { page_issues }`
 * row (this epic's own `routes/seo.ts` caller) already structurally
 * satisfies this interface, so narrowing the parameter type changes
 * nothing about how Epic 4's own callers behave.
 */
export interface TechnicalChecklistPageInput {
  url: string;
  schema_types: string[];
  page_issues: Array<Pick<page_issues, 'issue_type' | 'severity' | 'detail'>>;
}

export interface ChecklistCheck {
  id: string;
  passed: boolean;
  severity: issue_severity | null;
  detail: string | null;
}

export interface TechnicalAnalysisResult {
  score: number;
  findings: { checks: ChecklistCheck[] };
  /** New `page_issues` rows to insert — checks 1-2 below, and ONLY when no
   * existing issue of that type is already on the page (re-running analyze
   * must not pile up duplicate issue rows). */
  newIssues: Array<{ issue_type: issue_type; severity: issue_severity; detail: string | null }>;
}

/** Per-severity score deduction. Deterministic and documented (the epic
 * spec gives a verbatim formula for OPPORTUNITY scoring, but not for this
 * per-page technical health score — this weighting is this module's own,
 * versioned-by-being-unit-tested design decision, same as
 * `query-generator.ts`'s `CATEGORY_META` priority mapping). */
const SEVERITY_DEDUCTION: Record<issue_severity, number> = { high: 15, medium: 8, low: 3 };

function deduct(score: number, severity: issue_severity): number {
  return Math.max(0, score - SEVERITY_DEDUCTION[severity]);
}

/**
 * The two NEW checks (not already covered by Epic 3's crawler — see this
 * file's header comment): HTTPS (checklist's "Technical" section) and
 * Schema markup on the homepage (checklist's "Schema" section, narrowed to
 * "Organization schema on homepage" specifically, since that is the one
 * schema-type check this data actually supports — a page's "role" beyond
 * "is this the homepage" (FAQ page? article? service page?) is not modeled
 * anywhere `pages` stores, so the FAQ/Article/Product schema checks cannot
 * be targeted at the right pages without guessing).
 *
 * `isHomepage`: true when `page.url` matches the crawl job's own
 * `root_url` (the crawl's entry point) — passed in by the caller
 * (`routes/seo.ts`) rather than re-queried here, keeping this function pure
 * and independently unit-testable.
 */
export function runTechnicalChecklist(
  page: TechnicalChecklistPageInput,
  isHomepage: boolean,
): TechnicalAnalysisResult {
  const existingTypes = new Set(page.page_issues.map((issue) => issue.issue_type));
  const checks: ChecklistCheck[] = [];
  const newIssues: TechnicalAnalysisResult['newIssues'] = [];
  let score = 100;

  // ── Aggregate Epic 3's already-derived issues ─────────────────────────
  for (const issue of page.page_issues) {
    checks.push({ id: issue.issue_type, passed: false, severity: issue.severity, detail: issue.detail });
    score = deduct(score, issue.severity);
  }

  // ── New check 1: HTTPS ────────────────────────────────────────────────
  const isHttps = page.url.toLowerCase().startsWith('https://');
  checks.push({ id: 'https', passed: isHttps, severity: isHttps ? null : 'medium', detail: null });
  if (!isHttps && !existingTypes.has('not_https')) {
    newIssues.push({ issue_type: 'not_https', severity: 'medium', detail: null });
    score = deduct(score, 'medium');
  }

  // ── New check 2: Organization schema on the homepage ─────────────────
  if (isHomepage) {
    const hasOrgSchema = page.schema_types.includes('Organization');
    checks.push({
      id: 'homepage_organization_schema',
      passed: hasOrgSchema,
      severity: hasOrgSchema ? null : 'low',
      detail: hasOrgSchema ? null : 'No Organization schema.org markup found on the homepage.',
    });
    if (!hasOrgSchema && !existingTypes.has('missing_schema')) {
      newIssues.push({
        issue_type: 'missing_schema',
        severity: 'low',
        detail: 'No Organization schema.org markup found on the homepage.',
      });
      score = deduct(score, 'low');
    }
  }

  return { score, findings: { checks }, newIssues };
}

export interface ContentAnalysisResult {
  score: number;
  findings: {
    pagesAnalyzed: number;
    averageWordCount: number;
    thinContentPages: number;
    pagesWithSchemaMarkup: number;
    pagesWithoutSchemaMarkup: number;
  };
}

/**
 * Brand-level aggregate (`seo_analyses.analysis_type = 'content'`,
 * `page_id = null`) — a v1 composite over the same crawled-page set the
 * technical analysis above runs per-page against. Deliberately simple: a
 * weighted average is not specified anywhere in the source docs for this
 * (only the SEO OPPORTUNITY formula is given verbatim), so this is a
 * documented, unit-tested design choice, not an attempt to reverse-engineer
 * an unstated "correct" formula. `THIN_CONTENT_WORD_MIN` matches the
 * checklist's own literal "Minimum 300 words" line.
 */
const THIN_CONTENT_WORD_MIN = 300;

/** Same narrowing rationale as `TechnicalChecklistPageInput` above — only
 * `word_count`/`schema_types` are ever read. */
export type ContentChecklistPageInput = Pick<pages, 'word_count' | 'schema_types'>;

export function runContentChecklist(pages_: ContentChecklistPageInput[]): ContentAnalysisResult {
  const pagesAnalyzed = pages_.length;
  if (pagesAnalyzed === 0) {
    return {
      score: 0,
      findings: { pagesAnalyzed: 0, averageWordCount: 0, thinContentPages: 0, pagesWithSchemaMarkup: 0, pagesWithoutSchemaMarkup: 0 },
    };
  }

  const totalWords = pages_.reduce((sum, page) => sum + page.word_count, 0);
  const thinContentPages = pages_.filter((page) => page.word_count < THIN_CONTENT_WORD_MIN).length;
  const pagesWithSchemaMarkup = pages_.filter((page) => page.schema_types.length > 0).length;

  const averageWordCount = Math.round(totalWords / pagesAnalyzed);
  const thinContentRatio = thinContentPages / pagesAnalyzed;
  const schemaRatio = pagesWithSchemaMarkup / pagesAnalyzed;

  // 50% weight on "not thin," 50% on "has schema markup" — the two content
  // signals this data actually supports (see this module's header comment
  // for what could not be included: primary-keyword coverage, heading
  // structure).
  const score = Math.round((1 - thinContentRatio) * 50 + schemaRatio * 50);

  return {
    score,
    findings: {
      pagesAnalyzed,
      averageWordCount,
      thinContentPages,
      pagesWithSchemaMarkup,
      pagesWithoutSchemaMarkup: pagesAnalyzed - pagesWithSchemaMarkup,
    },
  };
}
