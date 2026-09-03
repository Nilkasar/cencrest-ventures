/**
 * Epic 18 (Agency / White Label / Integrations) — `MockSearchConsoleProvider`.
 * Proves Epic 4's `SEODataProvider` abstraction accepts a real-shaped,
 * "customer-connected Search Console data (best)" implementation, per the
 * epic spec's explicit instruction: "implement... a `MockSearchConsoleProvider`
 * proving the `SEODataProvider` interface accepts a real-shaped provider,
 * with the actual OAuth handshake clearly marked as the deployment-time
 * integration point." NO real network call, ever — every value below is a
 * deterministic, pure function of its input, same "fixed input -> fixed
 * output" discipline `NullSEODataProvider`'s own heuristics follow (see
 * that file's `estimateVolumeTier`/`estimateDifficultyTier`).
 *
 * DEPLOYMENT-TIME INTEGRATION POINT: a real implementation would replace
 * the three bodies below with actual Search Console API calls
 * (`searchanalytics.query` for keyword/ranking data), authenticated via the
 * `integrations` row's `config_enc` OAuth tokens this epic's connect flow
 * creates (see `routes/integrations.ts`). Nothing else in this file or its
 * caller (`seo-data-provider.ts`'s `resolveSEODataProviderForOrg`) would
 * need to change — that is the entire point of the `SEODataProvider` seam.
 *
 * Deliberately more "confident" than `NullSEODataProvider` in exactly the
 * two ways real Search Console data actually would be: `confidence: 'high'`
 * (real customer data, not an estimate) and non-null ranking `position`s
 * (Search Console literally reports "what position did this page rank at"
 * — the one thing `NullSEODataProvider` can never answer, by its own doc
 * comment). This is what lets a test prove provider SELECTION actually
 * changed something observable, not merely that a different object was
 * constructed.
 */
import { classifyIntent, type SEODataProvider, type KeywordData, type RankingData } from './seo-data-provider.js';

/** Deterministic 0-100 hash of a string, used to derive stable "measured"
 * volume/difficulty/position values from a keyword — same "no randomness,
 * reproducible for a fixed input" requirement `seo-data-provider.test.ts`'s
 * exact-value assertions already impose on `NullSEODataProvider`. */
function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export class MockSearchConsoleProvider implements SEODataProvider {
  readonly name = 'search_console';

  async getKeywordData(keywords: string[]): Promise<KeywordData[]> {
    return keywords.map((keyword) => {
      const h = stableHash(keyword);
      return {
        keyword,
        intent: classifyIntent(keyword),
        // A real customer's actual measured monthly impressions/clicks-
        // derived volume, not a word-count heuristic — deterministically
        // derived here (100-10099) so this genuinely differs from
        // `NullSEODataProvider`'s tiered estimates for the same keyword.
        monthlyVolume: 100 + (h % 10000),
        difficulty: h % 101, // 0-100
        confidence: 'high',
        source: this.name,
      };
    });
  }

  /** Still no competitor crawl — Search Console only ever reports data for
   * domains the connected account owns/verifies, never a third party's
   * (and no real network call is permitted in this build regardless). */
  async getCompetitorKeywords(_domain: string, _limit?: number): Promise<KeywordData[]> {
    return [];
  }

  async getRankings(domain: string, keywords: string[]): Promise<RankingData[]> {
    return keywords.map((keyword) => {
      const h = stableHash(`${domain}:${keyword}`);
      return {
        keyword,
        position: 1 + (h % 100), // 1-100 — a real, non-null measured rank
        url: `https://${domain}/`,
      };
    });
  }
}
