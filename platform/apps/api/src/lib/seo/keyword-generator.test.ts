import { describe, expect, it } from 'vitest';
import { generateCandidateKeywords, generateKeywordCandidates, MAX_GENERATED_KEYWORDS } from './keyword-generator.js';
import type { KeywordGeneratorBrandProfile } from './keyword-generator.js';

const PROFILE: KeywordGeneratorBrandProfile = {
  categories: ['freight visibility software'],
  useCases: [
    {
      title: 'logistics teams',
      industries: ['manufacturing', 'retail'],
      painPoints: ['late shipment alerts'],
      solutions: ['track shipments in real time'],
    },
  ],
};

describe('generateCandidateKeywords', () => {
  it('produces the exact deterministic list for a fixed profile', () => {
    expect(generateCandidateKeywords(PROFILE)).toEqual([
      'freight visibility software',
      'best freight visibility software',
      'freight visibility software for logistics teams',
      'freight visibility software for manufacturing',
      'freight visibility software for retail',
      'late shipment alerts',
      'track shipments in real time',
    ]);
  });

  it('deduplicates case-insensitively (second "crm" contributes nothing new)', () => {
    const profile: KeywordGeneratorBrandProfile = {
      categories: ['CRM', 'crm'],
      useCases: [],
    };
    expect(generateCandidateKeywords(profile)).toEqual(['CRM', 'best CRM']);
  });

  it('reads only what the profile provides — no hardcoded brand-specific strings', () => {
    const empty = generateCandidateKeywords({ categories: [], useCases: [] });
    expect(empty).toEqual([]);
  });

  it('is a pure function — the same input always produces the same output', () => {
    expect(generateCandidateKeywords(PROFILE)).toEqual(generateCandidateKeywords(PROFILE));
  });
});

describe('generateKeywordCandidates', () => {
  it('caps output at MAX_GENERATED_KEYWORDS', () => {
    const bigProfile: KeywordGeneratorBrandProfile = {
      categories: Array.from({ length: 50 }, (_, i) => `category ${i}`),
      useCases: [],
    };
    const result = generateKeywordCandidates(bigProfile);
    expect(result.length).toBe(MAX_GENERATED_KEYWORDS);
  });

  it('does not cap a profile under the limit', () => {
    expect(generateKeywordCandidates(PROFILE)).toHaveLength(7);
  });
});
