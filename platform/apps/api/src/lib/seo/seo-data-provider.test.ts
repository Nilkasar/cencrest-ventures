import { describe, expect, it } from 'vitest';
import {
  classifyIntent,
  estimateDifficultyTier,
  estimateVolumeTier,
  getSEODataProvider,
  NullSEODataProvider,
} from './seo-data-provider.js';

describe('classifyIntent', () => {
  it('classifies transactional markers', () => {
    expect(classifyIntent('buy freight visibility software')).toBe('transactional');
    expect(classifyIntent('freight visibility software pricing')).toBe('transactional');
  });

  it('classifies commercial markers', () => {
    expect(classifyIntent('best freight visibility software')).toBe('commercial');
    expect(classifyIntent('freight visibility software vs competitor')).toBe('commercial');
  });

  it('defaults to informational', () => {
    expect(classifyIntent('what is freight visibility')).toBe('informational');
  });
});

describe('estimateVolumeTier / estimateDifficultyTier', () => {
  it('assigns the head-term tier to short phrases', () => {
    expect(estimateVolumeTier('crm')).toBe(1000);
    expect(estimateDifficultyTier('crm')).toBe(70);
  });

  it('assigns the mid tier to 3-4 word phrases', () => {
    expect(estimateVolumeTier('best crm software')).toBe(300);
    expect(estimateDifficultyTier('best crm software')).toBe(40);
  });

  it('assigns the long-tail tier to 5+ word phrases', () => {
    expect(estimateVolumeTier('best crm software for small teams')).toBe(80);
    expect(estimateDifficultyTier('best crm software for small teams')).toBe(15);
  });

  it('is deterministic for a fixed input', () => {
    expect(estimateVolumeTier('crm')).toBe(estimateVolumeTier('crm'));
  });
});

describe('NullSEODataProvider', () => {
  const provider = new NullSEODataProvider();

  it('every keyword result is labeled confidence: estimate — never a firm number', () => {
    const results = provider.getKeywordData(['crm', 'best crm software']);
    return results.then((rows) => {
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.confidence).toBe('estimate');
        expect(row.source).toBe('null_provider');
      }
    });
  });

  it('returns no competitor keywords (no crawl/paid API performed)', async () => {
    await expect(provider.getCompetitorKeywords('competitor.example')).resolves.toEqual([]);
  });

  it('returns null positions for rankings (no data source configured)', async () => {
    const rankings = await provider.getRankings('acme.example', ['crm']);
    expect(rankings).toEqual([{ keyword: 'crm', position: null, url: null }]);
  });
});

describe('getSEODataProvider', () => {
  it('returns a singleton instance', () => {
    expect(getSEODataProvider()).toBe(getSEODataProvider());
  });
});
