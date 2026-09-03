/**
 * Epic 11 (Content Intelligence & Generation) — `GET /content-briefs/:id`
 * (brief + every draft version generated under it — this epic's UI surface:
 * "the approval screen must show the draft alongside its brief's original
 * requirements") and `POST /content-briefs/:id/draft` (`docs/epics/11-
 * content-intelligence-generation.md`'s "API surface", generation pipeline
 * steps 3-4: generate via `AIProviderRegistry`, then run all 5 quality
 * checks). Mounted at `/api/content-briefs` — an id-addressed resource, not
 * a brand's, same convention `/api/crawl-jobs/:id`/`/api/ai-runs/:id`
 * already use.
 *
 * Regenerating NEVER overwrites — every call inserts the NEXT `version`
 * (this epic's explicit, DoD-tested requirement); the quality checks that
 * ran for THIS version are always inserted alongside it, never skipped
 * (this epic's other explicit DoD requirement).
 */
import { Hono } from 'hono';
import { withOrgContext, type brand_claims, type Prisma } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getDefaultAiProviderRegistry } from '../lib/ai-visibility/provider-registry.js';
import { generateDraftContent } from '../lib/content/draft-generator.js';
import { runAllQualityChecks, type ExistingPageForDuplicateCheck } from '../lib/content/quality-checks.js';
import { serializeBrief, serializeDraft, serializeQualityCheck } from '../lib/content/serialize.js';
import type { OutlineSection, BrandClaimForBrief } from '../lib/content/brief-builder.js';
import type { AppEnv } from '../types/context.js';

const contentBriefDetailsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const MUTATE = 'create_content_draft' as const;
const NOT_FOUND_ERROR = { error: 'Content brief not found' } as const;

contentBriefDetailsRoute.get('/:id', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const briefId = c.req.param('id');

  const result = await withOrgContext(org.organizationId, async (tx) => {
    const brief = await tx.content_briefs.findFirst({ where: { id: briefId, organization_id: org.organizationId, deleted_at: null } });
    if (!brief) return null;
    // Epic 19 (Production Hardening), item 6 — capped server-side (this
    // call had no cap at all before this epic); a brief that's been
    // regenerated many times (drafts are versioned, never overwritten —
    // see this epic's ADR-007 note) only ever grows.
    const drafts = await tx.content_drafts.findMany({ where: { brief_id: brief.id, organization_id: org.organizationId }, orderBy: { version: 'desc' }, take: 100 });
    return { brief, drafts };
  });
  if (!result) return c.json(NOT_FOUND_ERROR, 404);

  return c.json({ brief: serializeBrief(result.brief), drafts: result.drafts.map(serializeDraft) });
});

function claimsFromResearchNotes(researchNotes: unknown): BrandClaimForBrief[] {
  if (!researchNotes || typeof researchNotes !== 'object') return [];
  const claims = (researchNotes as { brandClaims?: unknown }).brandClaims;
  if (!Array.isArray(claims)) return [];
  return claims.filter((c): c is BrandClaimForBrief => typeof c === 'object' && c !== null && typeof (c as brand_claims).claim === 'string');
}

contentBriefDetailsRoute.post('/:id/draft', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(MUTATE), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const briefId = c.req.param('id');

  const brief = await withOrgContext(org.organizationId, (tx) => tx.content_briefs.findFirst({ where: { id: briefId, organization_id: org.organizationId, deleted_at: null } }));
  if (!brief) return c.json(NOT_FOUND_ERROR, 404);

  const brand = await withOrgContext(org.organizationId, (tx) => tx.brands.findFirst({ where: { id: brief.brand_id, organization_id: org.organizationId } }));
  const brandName = brand?.name ?? 'Your brand';
  const brandClaims = claimsFromResearchNotes(brief.research_notes);
  const targetQuery = brief.target_query ?? brief.title;

  // Duplicate-content check data — Epic 3's most recent crawl for this
  // brand, same "most recent crawl = current site state" convention
  // `routes/pages.ts` already documents.
  const existingPages: ExistingPageForDuplicateCheck[] = await withOrgContext(org.organizationId, async (tx) => {
    const latestJob = await tx.crawl_jobs.findFirst({ where: { brand_id: brief.brand_id, organization_id: org.organizationId }, orderBy: { created_at: 'desc' } });
    if (!latestJob) return [];
    const pages = await tx.pages.findMany({ where: { crawl_job_id: latestJob.id, organization_id: org.organizationId, deleted_at: null }, select: { url: true, title: true, h1: true } });
    return pages;
  });

  const generated = await generateDraftContent(
    {
      brandName,
      contentType: brief.content_type,
      title: brief.title,
      targetQuery,
      keywords: brief.keywords,
      implementationNotes: brief.implementation_notes,
      evidenceSummary: brief.evidence_summary,
      outline: brief.outline as unknown as OutlineSection[],
      brandClaims,
    },
    { registry: getDefaultAiProviderRegistry() },
  );

  const lastVersion = await withOrgContext(org.organizationId, (tx) =>
    tx.content_drafts.findFirst({ where: { brief_id: brief.id, organization_id: org.organizationId }, orderBy: { version: 'desc' } }),
  );
  const version = (lastVersion?.version ?? 0) + 1;

  // Never generated with structured-data markup in v1 (the draft is
  // markdown text, not HTML) — this is what makes the `seo_checklist`
  // check's "missing schema markup" finding real rather than vacuous; a
  // future epic that generates actual schema.org JSON-LD would populate
  // this from what it actually emitted, not hardcode it here.
  const structuredDataTypes: string[] = [];

  const draft = await withOrgContext(org.organizationId, (tx) =>
    tx.content_drafts.create({
      data: {
        organization_id: org.organizationId,
        brand_id: brief.brand_id,
        brief_id: brief.id,
        version,
        provider_name: generated.providerName,
        model_name: generated.modelName,
        prompt_version: generated.promptVersion,
        title: generated.title,
        meta_description: generated.metaDescription,
        body: generated.body,
        word_count: generated.wordCount,
        structured_data_types: structuredDataTypes,
        status: 'generated',
        request_id: generated.requestId,
        tokens_prompt: generated.tokensPrompt,
        tokens_completion: generated.tokensCompletion,
        tokens_total: generated.tokensTotal,
        latency_ms: generated.latencyMs,
        created_by: user.id,
      },
    }),
  );

  // Step 4 — EVERY quality check runs, always, for every version generated
  // (this epic's DoD: never bypassed). Each result is its own stored row,
  // never collapsed into one aggregate flag.
  const checkResults = runAllQualityChecks({
    draft: { title: draft.title ?? brief.title, metaDescription: draft.meta_description, wordCount: draft.word_count, structuredDataTypes, body: draft.body },
    brandName,
    targetQuery,
    brandClaims,
    existingPages,
  });

  const qualityChecks = await withOrgContext(org.organizationId, (tx) =>
    Promise.all(
      checkResults.map((result) =>
        tx.content_quality_checks.create({
          data: {
            organization_id: org.organizationId,
            brand_id: brief.brand_id,
            draft_id: draft.id,
            check_type: result.checkType,
            status: result.status,
            score: result.score,
            details: result.details as unknown as Prisma.InputJsonValue,
          },
        }),
      ),
    ),
  );

  return c.json({ draft: serializeDraft(draft), qualityChecks: qualityChecks.map(serializeQualityCheck) }, 201);
});

export default contentBriefDetailsRoute;
