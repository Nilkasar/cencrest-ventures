import { describe, expect, it } from 'vitest';
import { MockSearchConsoleProvider } from './mock-search-console-provider.js';
import { NullSEODataProvider } from './seo-data-provider.js';

describe('MockSearchConsoleProvider', () => {
  const provider = new MockSearchConsoleProvider();

  it('is named search_console — the exact seo_provider_source enum value Epic 4 reserved for it', () => {
    expect(provider.name).toBe('search_console');
  });

  it('returns confidence: high (real customer data), unlike NullSEODataProvider\'s "estimate"', async () => {
    const rows = await provider.getKeywordData(['best crm software']);
    expect(rows[0]!.confidence).toBe('high');
  });

  it('is deterministic: the same keyword always returns the same values (no network, no randomness)', async () => {
    const first = await provider.getKeywordData(['ai visibility tool']);
    const second = await provider.getKeywordData(['ai visibility tool']);
    expect(first).toEqual(second);
  });

  it('returns real, non-null rankings — the one thing NullSEODataProvider can never answer', async () => {
    const rankings = await provider.getRankings('example.com', ['ai visibility tool']);
    expect(rankings[0]!.position).not.toBeNull();
    expect(rankings[0]!.position).toBeGreaterThanOrEqual(1);
    expect(rankings[0]!.url).toBe('https://example.com/');
  });

  it('never fabricates competitor data — still returns [] like the null provider', async () => {
    expect(await provider.getCompetitorKeywords('example.com')).toEqual([]);
  });

  it('differs observably from NullSEODataProvider for the identical keyword (proves selection is meaningful)', async () => {
    const nullProvider = new NullSEODataProvider();
    const mockRows = await provider.getKeywordData(['best crm software']);
    const nullRows = await nullProvider.getKeywordData(['best crm software']);
    expect(mockRows[0]!.confidence).not.toBe(nullRows[0]!.confidence);
    const nullRankings = await nullProvider.getRankings('example.com', ['best crm software']);
    const mockRankings = await provider.getRankings('example.com', ['best crm software']);
    expect(nullRankings[0]!.position).toBeNull();
    expect(mockRankings[0]!.position).not.toBeNull();
  });
});
