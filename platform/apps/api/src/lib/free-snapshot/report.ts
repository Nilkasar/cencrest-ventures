/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — "generate a lightweight report"
 * (`docs/epics/17-free-snapshot.md` step 2f / step 4 of the spec's own flow
 * listing: "top 3 gaps/priorities... a lightweight version of Epic 9/10's
 * scoring, not the full opportunity engine").
 *
 * This is a DELIBERATE SIMPLIFICATION, documented per the epic brief's
 * explicit instruction, not a shortcut hidden from the user — the
 * `simplificationNote` field below ships in the report itself:
 *   - Epic 9 (Opportunity Engine, not yet built) would score every SEO
 *     keyword-demand signal against every GEO gap signal with a real
 *     value/effort formula (`docs/epics/09-opportunity-engine.md`) and
 *     produce ranked, evidence-linked `unified_opportunities` rows.
 *   - Epic 10 (Recommendation Engine, not yet built) would turn those into
 *     actioned recommendations with effort/impact scoring.
 *   - This module does neither. It ranks whatever raw signal is already in
 *     hand (issue frequency/severity for SEO, per-query brand-absence for
 *     AI) with a small, fixed, documented heuristic — good enough for "here
 *     are 3 things to look at," not a claim of the same rigor Epic 9/10
 *     will eventually bring to the PAID product.
 *
 * Pure and synchronous: takes the already-computed crawl/SEO/AI-run results
 * and the original form input, returns one JSON-serializable object — this
 * is exactly what `snapshot_requests.result_json` stores and
 * `GET /snapshot/:token` returns once `status = 'complete'`.
 */
import { CATEGORY_META, type QueryTemplateCategory } from '../query-generator.js';
import type { FreeSnapshotSeoResult } from './seo-analysis.js';
import type { FreeSnapshotAiRunResult } from './ai-run.js';

export interface FreeSnapshotReportInput {
  name: string;
  company: string;
  website: string;
  category: string | null;
  biggestCompetitor: string | null;
}

export interface AiGap {
  query: string;
  category: QueryTemplateCategory;
  /** True when at least one provider mentioned a competitor while
   * answering this query but never the brand — the strongest, most
   * concrete form of "gap" this sample can show. */
  competitorMentionedInstead: boolean;
}

export interface SeoGap {
  issueType: string;
  severity: 'low' | 'medium' | 'high';
  /** Number of crawled sample pages this issue was found on. */
  pageCount: number;
}

export interface CompetitorAppearance {
  name: string;
  /** 0-100, share of sample queries where this name appeared in at least
   * one provider's answer. Source: the caller's own free-snapshot AI run,
   * not Epic 8's full Share-of-AI-Voice engine — see module header. */
  mentionRate: number;
  /** false for the brand itself; true for every entry auto-detected from
   * `competitorsMentioned` rather than typed into the intake form. */
  autoDetected: boolean;
}

export interface FreeSnapshotPriority {
  title: string;
  rationale: string;
}

export interface FreeSnapshotReport {
  generatedAt: string;
  input: FreeSnapshotReportInput;
  aiVisibility: {
    score: number;
    mentionScore: number;
    recommendationScore: number;
    positionScore: number;
    coverageScore: number;
    formulaVersion: string;
    queriesRun: number;
    providers: string[];
  };
  seo: {
    technicalScore: number;
    contentScore: number;
    pagesAnalyzed: number;
  };
  competitors: CompetitorAppearance[];
  topAiGaps: AiGap[];
  topSeoGaps: SeoGap[];
  topPriorities: FreeSnapshotPriority[];
  cta: string;
  simplificationNote: string;
}

const SEVERITY_WEIGHT: Record<'low' | 'medium' | 'high', number> = { high: 3, medium: 2, low: 1 };

function rankTopSeoGaps(seo: FreeSnapshotSeoResult, limit: number): SeoGap[] {
  const byType = new Map<string, { severity: 'low' | 'medium' | 'high'; pages: Set<string> }>();

  for (const issue of seo.issues) {
    const severity = issue.severity as 'low' | 'medium' | 'high';
    const existing = byType.get(issue.issueType);
    if (existing) {
      existing.pages.add(issue.pageUrl);
      if (SEVERITY_WEIGHT[severity] > SEVERITY_WEIGHT[existing.severity]) existing.severity = severity;
    } else {
      byType.set(issue.issueType, { severity, pages: new Set([issue.pageUrl]) });
    }
  }

  return [...byType.entries()]
    .map(([issueType, v]) => ({ issueType, severity: v.severity, pageCount: v.pages.size }))
    .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.pageCount - a.pageCount)
    .slice(0, limit);
}

function rankTopAiGaps(ai: FreeSnapshotAiRunResult, limit: number): AiGap[] {
  const byQuery = new Map<
    string,
    { text: string; category: QueryTemplateCategory; mentioned: boolean; competitorMentioned: boolean }
  >();

  for (const obs of ai.observations) {
    const existing = byQuery.get(obs.queryId) ?? {
      text: obs.queryText,
      category: obs.category,
      mentioned: false,
      competitorMentioned: false,
    };
    existing.mentioned = existing.mentioned || obs.brandMentioned;
    existing.competitorMentioned = existing.competitorMentioned || obs.competitorsMentioned.length > 0;
    byQuery.set(obs.queryId, existing);
  }

  const gaps = [...byQuery.values()]
    .filter((q) => !q.mentioned)
    .map((q) => ({ query: q.text, category: q.category, competitorMentionedInstead: q.competitorMentioned }));

  // Bottom-of-funnel categories first (the same `CATEGORY_META` priority
  // Epic 5's own generator ranks by — 1=high), competitor-confirmed gaps
  // before merely-silent ones within the same priority tier.
  return gaps
    .sort((a, b) => {
      const priorityDiff = CATEGORY_META[a.category].priority - CATEGORY_META[b.category].priority;
      if (priorityDiff !== 0) return priorityDiff;
      return Number(b.competitorMentionedInstead) - Number(a.competitorMentionedInstead);
    })
    .slice(0, limit);
}

function rankCompetitors(input: FreeSnapshotReportInput, ai: FreeSnapshotAiRunResult, limit: number): CompetitorAppearance[] {
  const totalQueries = ai.totalQueries || 1;
  const mentionedQueryIds = new Map<string, Set<string>>(); // name (lowercased) -> set of queryIds it appeared in

  for (const obs of ai.observations) {
    for (const raw of obs.competitorsMentioned) {
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      const set = mentionedQueryIds.get(key) ?? new Set<string>();
      set.add(obs.queryId);
      mentionedQueryIds.set(key, set);
    }
  }

  const result: CompetitorAppearance[] = [];
  const seen = new Set<string>();

  if (input.biggestCompetitor) {
    const key = input.biggestCompetitor.trim().toLowerCase();
    const queryIds = mentionedQueryIds.get(key);
    result.push({
      name: input.biggestCompetitor.trim(),
      mentionRate: Math.round(((queryIds?.size ?? 0) / totalQueries) * 100),
      autoDetected: false,
    });
    seen.add(key);
  }

  const autoDetected = [...mentionedQueryIds.entries()]
    .filter(([key]) => !seen.has(key))
    .sort((a, b) => b[1].size - a[1].size)
    .map(([key, queryIds]) => ({
      name: key.replace(/\b\w/g, (c) => c.toUpperCase()),
      mentionRate: Math.round((queryIds.size / totalQueries) * 100),
      autoDetected: true,
    }));

  for (const candidate of autoDetected) {
    if (result.length >= limit) break;
    result.push(candidate);
  }

  return result.slice(0, limit);
}

function buildPriorities(seoGaps: SeoGap[], aiGaps: AiGap[], competitors: CompetitorAppearance[]): FreeSnapshotPriority[] {
  const priorities: FreeSnapshotPriority[] = [];

  const topAiGap = aiGaps[0];
  priorities.push(
    topAiGap
      ? {
          title: `Close the AI-visibility gap on "${topAiGap.query}"`,
          rationale: topAiGap.competitorMentionedInstead
            ? 'A competitor was mentioned in this AI answer and your brand was not — this is a direct, winnable head-to-head gap.'
            : 'None of the sampled AI providers mentioned your brand for this query.',
        }
      : {
          title: 'No AI-visibility gaps found in this sample',
          rationale: 'The full analysis runs a much larger query set and may still surface gaps this free sample missed.',
        },
  );

  const topSeoGap = seoGaps[0];
  priorities.push(
    topSeoGap
      ? {
          title: `Fix "${topSeoGap.issueType.replace(/_/g, ' ')}" (${topSeoGap.severity} severity)`,
          rationale: `Found on ${topSeoGap.pageCount} of the crawled sample page(s) — a foundational technical/content SEO fix.`,
        }
      : {
          title: 'No major technical SEO issues found in this sample',
          rationale: 'The full crawl analyzes far more pages and may still surface issues this free sample missed.',
        },
  );

  const topCompetitor = competitors.find((c) => c.mentionRate > 0);
  priorities.push(
    topCompetitor
      ? {
          title: `Track "${topCompetitor.name}" in your GEO strategy`,
          rationale: `Mentioned in ${topCompetitor.mentionRate}% of this sample's AI answers — see the full analysis for a complete competitive breakdown.`,
        }
      : {
          title: 'Get the full competitive breakdown',
          rationale: 'Upgrade for Epic 8-level Share-of-AI-Voice tracking across your full competitive set.',
        },
  );

  return priorities;
}

const SIMPLIFICATION_NOTE =
  'This free snapshot uses a lightweight version of the full opportunity/recommendation scoring engine: gaps and priorities here are ranked by raw issue frequency/severity and per-query brand-absence, not the full weighted value/effort model the paid product uses.';

export function buildFreeSnapshotReport(
  input: FreeSnapshotReportInput,
  seo: FreeSnapshotSeoResult,
  ai: FreeSnapshotAiRunResult,
): FreeSnapshotReport {
  const topSeoGaps = rankTopSeoGaps(seo, 3);
  const topAiGaps = rankTopAiGaps(ai, 3);
  const competitors = rankCompetitors(input, ai, 3);

  return {
    generatedAt: new Date().toISOString(),
    input,
    aiVisibility: {
      score: ai.score.aiVisibilityScore,
      mentionScore: ai.score.mentionScore,
      recommendationScore: ai.score.recommendationScore,
      positionScore: ai.score.positionScore,
      coverageScore: ai.score.coverageScore,
      formulaVersion: ai.score.formulaVersion,
      queriesRun: ai.totalQueries,
      providers: ai.providers,
    },
    seo: {
      technicalScore: seo.averageTechnicalScore,
      contentScore: seo.contentScore,
      pagesAnalyzed: seo.pagesAnalyzed,
    },
    competitors,
    topAiGaps,
    topSeoGaps,
    topPriorities: buildPriorities(topSeoGaps, topAiGaps, competitors),
    cta: 'See your full analysis — book a call or sign up.',
    simplificationNote: SIMPLIFICATION_NOTE,
  };
}
