import { describe, expect, it } from 'vitest';
import {
  buildOutline,
  buildResearchNotes,
  contentTypeForActionType,
  isApprovedRecommendationStatus,
  isContentTypeRecommendation,
} from './brief-builder.js';

describe('isContentTypeRecommendation', () => {
  it.each([
    ['create_page', true],
    ['update_page', true],
    ['fix_technical', false],
    ['build_citations', false],
  ] as const)('%s -> %s', (actionType, expected) => {
    expect(isContentTypeRecommendation(actionType)).toBe(expected);
  });
});

describe('contentTypeForActionType', () => {
  it('maps create_page -> landing_page and update_page -> page_update', () => {
    expect(contentTypeForActionType('create_page')).toBe('landing_page');
    expect(contentTypeForActionType('update_page')).toBe('page_update');
  });
});

describe('isApprovedRecommendationStatus', () => {
  it.each([
    ['new', false],
    ['in_progress', true],
    ['completed', true],
    ['dismissed', false],
  ])('%s -> %s', (status, expected) => {
    expect(isApprovedRecommendationStatus(status)).toBe(expected);
  });
});

describe('buildResearchNotes', () => {
  it('carries both brand claims and opportunity evidence forward untouched, not discarded', () => {
    const claims = [{ id: 'c1', claim: 'We ship in 24 hours', confidence: 'high', verified: true }];
    const evidence = [{ sourceTable: 'seo_keywords', summary: '500 monthly searches' }];
    expect(buildResearchNotes(claims, evidence)).toEqual({ brandClaims: claims, opportunityEvidence: evidence });
  });
});

describe('buildOutline', () => {
  it('splits implementation_notes into separate SEO/GEO outline sections while keeping the target query and evidence visible', () => {
    const outline = buildOutline({
      targetQuery: 'best freight visibility software',
      implementationNotes: 'SEO requirements: title tag stuff.\n\nGEO requirements: FAQ format stuff.',
      evidenceSummary: 'CompetitorA appears in 84% of responses.',
      brandClaims: [{ id: 'c1', claim: 'We are SOC2 certified', confidence: 'high', verified: true }],
    });

    const sectionNames = outline.map((s) => s.section);
    expect(sectionNames).toContain('SEO requirements');
    expect(sectionNames).toContain('GEO requirements');
    expect(sectionNames).toContain('Evidence');
    expect(sectionNames).toContain('Brand claims to reference');

    const seoSection = outline.find((s) => s.section === 'SEO requirements')!;
    const geoSection = outline.find((s) => s.section === 'GEO requirements')!;
    expect(seoSection.notes).toContain('title tag stuff');
    expect(seoSection.notes).not.toContain('FAQ format stuff');
    expect(geoSection.notes).toContain('FAQ format stuff');

    const introSection = outline.find((s) => s.section === 'Introduction')!;
    expect(introSection.notes).toContain('best freight visibility software');

    const evidenceSection = outline.find((s) => s.section === 'Evidence')!;
    expect(evidenceSection.notes).toBe('CompetitorA appears in 84% of responses.');
  });

  it('omits the brand-claims section entirely when there are none (never a fake empty section)', () => {
    const outline = buildOutline({
      targetQuery: 'q',
      implementationNotes: 'SEO requirements: a.\n\nGEO requirements: b.',
      evidenceSummary: 'e',
      brandClaims: [],
    });
    expect(outline.map((s) => s.section)).not.toContain('Brand claims to reference');
  });
});
