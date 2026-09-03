/**
 * Epic 11 (Content Intelligence & Generation) — `POST
 * /recommendations/:id/content-brief` (`docs/epics/11-content-intelligence-
 * generation.md`'s "API surface", generation pipeline steps 1-2). Mounted at
 * the SAME base path as `routes/recommendation-details.ts`
 * (`/api/recommendations`) — Hono merges routes from multiple routers
 * mounted at one base path, same precedent Epic 10's
 * `opportunity-recommendations.ts` + `opportunity-details.ts` already set at
 * `/api/opportunities`.
 *
 * Idempotent upsert on `(organization_id, recommendation_id)` — same
 * discipline every generation step in this codebase already has (Epic 9's
 * `.../recompute`, Epic 10's `.../recommendations/generate`).
 */
import { Hono } from 'hono';
import { withOrgContext, type Prisma } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  buildOutline,
  buildResearchNotes,
  contentTypeForActionType,
  isApprovedRecommendationStatus,
  isContentTypeRecommendation,
  type BrandClaimForBrief,
  type OpportunityEvidenceForBrief,
} from '../lib/content/brief-builder.js';
import { serializeBrief } from '../lib/content/serialize.js';
import type { AppEnv } from '../types/context.js';

const contentBriefGenerateRoute = new Hono<AppEnv>();

// Reuses the same permission Epic 10's own generate route uses
// (`create_brand_profile`) is NOT right here — a content brief is
// specifically a content-creation artifact, and `docs/08-security/
// SECURITY.md`'s matrix already has a purpose-built action for exactly
// this: `create_content_draft` (owner/admin/analyst/editor), which
// `lib/rbac.ts` already defines (it anticipates this epic — see that
// file's own `Action` union comment).
const MUTATE = 'create_content_draft' as const;
const NOT_FOUND_ERROR = { error: 'Recommendation not found' } as const;

contentBriefGenerateRoute.post(
  '/:id/content-brief',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  async (c) => {
    const org = c.get('org');
    const recommendationId = c.req.param('id');

    // Belt-and-suspenders scoping (`withOrgContext` RLS + explicit WHERE),
    // same pattern every id-addressed route in this codebase uses — a
    // foreign id 404s, never a 403 that would confirm it exists.
    const recommendation = await withOrgContext(org.organizationId, (tx) =>
      tx.opportunity_recommendations.findFirst({ where: { id: recommendationId, organization_id: org.organizationId } }),
    );
    if (!recommendation) return c.json(NOT_FOUND_ERROR, 404);

    if (!isApprovedRecommendationStatus(recommendation.status)) {
      return c.json(
        {
          error: 'Recommendation is not approved',
          message: 'A content brief can only be generated from a recommendation that is in_progress or completed. Approve it first via PATCH /recommendations/:id.',
          status: recommendation.status,
        },
        409,
      );
    }

    if (!isContentTypeRecommendation(recommendation.action_type)) {
      return c.json(
        {
          error: 'Recommendation is not content-type',
          message: `action_type "${recommendation.action_type}" does not produce written content (only create_page/update_page do).`,
        },
        422,
      );
    }

    // Step 2 of this epic's pipeline: research evidence and claims.
    const opportunity = await withOrgContext(org.organizationId, (tx) =>
      tx.unified_opportunities.findFirst({
        where: { id: recommendation.opportunity_id, organization_id: org.organizationId },
        include: { opportunity_evidence: { orderBy: { created_at: 'asc' } } },
      }),
    );

    const query = opportunity
      ? await withOrgContext(org.organizationId, (tx) => tx.queries.findFirst({ where: { id: opportunity.query_id, organization_id: org.organizationId } }))
      : null;

    const verifiedBrandClaims = await withOrgContext(org.organizationId, (tx) =>
      tx.brand_claims.findMany({
        where: { organization_id: org.organizationId, brand_id: recommendation.brand_id, verified: true, deleted_at: null },
        orderBy: { created_at: 'asc' },
        take: 10,
      }),
    );

    const brandClaims: BrandClaimForBrief[] = verifiedBrandClaims.map((c) => ({ id: c.id, claim: c.claim, confidence: c.confidence, verified: c.verified }));
    const opportunityEvidence: OpportunityEvidenceForBrief[] = (opportunity?.opportunity_evidence ?? []).map((e) => ({ sourceTable: e.source_table, summary: e.summary }));

    const targetQuery = opportunity?.intent_text ?? recommendation.title;
    const data = {
      organization_id: org.organizationId,
      brand_id: recommendation.brand_id,
      recommendation_id: recommendation.id,
      content_type: contentTypeForActionType(recommendation.action_type),
      title: recommendation.title,
      target_query: targetQuery,
      target_stage: null,
      target_intent: query?.intent_type ?? null,
      keywords: query ? [query.text] : [],
      outline: buildOutline({
        targetQuery,
        implementationNotes: recommendation.implementation_notes,
        evidenceSummary: recommendation.evidence_summary,
        brandClaims,
      }) as unknown as Prisma.InputJsonValue,
      evidence_summary: recommendation.evidence_summary,
      implementation_notes: recommendation.implementation_notes,
      research_notes: buildResearchNotes(brandClaims, opportunityEvidence) as unknown as Prisma.InputJsonValue,
    };

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.content_briefs.findFirst({ where: { organization_id: org.organizationId, recommendation_id: recommendation.id } }),
    );

    const row = existing
      ? await withOrgContext(org.organizationId, (tx) => tx.content_briefs.update({ where: { id: existing.id }, data: { ...data, updated_at: new Date() } }))
      : await withOrgContext(org.organizationId, (tx) => tx.content_briefs.create({ data }));

    return c.json({ created: !existing, brief: serializeBrief(row) }, existing ? 200 : 201);
  },
);

export default contentBriefGenerateRoute;
