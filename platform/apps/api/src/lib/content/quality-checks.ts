/**
 * Epic 11 (Content Intelligence & Generation) — step 4 of the generation
 * pipeline, the epic's literal 5-check list: fact-check against
 * `brand_claims` (Epic 2), brand-voice consistency, duplicate-content check
 * against Epic 3's crawled `pages`, SEO checklist (reuses Epic 4's
 * `lib/seo/technical-checklist.ts`), GEO structuring principles
 * (`docs/11-geo/GEO_ENGINE.md`: FAQ format, numbered lists, citable
 * statements).
 *
 * Every function here is pure (no DB/network/clock) and returns its own
 * full result — this epic's explicit DoD: "every check's result stored,
 * not just a pass/fail flag... a reviewer approving a draft needs to see
 * what was checked, not just that something was." `routes/content-briefs.ts`
 * persists each result as its own `content_quality_checks` row.
 */
import { runContentChecklist } from '../seo/technical-checklist.js';

export type QualityCheckType = 'fact_check' | 'brand_voice' | 'duplicate_content' | 'seo_checklist' | 'geo_structure';
export type QualityCheckStatus = 'pass' | 'fail' | 'warning';

export interface QualityCheckResult {
  checkType: QualityCheckType;
  status: QualityCheckStatus;
  score: number | null;
  details: Record<string, unknown>;
}

// ── fact_check ───────────────────────────────────────────────────────────
// v1 heuristic (documented, not an attempt at real NLP fact-checking, same
// "deterministic, versioned-by-being-unit-tested design decision" precedent
// `lib/seo/technical-checklist.ts`'s SEVERITY_DEDUCTION already sets):
// flag ungrounded absolute/superlative claims the draft makes that no
// VERIFIED brand_claims row backs. A claim IS grounded if some verified
// brand_claims row's own text contains the same risky phrase — i.e. the
// brand itself has verified making that claim.
const RISKY_CLAIM_PATTERNS: RegExp[] = [
  /\bguaranteed\b/i,
  /\b100%\b/,
  /#1\b/,
  /\bthe best\b/i,
  /\bzero risk\b/i,
  /\balways\b/i,
  /\bnever fails\b/i,
];

export interface BrandClaimForCheck {
  claim: string;
  verified: boolean;
}

export function runFactCheck(body: string, brandClaims: BrandClaimForCheck[]): QualityCheckResult {
  const verifiedClaims = brandClaims.filter((c) => c.verified);
  const riskyPhrasesFound: string[] = [];
  const groundedPhrases: string[] = [];

  for (const pattern of RISKY_CLAIM_PATTERNS) {
    const match = pattern.exec(body);
    if (!match) continue;
    const phrase = match[0];
    const isGrounded = verifiedClaims.some((c) => c.claim.toLowerCase().includes(phrase.toLowerCase()));
    (isGrounded ? groundedPhrases : riskyPhrasesFound).push(phrase);
  }

  const status: QualityCheckStatus = riskyPhrasesFound.length > 0 ? 'fail' : 'pass';
  return {
    checkType: 'fact_check',
    status,
    score: riskyPhrasesFound.length > 0 ? 0 : 100,
    details: {
      riskyPhrasesFound,
      groundedPhrases,
      brandClaimsConsidered: brandClaims.length,
      verifiedClaimsConsidered: verifiedClaims.length,
    },
  };
}

// ── brand_voice ──────────────────────────────────────────────────────────
// v1 heuristic: the brand must actually be named somewhere in its own
// content, and the draft must never leak an AI-assistant disclaimer phrase
// into customer-facing copy (a real, observable failure mode of LLM
// completions, not a hypothetical one) — both are deterministic,
// unit-testable signals of "does this actually sound like this brand's
// content," not a subjective tone judgment this v1 does not attempt.
const AI_DISCLAIMER_PATTERNS: RegExp[] = [/as an ai language model/i, /i cannot provide/i, /i'm just an ai/i, /as a language model/i];

export function runBrandVoiceCheck(body: string, brandName: string): QualityCheckResult {
  const brandNameMentioned = brandName.length > 0 && body.toLowerCase().includes(brandName.toLowerCase());
  const aiDisclaimerPhrasesFound = AI_DISCLAIMER_PATTERNS.filter((p) => p.test(body)).map((p) => p.source);

  const status: QualityCheckStatus = brandNameMentioned && aiDisclaimerPhrasesFound.length === 0 ? 'pass' : 'fail';
  return {
    checkType: 'brand_voice',
    status,
    score: status === 'pass' ? 100 : 0,
    details: { brandNameMentioned, aiDisclaimerPhrasesFound },
  };
}

// ── duplicate_content ────────────────────────────────────────────────────
// Epic 3's `pages` table stores no body text at all (only hashed —
// `lib/html-extract.ts`'s "HTML string itself is never persisted" — see
// `lib/seo/technical-checklist.ts`'s own header comment for the same
// documented scope limit on a related check), so a full-text diff against
// a draft's body is not possible from stored data. This compares TITLES
// (word-set Jaccard similarity) — the one textual signal both a draft and
// an already-crawled page actually have — same "documented scope decision,
// not a silent omission" treatment as `technical-checklist.ts`'s own list
// of checklist items it deliberately does not implement.
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DUPLICATE_WARNING_THRESHOLD = 0.6;

export interface ExistingPageForDuplicateCheck {
  url: string;
  title: string | null;
  h1: string | null;
}

export function runDuplicateContentCheck(draftTitle: string, pages: ExistingPageForDuplicateCheck[]): QualityCheckResult {
  const draftTokens = tokenize(draftTitle);
  let mostSimilarUrl: string | null = null;
  let similarity = 0;
  let exactTitleMatch = false;

  for (const page of pages) {
    const pageTitle = page.title ?? page.h1 ?? '';
    if (!pageTitle) continue;
    if (pageTitle.trim().toLowerCase() === draftTitle.trim().toLowerCase()) {
      mostSimilarUrl = page.url;
      similarity = 1;
      exactTitleMatch = true;
      break;
    }
    const sim = jaccardSimilarity(draftTokens, tokenize(pageTitle));
    if (sim > similarity) {
      similarity = sim;
      mostSimilarUrl = page.url;
    }
  }

  const status: QualityCheckStatus = exactTitleMatch ? 'fail' : similarity >= DUPLICATE_WARNING_THRESHOLD ? 'warning' : 'pass';
  return {
    checkType: 'duplicate_content',
    status,
    score: Math.round((1 - similarity) * 100),
    details: {
      pagesChecked: pages.length,
      mostSimilarUrl,
      titleSimilarity: Math.round(similarity * 100) / 100,
      exactTitleMatch,
    },
  };
}

// ── seo_checklist ────────────────────────────────────────────────────────
// Reuses Epic 4's OWN `runContentChecklist` (`lib/seo/technical-checklist.ts`)
// rather than re-deriving a second, potentially-drifting word-count/schema
// scoring formula — this epic's task brief's explicit "SEO checklist reuse
// from Epic 4." Adds the two checklist items that function does not cover
// (title/meta length — it operates on already-crawled `pages` rows, which
// have no length-check step of their own either) as this check's own,
// documented addition.
const TITLE_LENGTH_RANGE = { min: 50, max: 60 };
const META_LENGTH_RANGE = { min: 140, max: 160 };

export interface DraftForSeoCheck {
  title: string;
  metaDescription: string | null;
  wordCount: number;
  structuredDataTypes: string[];
}

export function runSeoChecklistCheck(draft: DraftForSeoCheck): QualityCheckResult {
  const contentChecklist = runContentChecklist([{ word_count: draft.wordCount, schema_types: draft.structuredDataTypes }]);

  const titleLength = draft.title.length;
  const titleLengthOk = titleLength >= TITLE_LENGTH_RANGE.min && titleLength <= TITLE_LENGTH_RANGE.max;
  const metaDescriptionLength = draft.metaDescription?.length ?? 0;
  const metaDescriptionOk = draft.metaDescription !== null && metaDescriptionLength >= META_LENGTH_RANGE.min && metaDescriptionLength <= META_LENGTH_RANGE.max;

  // 60% weight on Epic 4's reused content score, 20% each for title/meta
  // length — same "documented v1 weighting, not a reverse-engineered
  // 'correct' formula" precedent `runContentChecklist` itself already sets
  // for its own 50/50 split.
  const score = Math.round(contentChecklist.score * 0.6 + (titleLengthOk ? 20 : 0) + (metaDescriptionOk ? 20 : 0));
  const status: QualityCheckStatus = score >= 80 ? 'pass' : score >= 50 ? 'warning' : 'fail';

  return {
    checkType: 'seo_checklist',
    status,
    score,
    details: {
      contentChecklist: contentChecklist.findings,
      titleLength,
      titleLengthOk,
      metaDescriptionLength,
      metaDescriptionOk,
    },
  };
}

// ── geo_structure ────────────────────────────────────────────────────────
// Transcribed from `docs/11-geo/GEO_ENGINE.md`'s GEO Optimization
// Principles as already carried into this codebase by
// `lib/recommendations/generator.ts`'s `GEO_REQUIREMENTS` table (principle
// 5: "write claims in FAQ/numbered-list form AI can lift directly";
// principle 4: "named, citable evidence"; principle 2: "explicitly state
// the entity association between the brand and this use case"). Principles
// 1 (server-rendered) and 7 (freshness) are not inspectable from a
// not-yet-published draft's text alone — same documented scope limit
// `technical-checklist.ts`'s header comment already sets a precedent for.
export function runGeoStructureCheck(body: string, brandName: string, targetQuery: string): QualityCheckResult {
  const hasNumberedList = /^\s*\d+\.\s/m.test(body);
  const questionMarkCount = (body.match(/\?/g) ?? []).length;
  const hasFaqSignal = /faq/i.test(body) || questionMarkCount >= 2;
  const hasCitableStatement = /\b\d+%\b/.test(body) || /\b(19|20)\d{2}\s+(study|report|survey)\b/i.test(body) || /according to/i.test(body);
  const queryKeywords = targetQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3);
  const hasEntityAssociation =
    brandName.length > 0 &&
    body.toLowerCase().includes(brandName.toLowerCase()) &&
    (queryKeywords.length === 0 || queryKeywords.some((word) => body.toLowerCase().includes(word)));

  const signals = { hasNumberedList, hasFaqSignal, hasCitableStatement, hasEntityAssociation };
  const passedCount = Object.values(signals).filter(Boolean).length;
  const status: QualityCheckStatus = passedCount >= 3 ? 'pass' : passedCount >= 2 ? 'warning' : 'fail';

  return {
    checkType: 'geo_structure',
    status,
    score: Math.round((passedCount / 4) * 100),
    details: { signals },
  };
}

// ── aggregator ───────────────────────────────────────────────────────────
export interface DraftForQualityChecks extends DraftForSeoCheck {
  body: string;
}

export interface RunAllQualityChecksInput {
  draft: DraftForQualityChecks;
  brandName: string;
  targetQuery: string;
  brandClaims: BrandClaimForCheck[];
  existingPages: ExistingPageForDuplicateCheck[];
}

/** Runs all 5 checks, always, in this fixed order — this epic's DoD:
 * "a test proving draft generation never bypasses the quality-check step."
 * Never throws (each check is a pure string/array computation over data
 * already fetched by the caller). */
export function runAllQualityChecks(input: RunAllQualityChecksInput): QualityCheckResult[] {
  const { draft, brandName, targetQuery, brandClaims, existingPages } = input;
  const fullText = `${draft.title}\n${draft.body}`;
  return [
    runFactCheck(fullText, brandClaims),
    runBrandVoiceCheck(draft.body, brandName),
    runDuplicateContentCheck(draft.title, existingPages),
    runSeoChecklistCheck(draft),
    runGeoStructureCheck(draft.body, brandName, targetQuery),
  ];
}
