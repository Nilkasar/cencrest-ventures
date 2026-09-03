import { describe, expect, it } from 'vitest';
import {
  runAllQualityChecks,
  runBrandVoiceCheck,
  runDuplicateContentCheck,
  runFactCheck,
  runGeoStructureCheck,
  runSeoChecklistCheck,
} from './quality-checks.js';

describe('runFactCheck', () => {
  it('passes when the draft makes no risky/ungrounded superlative claims', () => {
    const result = runFactCheck('Acme helps you track freight in real time.', []);
    expect(result.checkType).toBe('fact_check');
    expect(result.status).toBe('pass');
  });

  it('fails when a risky claim ("the best", "guaranteed", "100%") has no matching verified brand_claims backing it', () => {
    const result = runFactCheck('Acme is guaranteed to be the best solution, 100% of the time.', []);
    expect(result.status).toBe('fail');
    expect((result.details.riskyPhrasesFound as string[]).length).toBeGreaterThan(0);
  });

  it('passes a risky claim that IS grounded by a verified brand_claims row', () => {
    const result = runFactCheck('Acme is guaranteed to deliver on time.', [{ claim: 'We are guaranteed to deliver on time, verified by our SLA.', verified: true }]);
    expect(result.status).toBe('pass');
    expect((result.details.groundedPhrases as string[])).toContain('guaranteed');
  });

  it('does not count an unverified claim as grounding', () => {
    const result = runFactCheck('Acme is guaranteed to work.', [{ claim: 'guaranteed to work', verified: false }]);
    expect(result.status).toBe('fail');
  });
});

describe('runBrandVoiceCheck', () => {
  it('passes when the brand is named and no AI-disclaimer phrase leaked into the copy', () => {
    const result = runBrandVoiceCheck('Acme makes freight tracking simple.', 'Acme');
    expect(result.status).toBe('pass');
  });

  it('fails when the brand is never mentioned', () => {
    const result = runBrandVoiceCheck('This product makes freight tracking simple.', 'Acme');
    expect(result.status).toBe('fail');
    expect(result.details.brandNameMentioned).toBe(false);
  });

  it('fails when an AI-assistant disclaimer phrase leaks into the draft', () => {
    const result = runBrandVoiceCheck('As an AI language model, Acme cannot guarantee results.', 'Acme');
    expect(result.status).toBe('fail');
    expect((result.details.aiDisclaimerPhrasesFound as string[]).length).toBeGreaterThan(0);
  });
});

describe('runDuplicateContentCheck', () => {
  it('passes when no existing page shares the title', () => {
    const result = runDuplicateContentCheck('Best Freight Visibility Software', [{ url: 'https://acme.com/pricing', title: 'Pricing', h1: 'Pricing' }]);
    expect(result.status).toBe('pass');
  });

  it('fails on an exact (case-insensitive) title match against an existing crawled page', () => {
    const result = runDuplicateContentCheck('Best Freight Visibility Software', [{ url: 'https://acme.com/dup', title: 'best freight visibility software', h1: null }]);
    expect(result.status).toBe('fail');
    expect(result.details.exactTitleMatch).toBe(true);
    expect(result.details.mostSimilarUrl).toBe('https://acme.com/dup');
  });

  it('warns on a near-duplicate (high word overlap, not exact) title', () => {
    const result = runDuplicateContentCheck('Best Freight Visibility Software For Teams', [
      { url: 'https://acme.com/near', title: 'Best Freight Visibility Software For You', h1: null },
    ]);
    expect(result.status).toBe('warning');
  });

  it('passes with an empty page set (nothing crawled yet)', () => {
    const result = runDuplicateContentCheck('Anything', []);
    expect(result.status).toBe('pass');
    expect(result.details.pagesChecked).toBe(0);
  });
});

describe('runSeoChecklistCheck', () => {
  it('reuses Epic 4\'s runContentChecklist for word count / schema markup scoring', () => {
    const result = runSeoChecklistCheck({
      title: 'A'.repeat(55), // within 50-60
      metaDescription: 'B'.repeat(150), // within 140-160
      wordCount: 500,
      structuredDataTypes: ['FAQPage'],
    });
    expect(result.checkType).toBe('seo_checklist');
    expect(result.status).toBe('pass');
    expect(result.details.contentChecklist).toBeDefined();
  });

  it('fails/warns on thin content, no schema markup, and bad title/meta lengths', () => {
    const result = runSeoChecklistCheck({ title: 'Too short', metaDescription: null, wordCount: 50, structuredDataTypes: [] });
    expect(result.status).not.toBe('pass');
    expect(result.details.titleLengthOk).toBe(false);
    expect(result.details.metaDescriptionOk).toBe(false);
  });
});

describe('runGeoStructureCheck', () => {
  it('passes when the draft has a numbered list, an FAQ-shaped section, and a named citable statistic', () => {
    const body = [
      'Acme helps freight teams track shipments for best freight visibility software.',
      '1. Real-time tracking',
      '2. Automated alerts',
      'FAQ',
      'What is freight visibility? It is knowing where your freight is at all times.',
      'According to a 2025 industry report, 68% of shippers lack real-time visibility.',
    ].join('\n');
    const result = runGeoStructureCheck(body, 'Acme', 'best freight visibility software');
    expect(result.status).toBe('pass');
  });

  it('fails when the draft has none of the GEO structuring signals', () => {
    const result = runGeoStructureCheck('This is a plain paragraph with no structure at all.', 'Acme', 'best freight visibility software');
    expect(result.status).toBe('fail');
  });
});

describe('runAllQualityChecks', () => {
  it('always runs exactly the 5 documented checks, in order, never bypassed', () => {
    const results = runAllQualityChecks({
      draft: { title: 'A Good Title Length Here For Testing Purposes Today', metaDescription: 'x'.repeat(150), wordCount: 400, structuredDataTypes: [], body: 'Some body text with 1. a list and a FAQ section, according to a 2025 study, 50% of buyers agree. Acme handles best freight visibility software well.' },
      brandName: 'Acme',
      targetQuery: 'best freight visibility software',
      brandClaims: [],
      existingPages: [],
    });

    expect(results.map((r) => r.checkType)).toEqual(['fact_check', 'brand_voice', 'duplicate_content', 'seo_checklist', 'geo_structure']);
    for (const result of results) {
      expect(['pass', 'fail', 'warning']).toContain(result.status);
      expect(result.details).toBeTruthy();
    }
  });
});
