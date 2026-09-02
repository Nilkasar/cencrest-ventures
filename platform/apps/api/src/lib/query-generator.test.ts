import { describe, expect, it } from 'vitest';
import {
  generateCandidateQueries,
  generateQueryUniverse,
  QUERY_TEMPLATE_CATEGORIES,
  type QueryGeneratorBrandProfile,
} from './query-generator.js';

// A minimal fixture with exactly one item per input dimension — this is
// deliberately small so the expected output can be asserted as an exact,
// fully-enumerated array (per the epic's Definition of Done: "given a fixed
// brand profile fixture, assert the exact expected query set").
const FIXTURE: QueryGeneratorBrandProfile = {
  name: 'Acme Freight',
  categories: ['freight visibility software'],
  differentiators: ['real-time GPS tracking'],
  markets: ['North America'],
  useCases: [
    {
      title: 'tracking refrigerated shipments',
      industries: ['cold chain logistics'],
      companySizes: ['mid-market'],
      painPoints: ['spoiled shipments from temperature excursions'],
      solutions: ['monitor shipment temperature in real time'],
    },
  ],
  competitors: [{ name: 'Rival TMS' }],
};

describe('generateCandidateQueries', () => {
  it('produces the exact expected query set for a fixed fixture brand profile', () => {
    const result = generateCandidateQueries(FIXTURE);

    expect(result).toEqual([
      {
        text: 'What is freight visibility software?',
        category: 'category',
        intentType: 'informational',
        priority: 3,
        tags: ['freight visibility software'],
      },
      {
        text: 'Who are the experts in freight visibility software?',
        category: 'authority',
        intentType: 'informational',
        priority: 3,
        tags: ['freight visibility software'],
      },
      {
        text: 'Best freight visibility software for tracking refrigerated shipments?',
        category: 'commercial',
        intentType: 'commercial',
        priority: 1,
        tags: ['freight visibility software', 'tracking refrigerated shipments'],
      },
      {
        text: 'Best freight visibility software for cold chain logistics?',
        category: 'industry',
        intentType: 'commercial',
        priority: 2,
        tags: ['freight visibility software', 'cold chain logistics'],
      },
      {
        text: 'Best freight visibility software for mid-market companies?',
        category: 'size',
        intentType: 'commercial',
        priority: 2,
        tags: ['freight visibility software', 'mid-market'],
      },
      {
        text: 'How do I solve spoiled shipments from temperature excursions?',
        category: 'problem',
        intentType: 'informational',
        priority: 3,
        tags: ['freight visibility software', 'spoiled shipments from temperature excursions'],
      },
      {
        text: 'How to monitor shipment temperature in real time?',
        category: 'intent',
        intentType: 'transactional',
        priority: 2,
        tags: ['freight visibility software', 'monitor shipment temperature in real time'],
      },
      {
        text: 'Which freight visibility software has real-time GPS tracking?',
        category: 'feature',
        intentType: 'commercial',
        priority: 2,
        tags: ['freight visibility software', 'real-time GPS tracking'],
      },
      {
        text: 'Best freight visibility software in North America?',
        category: 'geography',
        intentType: 'commercial',
        priority: 3,
        tags: ['freight visibility software', 'North America'],
      },
      {
        text: 'Acme Freight vs Rival TMS',
        category: 'comparison',
        intentType: 'comparison',
        priority: 1,
        tags: ['Rival TMS'],
      },
    ]);
  });

  it('spans all ten documented template categories, not just one or two applied repeatedly', () => {
    const result = generateCandidateQueries(FIXTURE);
    const categoriesUsed = new Set(result.map((q) => q.category));
    expect(categoriesUsed.size).toBe(QUERY_TEMPLATE_CATEGORIES.length);
    for (const category of QUERY_TEMPLATE_CATEGORIES) {
      expect(categoriesUsed.has(category)).toBe(true);
    }
  });

  it('is deterministic — calling it twice on the same input gives identical output', () => {
    expect(generateCandidateQueries(FIXTURE)).toEqual(generateCandidateQueries(FIXTURE));
  });

  it('deduplicates identical (category, text) pairs — e.g. the same industry on two use cases', () => {
    const brand: QueryGeneratorBrandProfile = {
      ...FIXTURE,
      useCases: [
        FIXTURE.useCases[0]!,
        { ...FIXTURE.useCases[0]!, title: 'a second use case with the same industry' },
      ],
    };
    const result = generateCandidateQueries(brand);
    const industryQueries = result.filter((q) => q.category === 'industry');
    // Both use cases list 'cold chain logistics' — only one Industry query
    // for it should survive, even though two Commercial queries (one per
    // distinct use-case title) are expected.
    expect(industryQueries).toHaveLength(1);
    const commercialQueries = result.filter((q) => q.category === 'commercial');
    expect(commercialQueries).toHaveLength(2);
  });

  it('produces nothing for a brand profile with no categories', () => {
    const brand: QueryGeneratorBrandProfile = { ...FIXTURE, categories: [] };
    // Category/Problem/Commercial/Feature/Industry/Size/Geography/Intent/
    // Authority are all nested under a category loop; only Comparison
    // (brand vs competitor) has no category dependency.
    const result = generateCandidateQueries(brand);
    expect(result).toEqual([
      {
        text: 'Acme Freight vs Rival TMS',
        category: 'comparison',
        intentType: 'comparison',
        priority: 1,
        tags: ['Rival TMS'],
      },
    ]);
  });

  it('produces an empty list for a brand profile with no profile data at all', () => {
    const empty: QueryGeneratorBrandProfile = {
      name: 'Empty Co',
      categories: [],
      differentiators: [],
      markets: [],
      useCases: [],
      competitors: [],
    };
    expect(generateCandidateQueries(empty)).toEqual([]);
  });
});

describe('generateQueryUniverse — entitlement cap', () => {
  // A richer fixture whose candidate count comfortably exceeds small caps,
  // to prove capping truncates rather than silently generating past the
  // limit and hiding the excess.
  const RICH: QueryGeneratorBrandProfile = {
    name: 'Acme Freight',
    categories: ['freight visibility software', 'supply chain analytics'],
    differentiators: ['real-time GPS tracking', 'predictive ETA'],
    markets: ['North America', 'Europe'],
    useCases: [
      {
        title: 'tracking refrigerated shipments',
        industries: ['cold chain logistics', 'grocery retail'],
        companySizes: ['mid-market', 'enterprise'],
        painPoints: ['spoiled shipments', 'late deliveries'],
        solutions: ['monitor temperature in real time', 'predict delays before they happen'],
      },
      {
        title: 'reducing detention fees',
        industries: ['trucking'],
        companySizes: ['small business'],
        painPoints: ['unexpected detention charges'],
        solutions: ['automate dock scheduling'],
      },
    ],
    competitors: [{ name: 'Rival TMS' }, { name: 'FreightWorks' }],
  };

  it('the fixture generates more candidates than a small cap, proving the cap is load-bearing', () => {
    expect(generateCandidateQueries(RICH).length).toBeGreaterThan(10);
  });

  it('caps the returned query count at the given limit', () => {
    const uncapped = generateCandidateQueries(RICH);
    const capped = generateQueryUniverse(RICH, 10);
    expect(capped).toHaveLength(10);
    expect(capped).toEqual(uncapped.slice(0, 10));
  });

  it('returns every candidate, uncapped, when limit is null (unlimited plan)', () => {
    const uncapped = generateCandidateQueries(RICH);
    expect(generateQueryUniverse(RICH, null)).toEqual(uncapped);
  });

  it('returns an empty list for a cap of 0', () => {
    expect(generateQueryUniverse(RICH, 0)).toEqual([]);
  });
});
