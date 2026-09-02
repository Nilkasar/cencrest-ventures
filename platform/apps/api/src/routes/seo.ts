import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext, type Prisma } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog, writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { runContentChecklist, runTechnicalChecklist } from '../lib/seo/technical-checklist.js';
import { generateKeywordCandidates } from '../lib/seo/keyword-generator.js';
import { getSEODataProvider } from '../lib/seo/seo-data-provider.js';
import { buildOpportunityScoringInput, classifyOpportunityType } from '../lib/seo/keyword-to-opportunity.js';
import { computeOpportunityScore } from '../lib/seo/opportunity-scoring.js';
import type { AppEnv } from '../types/context.js';
import type {
  keyword_groups,
  seo_analyses,
  seo_keywords,
  seo_opportunities,
  seo_provider_source,
} from '@bebest/database';

const seoRoute = new Hono<AppEnv>();

// Same reuse rule Epic 5's routes/query-sets.ts established (see that
// file's comment): this epic's spec does not define a new RBAC action, and
// SEO analysis/keyword-group data is exactly the same kind of
// owner/admin/analyst-curated brand intelligence every other Epic 2+
// resource already uses these two actions for.
const VIEW = 'view_intelligence' as const;
const MUTATE = 'create_brand_profile' as const;

// ── Serializers ──────────────────────────────────────────────────────────

function serializeKeywordGroup(row: keyword_groups & { _count?: { seo_keywords: number } }) {
  return {
    id: row.id,
    name: row.name,
    keywordCount: row._count?.seo_keywords ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeKeyword(row: seo_keywords) {
  return {
    id: row.id,
    keywordGroupId: row.keyword_group_id,
    text: row.text,
    intent: row.intent,
    monthlyVolume: row.monthly_volume,
    difficulty: row.difficulty,
    confidence: row.confidence,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeAnalysis(row: seo_analyses) {
  return {
    id: row.id,
    pageId: row.page_id,
    analysisType: row.analysis_type,
    score: row.score,
    findings: row.findings,
    analyzedAt: row.analyzed_at,
  };
}

function serializeOpportunity(row: seo_opportunities) {
  return {
    id: row.id,
    keywordId: row.keyword_id,
    title: row.title,
    opportunityType: row.opportunity_type,
    valueScore: Number(row.value_score),
    effortScore: Number(row.effort_score),
    opportunityScore: Number(row.opportunity_score),
    scoringFormulaVersion: row.scoring_formula_version,
    status: row.status,
    // The demand/coverage/complexity/difficulty numbers behind the score —
    // the UI surface's "each opportunity shows its evidence" requirement.
    evidence: row.evidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const NO_KEYWORD_GROUP_ERROR = { error: 'Keyword group not found' } as const;
const NO_KEYWORD_ERROR = { error: 'Keyword not found' } as const;
const NO_OPPORTUNITY_ERROR = { error: 'Opportunity not found' } as const;

async function getKeywordGroup(organizationId: string, brandId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.keyword_groups.findFirst({
      where: { id, organization_id: organizationId, brand_id: brandId, deleted_at: null },
    }),
  );
}

const KNOWN_PROVIDER_SOURCES: readonly seo_provider_source[] = [
  'null_provider',
  'search_console',
  'dataforseo',
  'semrush',
  'ahrefs',
  'serper',
  'manual',
];

/** Defends against a future `SEODataProvider` implementation returning a
 * `source` string this schema's closed enum doesn't know about yet —
 * falls back to `null_provider` (never throws, never silently drops the
 * row) rather than letting an unrecognized string reach Prisma and 500. */
function mapProviderSource(source: string): seo_provider_source {
  return (KNOWN_PROVIDER_SOURCES as readonly string[]).includes(source)
    ? (source as seo_provider_source)
    : 'null_provider';
}

/** Strips scheme + trailing slash so the crawl job's `root_url` (captured
 * at trigger time) can be compared against a crawled `pages.url` (captured
 * per-page) even when one has a scheme the other doesn't after a
 * redirect — see `technical-checklist.ts`'s header comment on why the
 * homepage-only Organization-schema check needs this. */
function normalizeUrlForComparison(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

// ── POST /analyze — technical + content checklist against the brand's most
// recent (or explicitly given) crawl ───────────────────────────────────────
// docs/epics/04-seo-intelligence.md's literal route is `POST
// /brands/:id/seo/analyze`; adapted to `/brands/me/seo/analyze` per this
// codebase's established single-brand-per-org convention (see app.ts).
const analyzeSchema = z.object({ crawlJobId: z.string().uuid().optional() });

seoRoute.post('/analyze', requireAuth, requireOrgFromToken('viewer'), requirePermission(MUTATE), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = analyzeSchema.safeParse(body ?? {});
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const result = await withOrgContext(org.organizationId, async (tx) => {
    let job;
    if (parsed.data.crawlJobId) {
      job = await tx.crawl_jobs.findFirst({
        where: { id: parsed.data.crawlJobId, brand_id: brand.id, organization_id: org.organizationId },
      });
      if (!job) return { kind: 'not_found' as const };
    } else {
      job = await tx.crawl_jobs.findFirst({
        where: { brand_id: brand.id, organization_id: org.organizationId },
        orderBy: { created_at: 'desc' },
      });
      if (!job) return { kind: 'no_crawl' as const };
    }

    const pagesRows = await tx.pages.findMany({
      where: { organization_id: org.organizationId, brand_id: brand.id, crawl_job_id: job.id, deleted_at: null },
      include: { page_issues: true },
    });

    if (pagesRows.length === 0) {
      return { kind: 'no_pages' as const };
    }

    const rootUrlNormalized = normalizeUrlForComparison(job.root_url);
    const technicalAnalyses = [];
    let issuesCreated = 0;

    // Sequential, not Promise.all — every iteration writes through the SAME
    // transaction client (`tx`); Prisma's TransactionClient does not
    // support concurrent queries on one transaction, same constraint
    // routes/query-sets.ts's comment on nested transactions already notes.
    for (const page of pagesRows) {
      const isHomepage = normalizeUrlForComparison(page.url) === rootUrlNormalized;
      const { score, findings, newIssues } = runTechnicalChecklist(page, isHomepage);

      if (newIssues.length > 0) {
        await tx.page_issues.createMany({
          data: newIssues.map((issue) => ({
            organization_id: org.organizationId,
            brand_id: brand.id,
            page_id: page.id,
            ...issue,
          })),
        });
        issuesCreated += newIssues.length;
      }

      const analysis = await tx.seo_analyses.create({
        data: {
          organization_id: org.organizationId,
          brand_id: brand.id,
          page_id: page.id,
          analysis_type: 'technical',
          score,
          findings: findings as unknown as Prisma.InputJsonValue,
        },
      });
      technicalAnalyses.push(analysis);
    }

    const content = runContentChecklist(pagesRows);
    const contentAnalysis = await tx.seo_analyses.create({
      data: {
        organization_id: org.organizationId,
        brand_id: brand.id,
        page_id: null,
        analysis_type: 'content',
        score: content.score,
        findings: content.findings as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      kind: 'ok' as const,
      crawlJobId: job.id,
      pagesAnalyzed: pagesRows.length,
      issuesCreated,
      technicalAnalyses,
      contentAnalysis,
    };
  });

  if (result.kind === 'not_found') return c.json({ error: 'Crawl job not found for this brand' }, 404);
  if (result.kind === 'no_crawl') {
    return c.json(
      { error: 'no_crawl_data', message: 'This brand has no crawl yet. Run POST /brands/me/crawl first.' },
      422,
    );
  }
  if (result.kind === 'no_pages') {
    return c.json(
      { error: 'no_pages_crawled', message: 'The selected crawl job has no crawled pages to analyze yet.' },
      422,
    );
  }

  await writeManualAuditEvent(c, {
    action: 'seo_analysis.run',
    entityType: 'seo_analysis',
    entityId: result.contentAnalysis.id,
  });

  return c.json(
    {
      crawlJobId: result.crawlJobId,
      pagesAnalyzed: result.pagesAnalyzed,
      issuesCreated: result.issuesCreated,
      technicalAnalyses: result.technicalAnalyses.map(serializeAnalysis),
      contentAnalysis: serializeAnalysis(result.contentAnalysis),
    },
    200,
  );
});

// ── keyword_groups CRUD ──────────────────────────────────────────────────

seoRoute.get('/keyword-groups', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.keyword_groups.findMany({
      where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null },
      include: { _count: { select: { seo_keywords: { where: { deleted_at: null } } } } },
      orderBy: { created_at: 'desc' },
    }),
  );

  return c.json(rows.map(serializeKeywordGroup));
});

const groupCreateSchema = z.object({ name: z.string().trim().min(1).max(255) });

seoRoute.post('/keyword-groups', requireAuth, requireOrgFromToken('viewer'), requirePermission(MUTATE), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = groupCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

  const org = c.get('org');
  const user = c.get('user');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const created = await withOrgContext(org.organizationId, (tx) =>
    tx.keyword_groups.create({
      data: {
        organization_id: org.organizationId,
        brand_id: brand.id,
        name: parsed.data.name,
        created_by: user.id,
      },
    }),
  );

  await writeManualAuditEvent(c, { action: 'keyword_group.created', entityType: 'keyword_group', entityId: created.id });

  return c.json(serializeKeywordGroup(created), 201);
});

seoRoute.patch(
  '/keyword-groups/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'keyword_group.updated', entityType: 'keyword_group' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = groupCreateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const existing = await getKeywordGroup(org.organizationId, brand.id, c.req.param('id'));
    if (!existing) return c.json(NO_KEYWORD_GROUP_ERROR, 404);

    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.keyword_groups.update({
        where: { id: existing.id },
        data: { name: parsed.data.name, updated_by: user.id, updated_at: new Date() },
      }),
    );

    return c.json(serializeKeywordGroup(updated));
  },
);

seoRoute.delete(
  '/keyword-groups/:id',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'keyword_group.deleted', entityType: 'keyword_group' }),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const existing = await getKeywordGroup(org.organizationId, brand.id, c.req.param('id'));
    if (!existing) return c.json(NO_KEYWORD_GROUP_ERROR, 404);

    await withOrgContext(org.organizationId, (tx) =>
      tx.keyword_groups.update({ where: { id: existing.id }, data: { deleted_at: new Date() } }),
    );

    return c.json({ success: true });
  },
);

// ── POST /keyword-groups/generate — seeds a group from Epic 2's brand
// profile (categories + use_cases) via the SEODataProvider, and scores an
// seo_opportunities row for every resulting keyword (see
// lib/seo/keyword-to-opportunity.ts's header comment for why opportunity
// creation happens here rather than a separate endpoint the spec's literal
// API surface never defines one for). ─────────────────────────────────────
const generateGroupSchema = z.object({ name: z.string().trim().min(1).max(255).optional() });

seoRoute.post(
  '/keyword-groups/generate',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateGroupSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    // Reads Epic 2's real use_cases/categories — never a hardcoded fixture
    // (end-to-end flow step 2's hard requirement).
    const useCases = await withOrgContext(org.organizationId, (tx) =>
      tx.use_cases.findMany({ where: { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null } }),
    );

    const candidates = generateKeywordCandidates({
      categories: brand.categories,
      useCases: useCases.map((uc) => ({
        title: uc.title,
        industries: uc.industries,
        painPoints: uc.pain_points,
        solutions: uc.solutions,
      })),
    });

    if (candidates.length === 0) {
      return c.json(
        {
          error: 'no_candidates',
          message: 'This brand has no categories or use cases yet to generate keywords from. Add some via PATCH /brands/me or POST /brands/me/use-cases first.',
        },
        422,
      );
    }

    // Provider call happens OUTSIDE the write transaction — it makes no
    // network call today (NullSEODataProvider), but a future real provider
    // implementation might, and a slow external call has no business
    // holding open a database transaction.
    const provider = getSEODataProvider();
    const keywordData = await provider.getKeywordData(candidates);

    const created = await withOrgContext(org.organizationId, async (tx) => {
      const group = await tx.keyword_groups.create({
        data: {
          organization_id: org.organizationId,
          brand_id: brand.id,
          name: parsed.data.name ?? `${brand.name} Keywords`,
          created_by: user.id,
        },
      });

      // createMany, then a separate findMany — createMany does not return
      // the created rows in Prisma, and each row's own `id` is needed next
      // to build its matching seo_opportunities row.
      await tx.seo_keywords.createMany({
        data: keywordData.map((k) => ({
          organization_id: org.organizationId,
          keyword_group_id: group.id,
          text: k.keyword,
          intent: k.intent,
          monthly_volume: k.monthlyVolume,
          difficulty: k.difficulty,
          confidence: k.confidence,
          source: mapProviderSource(k.source),
          created_by: user.id,
        })),
      });
      const keywords = await tx.seo_keywords.findMany({
        where: { keyword_group_id: group.id, deleted_at: null },
        orderBy: { created_at: 'asc' },
      });

      const opportunities = [];
      // Sequential for the same reason as /analyze above — one shared `tx`.
      for (const keyword of keywords) {
        const scoringInput = buildOpportunityScoringInput({
          text: keyword.text,
          monthlyVolume: keyword.monthly_volume,
          difficulty: keyword.difficulty,
          intent: keyword.intent,
        });
        const scored = computeOpportunityScore(scoringInput);
        const opportunity = await tx.seo_opportunities.create({
          data: {
            organization_id: org.organizationId,
            brand_id: brand.id,
            keyword_id: keyword.id,
            title: `Target "${keyword.text}"`,
            opportunity_type: classifyOpportunityType(keyword.text, keyword.intent),
            value_score: scored.valueScore,
            effort_score: scored.effortScore,
            opportunity_score: scored.opportunityScore,
            scoring_formula_version: scored.formulaVersion,
            status: 'new',
            evidence: {
              demandScore: scoringInput.demandScore,
              currentCoverage: scoringInput.currentCoverage,
              contentComplexity: scoringInput.contentComplexity,
              technicalDifficulty: scoringInput.technicalDifficulty,
            },
          },
        });
        opportunities.push(opportunity);
      }

      return { group, keywords, opportunities };
    });

    await writeManualAuditEvent(c, {
      action: 'keyword_group.generated',
      entityType: 'keyword_group',
      entityId: created.group.id,
    });

    return c.json(
      {
        keywordGroup: serializeKeywordGroup(created.group),
        keywords: created.keywords.map(serializeKeyword),
        opportunities: created.opportunities.map(serializeOpportunity),
      },
      201,
    );
  },
);

// ── keywords CRUD (scoped to a keyword_group) ───────────────────────────

seoRoute.get(
  '/keyword-groups/:id/keywords',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(VIEW),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const group = await getKeywordGroup(org.organizationId, brand.id, c.req.param('id'));
    if (!group) return c.json(NO_KEYWORD_GROUP_ERROR, 404);

    const rows = await withOrgContext(org.organizationId, (tx) =>
      tx.seo_keywords.findMany({
        where: { keyword_group_id: group.id, organization_id: org.organizationId, deleted_at: null },
        orderBy: { created_at: 'asc' },
      }),
    );

    return c.json(rows.map(serializeKeyword));
  },
);

const keywordCreateSchema = z.object({
  text: z.string().trim().min(1).max(500),
  intent: z.enum(['informational', 'navigational', 'commercial', 'transactional']).optional(),
  monthlyVolume: z.number().int().min(0).nullable().optional(),
  difficulty: z.number().int().min(0).max(100).nullable().optional(),
  // A human typing a keyword in directly is asserting it, not estimating it
  // — defaults to 'high', unlike the generate action's provider-driven
  // rows, which always carry whatever confidence the provider itself
  // reports (see this file's `/keyword-groups/generate` handler).
  confidence: z.enum(['high', 'medium', 'low', 'estimate']).default('high'),
});

seoRoute.post(
  '/keyword-groups/:id/keywords',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = keywordCreateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const group = await getKeywordGroup(org.organizationId, brand.id, c.req.param('id'));
    if (!group) return c.json(NO_KEYWORD_GROUP_ERROR, 404);

    const input = parsed.data;
    const created = await withOrgContext(org.organizationId, (tx) =>
      tx.seo_keywords.create({
        data: {
          organization_id: org.organizationId,
          keyword_group_id: group.id,
          text: input.text,
          intent: input.intent ?? null,
          monthly_volume: input.monthlyVolume ?? null,
          difficulty: input.difficulty ?? null,
          confidence: input.confidence,
          source: 'manual',
          created_by: user.id,
        },
      }),
    );

    await writeManualAuditEvent(c, { action: 'keyword.created', entityType: 'seo_keyword', entityId: created.id });

    return c.json(serializeKeyword(created), 201);
  },
);

const keywordUpdateSchema = keywordCreateSchema.partial();

seoRoute.patch(
  '/keyword-groups/:id/keywords/:keywordId',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'keyword.updated', entityType: 'seo_keyword', getEntityId: (c) => c.req.param('keywordId') ?? 'unknown' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = keywordUpdateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const group = await getKeywordGroup(org.organizationId, brand.id, c.req.param('id'));
    if (!group) return c.json(NO_KEYWORD_GROUP_ERROR, 404);

    const keywordId = c.req.param('keywordId');
    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.seo_keywords.findFirst({
        where: { id: keywordId, keyword_group_id: group.id, organization_id: org.organizationId, deleted_at: null },
      }),
    );
    if (!existing) return c.json(NO_KEYWORD_ERROR, 404);

    const input = parsed.data;
    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.seo_keywords.update({
        where: { id: existing.id },
        data: {
          ...(input.text !== undefined && { text: input.text }),
          ...(input.intent !== undefined && { intent: input.intent }),
          ...(input.monthlyVolume !== undefined && { monthly_volume: input.monthlyVolume }),
          ...(input.difficulty !== undefined && { difficulty: input.difficulty }),
          ...(input.confidence !== undefined && { confidence: input.confidence }),
          updated_by: user.id,
          updated_at: new Date(),
        },
      }),
    );

    return c.json(serializeKeyword(updated));
  },
);

seoRoute.delete(
  '/keyword-groups/:id/keywords/:keywordId',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'keyword.deleted', entityType: 'seo_keyword', getEntityId: (c) => c.req.param('keywordId') ?? 'unknown' }),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const group = await getKeywordGroup(org.organizationId, brand.id, c.req.param('id'));
    if (!group) return c.json(NO_KEYWORD_GROUP_ERROR, 404);

    const keywordId = c.req.param('keywordId');
    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.seo_keywords.findFirst({
        where: { id: keywordId, keyword_group_id: group.id, organization_id: org.organizationId, deleted_at: null },
      }),
    );
    if (!existing) return c.json(NO_KEYWORD_ERROR, 404);

    await withOrgContext(org.organizationId, (tx) =>
      tx.seo_keywords.update({ where: { id: existing.id }, data: { deleted_at: new Date() } }),
    );

    return c.json({ success: true });
  },
);

// ── seo_opportunities — list (sorted desc), get, dismiss ────────────────

const opportunityListQuerySchema = z.object({
  status: z.enum(['new', 'in_progress', 'completed', 'dismissed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

// Sorted SERVER-SIDE by opportunity_score desc (stable — a fixed secondary
// key breaks ties deterministically) so the UI never needs to re-sort
// client-side in a way that could drift from what's actually stored (the
// epic's end-to-end flow step 4's explicit requirement).
seoRoute.get('/opportunities', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const parsed = opportunityListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  const { status, limit, offset } = parsed.data;

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const where = {
    organization_id: org.organizationId,
    brand_id: brand.id,
    ...(status ? { status } : {}),
  };

  const [total, rows] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.seo_opportunities.count({ where }),
      tx.seo_opportunities.findMany({
        where,
        orderBy: [{ opportunity_score: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ]),
  );

  return c.json({
    opportunities: rows.map(serializeOpportunity),
    pagination: { total, limit, offset },
  });
});

seoRoute.get('/opportunities/:id', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const row = await withOrgContext(org.organizationId, (tx) =>
    tx.seo_opportunities.findFirst({
      where: { id: c.req.param('id'), organization_id: org.organizationId, brand_id: brand.id },
    }),
  );
  if (!row) return c.json(NO_OPPORTUNITY_ERROR, 404);

  return c.json(serializeOpportunity(row));
});

seoRoute.patch(
  '/opportunities/:id/dismiss',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'opportunity.dismissed', entityType: 'seo_opportunity' }),
  async (c) => {
    const org = c.get('org');
    const user = c.get('user');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.seo_opportunities.findFirst({
        where: { id: c.req.param('id'), organization_id: org.organizationId, brand_id: brand.id },
      }),
    );
    if (!existing) return c.json(NO_OPPORTUNITY_ERROR, 404);

    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.seo_opportunities.update({
        where: { id: existing.id },
        data: { status: 'dismissed', updated_by: user.id, updated_at: new Date() },
      }),
    );

    return c.json(serializeOpportunity(updated));
  },
);

export default seoRoute;
