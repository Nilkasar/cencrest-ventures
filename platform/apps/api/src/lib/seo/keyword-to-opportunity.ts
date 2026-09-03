/**
 * Turns one generated `seo_keywords` row into the four raw inputs formula
 * v1.0 (`opportunity-scoring.ts`) needs, plus a rough `opportunity_type`
 * classification. This is the piece that ties the epic's two otherwise-
 * separate actions together: "generate from brand profile" (produces
 * keywords) and `seo_opportunities` (list/get/dismiss, no separate create
 * endpoint in the spec's literal API surface) — `routes/seo.ts`'s generate
 * handler calls this for every newly-created keyword so opportunities exist
 * for the list endpoint to return, each traceable back to the exact keyword
 * evidence behind it (the epic's evidence-traceability requirement).
 *
 * Every mapping below is a documented v1 design decision, not a value taken
 * from any source doc (only the scoring FORMULA itself is given verbatim) —
 * same "explain the choice, don't hide it" treatment
 * `query-generator.ts`'s `CATEGORY_META` gets for the same kind of
 * undocumented-in-the-spec judgment call.
 */

import type { keyword_intent } from '@bebest/database';
import type { OpportunityScoringInput } from './opportunity-scoring.js';

export interface OpportunityKeywordInput {
  text: string;
  monthlyVolume: number | null;
  difficulty: number | null;
  intent: keyword_intent | null;
}

/** No existing-content signal exists yet for a keyword that was JUST
 * generated (no page-to-keyword mapping is built by this epic — see
 * `docs/epics/04-seo-intelligence-backend.md`'s "what's not done"), so
 * `currentCoverage` is always 0 for a freshly generated candidate: the
 * brand serves none of its intent yet, as far as this system can tell. A
 * future epic that maps ranking pages to keywords (via `gsc_connections` or
 * a real `SEODataProvider`) would compute a real, non-zero coverage instead
 * of this placeholder. */
const DEFAULT_COVERAGE_FOR_NEW_KEYWORD = 0;

/** No difficulty means no provider signal at all — 50 (the midpoint) is a
 * neutral placeholder, not a real estimate; deliberately not 0 (which would
 * make the opportunity look effort-free) or 100 (which would make it look
 * maximally hard). Exported (Epic 9's Opportunity Engine merge reuses this
 * exact constant for its own no-difficulty-signal case, rather than
 * inventing a second placeholder with the same value under a different
 * name — see `lib/opportunities/merge-scoring.ts`). */
export const DEFAULT_TECHNICAL_DIFFICULTY = 50;

/**
 * `demand_score` (0-100) from a raw `monthlyVolume` estimate. `NullSEODataProvider`'s
 * tiers top out at 1000 (see `seo-data-provider.ts`'s `estimateVolumeTier`),
 * so dividing by 10 and clamping at 100 maps its three tiers onto
 * 100/30/8 — a monotonic, deterministic normalization that also degrades
 * sanely for a real provider's actual search-volume numbers (which run into
 * the tens of thousands for head terms) by clamping at the documented 0-100
 * ceiling instead of overflowing it.
 */
export function normalizeDemandScore(monthlyVolume: number | null): number {
  if (monthlyVolume === null) return 20; // no volume signal — low-but-nonzero default, not 0 or 100
  return Math.min(100, Math.round(monthlyVolume / 10));
}

/** Transactional/commercial intent implies a page that has to do real
 * selling work (service/comparison copy, proof points, CTAs) — modeled as
 * higher content complexity than a purely informational explainer. */
export function contentComplexityForIntent(intent: keyword_intent | null): number {
  return intent === 'transactional' || intent === 'commercial' ? 60 : 30;
}

const COMPARISON_MARKERS = [' vs ', ' vs. ', 'versus', 'compare', 'comparison'];

/** `service_page | comparison_page | use_case_page | faq_page | ...` — see
 * schema.prisma's comment on `seo_opportunities.opportunity_type` for why
 * this stays an open string rather than a closed enum. */
export function classifyOpportunityType(text: string, intent: keyword_intent | null): string {
  const lower = text.toLowerCase();
  if (COMPARISON_MARKERS.some((marker) => lower.includes(marker))) return 'comparison_page';
  if (intent === 'transactional' || intent === 'commercial') return 'service_page';
  if (lower.startsWith('what') || lower.startsWith('how') || lower.endsWith('?')) return 'faq_page';
  return 'use_case_page';
}

export function buildOpportunityScoringInput(keyword: OpportunityKeywordInput): OpportunityScoringInput {
  return {
    demandScore: normalizeDemandScore(keyword.monthlyVolume),
    currentCoverage: DEFAULT_COVERAGE_FOR_NEW_KEYWORD,
    contentComplexity: contentComplexityForIntent(keyword.intent),
    technicalDifficulty: keyword.difficulty ?? DEFAULT_TECHNICAL_DIFFICULTY,
  };
}
