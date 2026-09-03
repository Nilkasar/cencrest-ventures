/**
 * Epic 11 (Content Intelligence & Generation) — pure helpers for
 * `POST /recommendations/:id/content-brief` (`routes/content-briefs.ts`).
 * No DB/network/clock access here — same discipline as
 * `lib/recommendations/generator.ts` and `lib/opportunities/merge-scoring.ts`.
 */
import type { recommendation_action_type } from '@bebest/database';

/**
 * Epic 10's `opportunity_recommendations.action_type` has no literal
 * "content" value (`create_page|update_page|fix_technical|build_citations`
 * — checked directly against schema.prisma before writing this, per the
 * recurring "do not guess" rule). This epic's spec talks about "an
 * approved, content-type Recommendation" — the two action types that
 * actually produce a piece of written content (a brand-new page, or a
 * rewrite of an existing one) as opposed to a pure technical fix or a
 * citation-building push, neither of which this epic's Content Agent has
 * anything to write. `fix_technical`/`build_citations` are NOT content-type
 * — `routes/content-briefs.ts` rejects a brief request against those with
 * 422, rather than silently generating an empty/meaningless brief.
 */
const CONTENT_TYPE_ACTION_TYPES: ReadonlySet<recommendation_action_type> = new Set(['create_page', 'update_page']);

export function isContentTypeRecommendation(actionType: recommendation_action_type): boolean {
  return CONTENT_TYPE_ACTION_TYPES.has(actionType);
}

/** `content_briefs.content_type` — a short, stable string a frontend can
 * switch on, derived 1:1 from the recommendation's own `action_type` rather
 * than inventing a second, parallel vocabulary for the same distinction. */
export function contentTypeForActionType(actionType: recommendation_action_type): string {
  return actionType === 'create_page' ? 'landing_page' : 'page_update';
}

/**
 * Epic 10's `opportunity_recommendations.status` reuses `opportunity_status`
 * (`new|in_progress|completed|dismissed`) — there is no literal `'approved'`
 * value in that vocabulary (checked directly against schema.prisma). This
 * epic's spec's "an APPROVED... Recommendation" is therefore realized as:
 * a human has moved the recommendation OUT of the default `'new'` queue by
 * acting on it (`PATCH /recommendations/:id`) and it has not been
 * `'dismissed'` — `in_progress` (actively being worked, which starts with
 * brief generation) or `'completed'` (the action already finished, a brief
 * can still be regenerated for record-keeping) both count; `'new'` (never
 * looked at) and `'dismissed'` (explicitly rejected) do not. Documented
 * here, not silently assumed, since this is a real disambiguation decision
 * this epic had to make, same as `action_type`'s "content-type" mapping
 * above.
 */
export function isApprovedRecommendationStatus(status: string): boolean {
  return status === 'in_progress' || status === 'completed';
}

export interface BrandClaimForBrief {
  id: string;
  claim: string;
  confidence: string;
  verified: boolean;
}

export interface OpportunityEvidenceForBrief {
  sourceTable: string;
  summary: string;
}

/** Step 2 of this epic's generation pipeline ("Research evidence and
 * claims — pull from brand_claims [Epic 2], opportunity_evidence [Epic
 * 9]"), stored as `content_briefs.research_notes` rather than discarded
 * once the outline below is built — a reviewer (or the draft-generation
 * prompt) can see exactly what was gathered. */
export function buildResearchNotes(
  brandClaims: BrandClaimForBrief[],
  opportunityEvidence: OpportunityEvidenceForBrief[],
): { brandClaims: BrandClaimForBrief[]; opportunityEvidence: OpportunityEvidenceForBrief[] } {
  return { brandClaims, opportunityEvidence };
}

export interface OutlineSection {
  section: string;
  notes: string;
}

/**
 * Splits `implementation_notes`'s literal `"SEO requirements: ...\n\nGEO
 * requirements: ..."` format (produced by
 * `lib/recommendations/generator.ts`'s `implementationNotesForRecommendation`)
 * back into its two halves, so the outline can present them as separate
 * sections a reviewer/the draft prompt can act on individually, while the
 * brief's own `implementation_notes` column keeps the original combined
 * string intact (this epic's explicit "carries forward... not a
 * stripped-down summary" requirement — the OUTLINE is a derived view, not
 * a replacement for the verbatim field).
 */
function splitSeoGeoNotes(implementationNotes: string): { seo: string; geo: string } {
  const geoIndex = implementationNotes.indexOf('GEO requirements:');
  if (geoIndex === -1) return { seo: implementationNotes, geo: '' };
  return {
    seo: implementationNotes.slice(0, geoIndex).trim(),
    geo: implementationNotes.slice(geoIndex).trim(),
  };
}

export interface BuildOutlineInput {
  targetQuery: string;
  implementationNotes: string;
  evidenceSummary: string;
  brandClaims: BrandClaimForBrief[];
}

export function buildOutline(input: BuildOutlineInput): OutlineSection[] {
  const { seo, geo } = splitSeoGeoNotes(input.implementationNotes);
  const sections: OutlineSection[] = [
    { section: 'Introduction', notes: `Directly address the target query/intent: "${input.targetQuery}".` },
    { section: 'SEO requirements', notes: seo },
    { section: 'GEO requirements', notes: geo },
    { section: 'Evidence', notes: input.evidenceSummary },
  ];
  if (input.brandClaims.length > 0) {
    sections.push({
      section: 'Brand claims to reference',
      notes: input.brandClaims.map((c) => c.claim).join(' | '),
    });
  }
  return sections;
}
