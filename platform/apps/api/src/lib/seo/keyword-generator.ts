/**
 * Epic 4's "generate from brand profile" action
 * (`docs/epics/04-seo-intelligence.md`'s API surface: "seeds an initial
 * keyword list from Epic 2's use_cases/categories via the SEODataProvider").
 *
 * Pure, deterministic, no AI call and no database access — same shape as
 * Epic 5's `query-generator.ts` (`generateCandidateQueries`), which this
 * module deliberately mirrors: takes a plain brand-profile shape assembled
 * by the route from Epic 2's real `brands`/`use_cases` rows, returns a
 * candidate list of keyword PHRASES (plain strings — the actual
 * volume/difficulty/intent/confidence enrichment is `SEODataProvider`'s job,
 * called by the route AFTER this list is produced, never guessed here).
 *
 * End-to-end flow step 2's hard requirement — "confirm it actually reads
 * Epic 2's use_cases/categories (not a hardcoded fixture)" — is satisfied by
 * this function taking that data as its only input and containing no
 * literal brand-specific strings itself.
 */

export interface KeywordGeneratorUseCase {
  title: string;
  industries: string[];
  painPoints: string[];
  solutions: string[];
}

export interface KeywordGeneratorBrandProfile {
  /** `brands.categories[]` (Epic 2 QA fix — plural array). */
  categories: string[];
  useCases: KeywordGeneratorUseCase[];
}

/** Safety bound on generator OUTPUT size — not a plan/entitlement limit (no
 * numeric SEO keyword cap is documented anywhere in
 * `docs/16-billing/BILLING_ARCHITECTURE.md`'s Plan Limits table, unlike
 * `competitors_tracked`/`queries_per_query_set` — see
 * `docs/epics/04-seo-intelligence-backend.md`'s "what's not done" section).
 * This exists only so a brand profile with a large cross-product of
 * categories × use cases × industries cannot generate an unbounded
 * candidate list in one call. */
export const MAX_GENERATED_KEYWORDS = 100;

/**
 * Generates candidate keyword phrases from a brand profile — uncapped
 * (callers apply `MAX_GENERATED_KEYWORDS` themselves, mirroring
 * `query-generator.ts`'s uncapped/capped split so unit tests can assert the
 * full candidate list independent of any cap).
 *
 * Deduplication is case-insensitive; iteration order is category, then
 * that category's own phrase, then each use case's industries/pain
 * points/solutions — insertion order, so a fixed brand-profile fixture
 * always produces the exact same list in the exact same order.
 */
export function generateCandidateKeywords(brand: KeywordGeneratorBrandProfile): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function add(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  }

  for (const category of brand.categories) {
    add(category);
    add(`best ${category}`);

    for (const useCase of brand.useCases) {
      add(`${category} for ${useCase.title}`);
      for (const industry of useCase.industries) {
        add(`${category} for ${industry}`);
      }
      for (const painPoint of useCase.painPoints) {
        add(painPoint);
      }
      for (const solution of useCase.solutions) {
        add(solution);
      }
    }
  }

  return out;
}

/** The entitlement-free, capped entry point routes should call — see
 * `MAX_GENERATED_KEYWORDS`'s doc comment for why this is a safety bound, not
 * a plan-tier limit. */
export function generateKeywordCandidates(brand: KeywordGeneratorBrandProfile): string[] {
  return generateCandidateKeywords(brand).slice(0, MAX_GENERATED_KEYWORDS);
}
