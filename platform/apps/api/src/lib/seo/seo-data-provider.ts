/**
 * `SEODataProvider` — the abstraction `docs/10-seo/SEO_ENGINE.md`'s "SEO
 * PROVIDER ABSTRACTION" section defines, transcribed here verbatim (method
 * names, `KeywordData`/`RankingData` shapes) so nothing downstream needs a
 * second, slightly-different copy of this contract. Same discipline the
 * epic brief asks for: "mirrors the AIProvider abstraction pattern from
 * Epic 6 — application code never imports a specific provider directly."
 *
 * Routes call `getSEODataProvider()` (bottom of this file), never
 * `new NullSEODataProvider()` directly, so swapping in a real provider later
 * (Search Console, DataForSEO, Semrush, Ahrefs, Serper — see the epic doc's
 * "DATA SOURCES" table) is a one-function change.
 *
 * **Why a single factory function, not a full `AIProviderRegistry`-style
 * class** (`packages/ai-provider/src/registry.ts`): that registry earns its
 * complexity because Epic 6 ships FIVE real, concurrently-usable provider
 * implementations with fan-out/fallback routing rules per task. This epic
 * ships exactly ONE real implementation (`NullSEODataProvider`) — there is
 * no routing table to encode yet. A registry class with one entry would be
 * speculative abstraction; the interface below is the actual seam a future
 * epic needs (implement `SEODataProvider`, change what `getSEODataProvider`
 * constructs), and that seam does not require a registry to exist.
 */

import type { keyword_intent, seo_keyword_confidence } from '@bebest/database';

export interface KeywordData {
  keyword: string;
  intent: keyword_intent | null;
  /** null if unavailable. */
  monthlyVolume: number | null;
  /** 0-100, or null if unavailable. */
  difficulty: number | null;
  confidence: seo_keyword_confidence;
  /** Which provider returned this — `SEODataProvider.name` of whichever
   * instance produced the row. Free-form string on the wire type (matches
   * `docs/10-seo/SEO_ENGINE.md`'s literal `source: string`); the persistence
   * layer (`routes/seo.ts`) maps it onto the closed `seo_provider_source`
   * DB enum. */
  source: string;
}

export interface RankingData {
  keyword: string;
  /** null if not ranking / not measurable without a paid API or a
   * customer-connected Search Console. */
  position: number | null;
  url: string | null;
}

export interface SEODataProvider {
  readonly name: string;

  getKeywordData(keywords: string[]): Promise<KeywordData[]>;

  /** limit: default provider-specific; NullSEODataProvider always returns
   * `[]` (no competitor crawl or paid API is performed here — see its own
   * doc comment). */
  getCompetitorKeywords(domain: string, limit?: number): Promise<KeywordData[]>;

  getRankings(domain: string, keywords: string[]): Promise<RankingData[]>;
}

// ---------------------------------------------------------------------------
// Deterministic keyword-shape heuristics (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Word-count-based volume/difficulty tiering — the epic doc's own guidance
 * for the no-paid-API default ("AI-assisted keyword research... low
 * confidence, labeled as estimate"; here it's a plain deterministic
 * heuristic, not even an LLM call, since Epic 6's AI providers are a
 * separate abstraction this epic does not depend on). Shorter phrases are
 * assumed to be broader "head" terms (higher assumed volume, higher assumed
 * competition/difficulty); longer phrases are assumed "long-tail" (lower
 * volume, lower difficulty) — the standard, well-documented SEO heuristic.
 * Deterministic and pure (no randomness, no network) so a fixed keyword
 * list always produces the exact same estimate — required for
 * `seo-data-provider.test.ts`'s exact-value assertions and so the
 * opportunity-scoring pipeline downstream is itself reproducible.
 */
export function estimateVolumeTier(keyword: string): number {
  const words = keyword.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 2) return 1000;
  if (words <= 4) return 300;
  return 80;
}

export function estimateDifficultyTier(keyword: string): number {
  const words = keyword.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 2) return 70;
  if (words <= 4) return 40;
  return 15;
}

const TRANSACTIONAL_MARKERS = ['buy', 'price', 'pricing', 'purchase', 'cost', 'discount', 'deal'];
const COMMERCIAL_MARKERS = ['best', 'top', 'vs', 'versus', 'compare', 'comparison', 'alternative', 'alternatives', 'review', 'reviews'];

/**
 * Simple, deterministic lexical classification into the epic's four literal
 * intent values (`docs/10-seo/SEO_ENGINE.md`'s `KeywordData.intent`).
 * `navigational` is never inferred here — recognizing a navigational query
 * would require knowing the brand's own name/aliases, which this pure,
 * brand-agnostic function deliberately does not take as input (callers that
 * want navigational classification against a specific brand should check
 * `keyword.toLowerCase().includes(brandName.toLowerCase())` themselves
 * before calling this, per `docs/10-seo/SEO_ENGINE.md`'s definition of
 * "navigational" as brand/entity-seeking).
 */
export function classifyIntent(keyword: string): keyword_intent {
  const lower = keyword.toLowerCase();
  if (TRANSACTIONAL_MARKERS.some((marker) => lower.includes(marker))) return 'transactional';
  if (COMMERCIAL_MARKERS.some((marker) => lower.includes(marker))) return 'commercial';
  return 'informational';
}

// ---------------------------------------------------------------------------
// NullSEODataProvider — the always-available, no-paid-API default
// ---------------------------------------------------------------------------

/**
 * Ships with zero external dependencies and makes zero network calls — the
 * epic doc's explicit requirement ("BeBest does NOT assume access to paid
 * SEO APIs... Ship a NullSEODataProvider... that returns confidence:
 * 'estimate' results so the rest of the system has something real to
 * render"). Every `KeywordData`/`RankingData` row this returns carries
 * `confidence: 'estimate'` (keywords) or a null `position` (rankings) —
 * never a number dressed up as a firm measurement.
 */
export class NullSEODataProvider implements SEODataProvider {
  readonly name = 'null_provider';

  async getKeywordData(keywords: string[]): Promise<KeywordData[]> {
    return keywords.map((keyword) => ({
      keyword,
      intent: classifyIntent(keyword),
      monthlyVolume: estimateVolumeTier(keyword),
      difficulty: estimateDifficultyTier(keyword),
      confidence: 'estimate',
      source: this.name,
    }));
  }

  /** No competitor crawl or paid SERP lookup is performed by this provider
   * — that would require either a live network call (disallowed for this
   * epic's backend, and a real competitor-crawl feature belongs to a
   * dedicated future epic reusing Epic 3's crawler, not this data-provider
   * seam) or a paid API key this provider explicitly has neither. Returns
   * `[]` rather than throwing, so a caller iterating "for each configured
   * provider, get competitor keywords" degrades gracefully instead of
   * failing the whole request over the one thing the null provider can
   * never do. */
  async getCompetitorKeywords(_domain: string, _limit?: number): Promise<KeywordData[]> {
    return [];
  }

  /** No ranking data source (no customer-connected Search Console — see
   * `gsc_connections`, unused by this epic — and no paid rank tracker) —
   * every keyword comes back with a null position, never a fabricated
   * rank. */
  async getRankings(_domain: string, keywords: string[]): Promise<RankingData[]> {
    return keywords.map((keyword) => ({ keyword, position: null, url: null }));
  }
}

let cachedProvider: SEODataProvider | undefined;

/**
 * The one function route code should call — never `new NullSEODataProvider()`
 * directly (see this file's header comment on why there is no registry
 * class yet). Returns a process-lifetime singleton (the null provider is
 * stateless, so there is nothing gained by constructing a fresh one per
 * request).
 */
export function getSEODataProvider(): SEODataProvider {
  if (!cachedProvider) cachedProvider = new NullSEODataProvider();
  return cachedProvider;
}
