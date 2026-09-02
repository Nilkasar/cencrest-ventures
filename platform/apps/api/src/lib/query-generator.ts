/**
 * Epic 5 (Intent & Query Universe) — the template-based query generator.
 *
 * Pure, deterministic, no AI call and no database access: takes a plain
 * brand-profile shape (assembled by the route from Epic 2's `brands`/
 * `use_cases`/`competitors` rows) and returns a candidate list of queries
 * spanning the ten categories documented in `docs/11-geo/GEO_ENGINE.md`
 * ("Query Categories") and `docs/epics/05-intent-query-universe.md`:
 *
 *   1. Category    — "What is [category]?"
 *   2. Problem      — "How do I solve [problem]?"
 *   3. Commercial   — "Best [category] for [use case]?"
 *   4. Comparison   — "[Brand] vs [Competitor]"
 *   5. Feature      — "Which [category] has [feature]?"
 *   6. Industry     — "Best [category] for [industry]?"
 *   7. Size         — "Best [category] for [company size]?"
 *   8. Geography    — "Best [category] in [location]?"
 *   9. Intent (JTBD)— "How to [job-to-be-done]?"
 *  10. Authority    — "Who are the experts in [category]?"
 *
 * Field-source mapping (the epic doc gives three worked examples — "best
 * {category} for {use_case.industry}", "{brand} vs {competitor}", "what is
 * {category}" — this module fills in the remaining seven the same way,
 * against the exact fields Epic 2 actually shipped, see
 * packages/database/DECISIONS.md §13/§15):
 *   - Category / Authority   <- brands.categories[]
 *   - Commercial             <- brands.categories[] x use_cases.title
 *   - Industry               <- brands.categories[] x use_cases.industries[]
 *   - Size                   <- brands.categories[] x use_cases.company_sizes[]
 *   - Problem                <- use_cases.pain_points[]
 *   - Intent (JTBD)          <- use_cases.solutions[]
 *   - Feature                <- brands.categories[] x brands.differentiators[]
 *     (the ported schema has no separate "product feature" list; a brand's
 *     differentiators are the closest existing profile field — see the
 *     completion doc for this call).
 *   - Geography              <- brands.categories[] x brands.markets[]
 *   - Comparison              <- brand name vs competitors.name
 *
 * `text` deduplication (case-insensitive, per category) prevents two
 * identical inputs — e.g. the same industry listed on two use cases — from
 * producing two literal-duplicate queries; iteration order is otherwise
 * insertion order (categories, then use cases, then that use case's arrays)
 * so a fixed fixture always produces the exact same list, in the exact
 * same order — required for `query-generator.test.ts`'s exact-array
 * assertions and for `generateQueryUniverse`'s cap to slice off the same
 * queries every time for a given brand profile + limit.
 */

export type QueryTemplateCategory =
  | 'category'
  | 'problem'
  | 'commercial'
  | 'comparison'
  | 'feature'
  | 'industry'
  | 'size'
  | 'geography'
  | 'intent'
  | 'authority';

export const QUERY_TEMPLATE_CATEGORIES: readonly QueryTemplateCategory[] = [
  'category',
  'problem',
  'commercial',
  'comparison',
  'feature',
  'industry',
  'size',
  'geography',
  'intent',
  'authority',
];

export type QueryIntentType = 'informational' | 'commercial' | 'comparison' | 'transactional';

export interface GeneratedQuery {
  text: string;
  category: QueryTemplateCategory;
  intentType: QueryIntentType;
  tags: string[];
  priority: 1 | 2 | 3;
}

export interface QueryGeneratorUseCase {
  title: string;
  industries: string[];
  companySizes: string[];
  painPoints: string[];
  solutions: string[];
}

export interface QueryGeneratorCompetitor {
  name: string;
}

export interface QueryGeneratorBrandProfile {
  name: string;
  /** `brands.categories[]` (Epic 2 QA fix — plural array, see DECISIONS.md §15). */
  categories: string[];
  /** `brands.differentiators[]` — stands in for "feature" queries; see module header. */
  differentiators: string[];
  /** `brands.markets[]` — geographic markets, feeds Geography queries. */
  markets: string[];
  useCases: QueryGeneratorUseCase[];
  competitors: QueryGeneratorCompetitor[];
}

/**
 * Per-template-category defaults for the two fields the epic's own spec
 * doesn't hand-derive from the brand profile: `intentType` (the four-value
 * buyer-funnel classification) and `priority` (1=high/2=medium/3=low).
 * Bottom-of-funnel categories (a head-to-head Comparison, or a "best X for
 * Y" Commercial query — the moments GEO's whole thesis says matter most,
 * per docs/11-geo/GEO_ENGINE.md's Recommendation Score weighting) are
 * ranked highest; broad top-of-funnel education (Category/Authority) and
 * Geography (relevant only to brands that actually compete on location)
 * are ranked lowest. This mapping is this epic's own design decision, not
 * given verbatim anywhere in the source docs — see the completion doc.
 *
 * Exported (post-verification fix): `routes/query-sets.ts`'s manual-add
 * endpoint reuses this exact mapping to derive a non-null `intentType` from
 * a caller-supplied `category` when the request doesn't specify one —
 * reconciling the frontend's non-nullable `Query.intentType` without
 * duplicating this table a second time in the route file.
 */
export const CATEGORY_META: Record<QueryTemplateCategory, { intentType: QueryIntentType; priority: 1 | 2 | 3 }> = {
  category: { intentType: 'informational', priority: 3 },
  authority: { intentType: 'informational', priority: 3 },
  problem: { intentType: 'informational', priority: 3 },
  commercial: { intentType: 'commercial', priority: 1 },
  comparison: { intentType: 'comparison', priority: 1 },
  feature: { intentType: 'commercial', priority: 2 },
  industry: { intentType: 'commercial', priority: 2 },
  size: { intentType: 'commercial', priority: 2 },
  intent: { intentType: 'transactional', priority: 2 },
  geography: { intentType: 'commercial', priority: 3 },
};

/**
 * Generates every candidate query the template set can produce from a
 * brand profile — uncapped. Callers that need to respect a plan's
 * `queries_per_query_set` entitlement limit should use
 * `generateQueryUniverse` instead, which caps the result; this function is
 * exported on its own because the unit tests assert the full, uncapped,
 * exact candidate list for a fixed fixture.
 */
export function generateCandidateQueries(brand: QueryGeneratorBrandProfile): GeneratedQuery[] {
  const out: GeneratedQuery[] = [];
  const seen = new Set<string>();

  function add(category: QueryTemplateCategory, text: string, tags: string[]): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const key = `${category}::${trimmed.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = CATEGORY_META[category];
    out.push({ text: trimmed, category, intentType: meta.intentType, priority: meta.priority, tags });
  }

  for (const category of brand.categories) {
    add('category', `What is ${category}?`, [category]);
    add('authority', `Who are the experts in ${category}?`, [category]);

    for (const useCase of brand.useCases) {
      add('commercial', `Best ${category} for ${useCase.title}?`, [category, useCase.title]);

      for (const industry of useCase.industries) {
        add('industry', `Best ${category} for ${industry}?`, [category, industry]);
      }
      for (const size of useCase.companySizes) {
        add('size', `Best ${category} for ${size} companies?`, [category, size]);
      }
      for (const painPoint of useCase.painPoints) {
        add('problem', `How do I solve ${painPoint}?`, [category, painPoint]);
      }
      for (const solution of useCase.solutions) {
        add('intent', `How to ${solution}?`, [category, solution]);
      }
    }

    for (const differentiator of brand.differentiators) {
      add('feature', `Which ${category} has ${differentiator}?`, [category, differentiator]);
    }
    for (const market of brand.markets) {
      add('geography', `Best ${category} in ${market}?`, [category, market]);
    }
  }

  for (const competitor of brand.competitors) {
    add('comparison', `${brand.name} vs ${competitor.name}`, [competitor.name]);
  }

  return out;
}

/**
 * The entitlement-capped entry point routes should call. `limit === null`
 * means unlimited (the plan tier has no cap — see
 * `apps/api/src/lib/entitlements.ts`'s `queries_per_query_set`). Capping
 * happens by truncating the deterministically-ordered candidate list, so
 * "cap the generated count at the plan's limit" (the epic's own wording)
 * is satisfied by construction: the route never persists more than
 * `limit` rows, it does not generate-then-discard.
 */
export function generateQueryUniverse(
  brand: QueryGeneratorBrandProfile,
  limit: number | null,
): GeneratedQuery[] {
  const candidates = generateCandidateQueries(brand);
  if (limit === null) return candidates;
  return candidates.slice(0, limit);
}
