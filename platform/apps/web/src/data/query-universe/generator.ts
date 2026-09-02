import { QUERY_CATEGORIES, type QueryCategory, type QueryIntentType, type QueryPriority } from "./types";
import { CATEGORY_INTENT_TYPE, CATEGORY_DEFAULT_PRIORITY } from "./constants";
import type { GenerationSeed } from "./seed";

/**
 * The template-based query generator — `docs/epics/05-intent-query-
 * universe.md`'s "Generation logic": ten categories, each templated from
 * the brand profile, no LLM involved. Pure and deterministic (same seed +
 * limit always produces the same candidates in the same order), the same
 * property the epic's backend DoD asks of the real generator's unit tests.
 */

export interface GeneratedCandidate {
  text: string;
  category: QueryCategory;
  intentType: QueryIntentType;
  priority: QueryPriority;
  tags: string[];
}

function candidate(category: QueryCategory, text: string, tags: string[] = []): GeneratedCandidate {
  return {
    text,
    category,
    intentType: CATEGORY_INTENT_TYPE[category],
    priority: CATEGORY_DEFAULT_PRIORITY[category],
    tags: [category, ...tags],
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** One bucket of candidates per category, built straight from the ten
 *  templates `docs/11-geo/GEO_ENGINE.md` documents. Kept as named buckets
 *  (rather than one flat push-as-you-go array) so `generateQueryCandidates`
 *  can interleave categories evenly before a plan cap is applied — the
 *  epic's DoD explicitly checks generated queries "span multiple of the ten
 *  documented categories, not just one or two templates applied repeatedly." */
function buildCategoryBuckets(seed: GenerationSeed): Record<QueryCategory, GeneratedCandidate[]> {
  const industries = unique(seed.useCases.map((uc) => uc.industry));
  const companySizes = unique(seed.useCases.map((uc) => uc.companySize));

  return {
    category: seed.categories.flatMap((cat) => [
      candidate("category", `What is ${cat}?`),
      candidate("category", `What exactly does ${cat} do?`),
    ]),

    problem: [
      ...seed.useCases.map((uc) =>
        candidate("problem", `How do I solve ${uc.painPoint}?`, [`use-case:${uc.id}`]),
      ),
      ...seed.categories.map((cat) => candidate("problem", `What problems does ${cat} solve?`)),
    ],

    commercial: [
      ...seed.categories.flatMap((cat) =>
        seed.useCases.map((uc) =>
          candidate("commercial", `Best ${cat} to ${uc.jobToBeDone}?`, [`use-case:${uc.id}`]),
        ),
      ),
      ...seed.categories.map((cat) => candidate("commercial", `Best ${cat}?`)),
    ],

    comparison: [
      ...seed.competitors.flatMap((competitor) => [
        candidate("comparison", `${seed.brandName} vs ${competitor}`, [`competitor:${competitor}`]),
        candidate("comparison", `${competitor} alternative`, [`competitor:${competitor}`]),
      ]),
      ...seed.categories.map((cat) => candidate("comparison", `${capitalizeFirst(cat)} comparison`)),
    ],

    feature: seed.categories.flatMap((cat) =>
      seed.features.map((feature) => candidate("feature", `Which ${cat} has ${feature}?`, [`feature:${feature}`])),
    ),

    industry: seed.categories.flatMap((cat) =>
      industries.map((industry) => candidate("industry", `Best ${cat} for ${industry}?`, [`industry:${industry}`])),
    ),

    size: seed.categories.flatMap((cat) =>
      companySizes.map((size) =>
        candidate("size", `Best ${cat} for ${size} companies?`, [`company-size:${size}`]),
      ),
    ),

    geography: seed.categories.flatMap((cat) =>
      seed.geographies.map((geo) => candidate("geography", `Best ${cat} in ${geo}?`, [`geography:${geo}`])),
    ),

    intent: seed.useCases.map((uc) =>
      candidate("intent", `How to ${uc.jobToBeDone}?`, [`use-case:${uc.id}`]),
    ),

    authority: seed.categories.flatMap((cat) => [
      candidate("authority", `Who are the experts in ${cat}?`),
      candidate("authority", `Who are the leading providers of ${cat}?`),
    ]),
  };
}

export interface GenerationResult {
  /** Capped at `limit`, interleaved round-robin across categories. */
  candidates: GeneratedCandidate[];
  /** The uncapped total the brand profile could produce — lets the UI
   *  explain when and by how much the plan cap actually bound. */
  potentialCount: number;
}

/**
 * Generates the capped, category-interleaved candidate list. The cap is
 * applied while building the ordered list, not after generating everything
 * and truncating — DoD #2 ("check the cap going in," not "generate 1,400
 * and truncate") — though for a pure in-memory template expansion like this
 * one, the distinction is about intent/order, not runtime cost.
 */
export function generateQueryCandidates(seed: GenerationSeed, limit: number): GenerationResult {
  const buckets = buildCategoryBuckets(seed);
  const potentialCount = QUERY_CATEGORIES.reduce((sum, cat) => sum + buckets[cat].length, 0);

  const candidates: GeneratedCandidate[] = [];
  const cursors: Record<QueryCategory, number> = Object.fromEntries(
    QUERY_CATEGORIES.map((cat) => [cat, 0]),
  ) as Record<QueryCategory, number>;

  let remaining = potentialCount;
  while (candidates.length < limit && remaining > 0) {
    for (const cat of QUERY_CATEGORIES) {
      if (candidates.length >= limit) break;
      const bucket = buckets[cat];
      const cursor = cursors[cat];
      if (cursor >= bucket.length) continue;
      candidates.push(bucket[cursor]!);
      cursors[cat] = cursor + 1;
      remaining -= 1;
    }
  }

  return { candidates, potentialCount };
}
