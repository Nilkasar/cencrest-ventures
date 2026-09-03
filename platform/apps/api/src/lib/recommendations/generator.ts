/**
 * Epic 10 (Recommendation Engine) — pure, deterministic brief generation.
 * Every export here is side-effect-free (no database, no AI provider, no
 * clock, no network) — same discipline `lib/opportunities/merge-scoring.ts`
 * uses for the identical reason: the template/priority-rank logic is
 * proven by unit tests against plain object literals, not by exercising the
 * whole route. `routes/opportunity-recommendations.ts` is the only caller —
 * it loads the real `unified_opportunities` row + its `opportunity_evidence`
 * rows and maps them into the small input shape below.
 *
 * ── Generation approach (this epic's spec, verbatim) ─────────────────────
 * "Template-driven from `action_type`, populated with the opportunity's
 * evidence — NOT a free-form LLM generation at this stage." This module
 * NEVER calls an AI provider and never invents facts: every number in
 * `evidence_summary` is a real `opportunity_evidence.summary` sentence
 * (already written, with real numbers, by Epic 9's merge); every checklist
 * item in `implementation_notes` is transcribed from
 * `docs/10-seo/SEO_ENGINE.md`'s Page Analysis Checklist and
 * `docs/11-geo/GEO_ENGINE.md`'s GEO Optimization Principles, not invented.
 *
 * ── `action_type` derivation ──────────────────────────────────────────────
 * `unified_opportunity_type` has five values; `recommendation_action_type`
 * has four. `actionTypeForOpportunityType` is a TOTAL, documented mapping
 * over all five (see its own comment) — `seo`/`unified` -> `create_page`
 * (Epic 9's merge always models these with `currentCoverage: 0`, i.e. no
 * existing page for the intent), `geo` -> `build_citations` (the remedy for
 * "competitor appears in AI answers, you don't" with no SEO gap alongside
 * it is authority/citation-building, not a brand-new page), and the two
 * forward-reserved types (`content`/`technical`, not yet produced by Epic
 * 9's own recompute — see `@bebest/database` DECISIONS.md's Epic 9 section)
 * map to `update_page`/`fix_technical` respectively, so the mapping is
 * already correct the day a future opportunity-producer starts emitting
 * those types, and so this epic's own tests can exercise SEO+GEO coverage
 * for literally every `action_type` value today via fixture rows.
 *
 * ── `priority_rank` (this epic's spec, verbatim: "computed from the parent
 * opportunity's opportunity_score plus effort") ──────────────────────────
 * `priorityRank = round2(opportunityScore * EFFORT_RANK_MULTIPLIER[effort])`
 * — HIGHER ranks first (`GET /brands/me/recommendations` orders by this
 * DESC, the same convention `unified_opportunities.opportunity_score`
 * itself already uses). A `low`-effort recommendation keeps the FULL
 * opportunity_score; `medium`/`high` effort discount it (0.75x/0.5x,
 * documented v1 judgment calls, not values from any source doc — same
 * "documented threshold" treatment `merge-scoring.ts`'s
 * `MATERIAL_CHANGE_SCORE_DELTA` gets). This is exactly the ordering the
 * spec's DoD asks for: "cheap, high-impact recommendations rank above
 * expensive, high-impact ones" — two recommendations built from
 * opportunities with the SAME opportunity_score are ordered strictly by
 * effort; a `low`-effort one is NEVER outranked by a `medium`/`high`-effort
 * one built from an equal-or-lower-scored opportunity.
 */
import type { recommendation_action_type, unified_opportunity_type } from '@bebest/database';

export type RecommendationLevel = 'low' | 'medium' | 'high';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── action_type derivation ────────────────────────────────────────────────

/** Total over every `unified_opportunity_type` value — see this file's
 * header comment for the full reasoning. */
export function actionTypeForOpportunityType(type: unified_opportunity_type): recommendation_action_type {
  switch (type) {
    case 'unified':
    case 'seo':
      return 'create_page';
    case 'geo':
      return 'build_citations';
    case 'content':
      return 'update_page';
    case 'technical':
      return 'fix_technical';
  }
}

// ── effort/impact level derivation (0-100 opportunity score -> low/medium/
// high) — same "documented v1 threshold, not a value from any source doc"
// treatment `merge-scoring.ts`'s `priorityFromScore` gets, deliberately
// reusing its exact 30/60 boundaries so a recommendation's effort/impact
// bucket lines up with the SAME thresholds the opportunity's own
// `priority` (1/2/3) already uses, rather than inventing a second set of
// cut points for what is conceptually the same 0-100 scale. ────────────
export function levelFromScore(score: number): RecommendationLevel {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

// ── priority_rank ──────────────────────────────────────────────────────────

/** See this file's header comment. Exported so the route and tests share
 * the exact same multiplier table rather than two copies drifting apart. */
export const EFFORT_RANK_MULTIPLIER: Record<RecommendationLevel, number> = {
  low: 1,
  medium: 0.75,
  high: 0.5,
};

export function computePriorityRank(opportunityScore: number, effort: RecommendationLevel): number {
  return round2(opportunityScore * EFFORT_RANK_MULTIPLIER[effort]);
}

// ── Title / description templates ─────────────────────────────────────────

export interface EvidenceRow {
  sourceTable: string;
  summary: string;
  rawData: Record<string, unknown> | null;
}

/** Picks the GEO competitor with the highest mention rate out of this
 * opportunity's `ai_runs`-sourced evidence rows, if any — used to name a
 * concrete "[Brand] vs [leading competitor]" comparison the way this
 * epic's spec's own literal example does. `null` when the opportunity has
 * no GEO evidence at all (a pure `seo`-typed opportunity). */
export function topCompetitorName(evidence: readonly EvidenceRow[]): string | null {
  let best: { name: string; rate: number } | null = null;
  for (const row of evidence) {
    if (row.sourceTable !== 'ai_runs' || !row.rawData) continue;
    const name = row.rawData.competitorName;
    const rate = row.rawData.competitorMentionRatePct;
    if (typeof name !== 'string' || typeof rate !== 'number') continue;
    if (!best || rate > best.rate) best = { name, rate };
  }
  return best?.name ?? null;
}

export interface BriefContext {
  actionType: recommendation_action_type;
  intentText: string;
  brandName: string;
  competitorName: string | null;
}

/** "Build a comparison page: [Brand] vs [leading competitor] for [intent]"
 * for `create_page` WITH a known competitor — the epic spec's own literal
 * quoted example, reproduced exactly when the data to fill it in is
 * available; a plain "build a new page" title otherwise (a pure SEO-only
 * opportunity has no competitor to name). */
export function titleForRecommendation(ctx: BriefContext): string {
  const { actionType, intentText, brandName, competitorName } = ctx;
  switch (actionType) {
    case 'create_page':
      return competitorName
        ? `Build a comparison page: ${brandName} vs ${competitorName} for ${intentText}`
        : `Build a new page targeting "${intentText}"`;
    case 'build_citations':
      return competitorName
        ? `Earn AI citations to close the visibility gap for "${intentText}" (currently dominated by ${competitorName})`
        : `Earn AI citations to close the visibility gap for "${intentText}"`;
    case 'update_page':
      return `Update the existing page for "${intentText}" to close its coverage gap`;
    case 'fix_technical':
      return `Fix the technical SEO issues blocking "${intentText}"`;
  }
}

export function descriptionForRecommendation(ctx: BriefContext): string {
  const { actionType, intentText, brandName, competitorName } = ctx;
  switch (actionType) {
    case 'create_page':
      return competitorName
        ? `Publish a new page comparing ${brandName} to ${competitorName} for "${intentText}" — no page targets this intent today, and ${competitorName} already dominates the AI answers for it.`
        : `Publish a new page targeting "${intentText}" — there is currently no dedicated page covering this intent.`;
    case 'build_citations':
      return competitorName
        ? `Earn citations on the sources AI already trusts for "${intentText}" — ${competitorName} is the incumbent AI models currently cite for this intent.`
        : `Earn citations on the sources AI already trusts for "${intentText}".`;
    case 'update_page':
      return `Update the existing page covering "${intentText}" to close its remaining coverage gap.`;
    case 'fix_technical':
      return `Resolve the technical SEO issues preventing "${intentText}" from ranking or being crawled correctly.`;
  }
}

/** Quotes the parent opportunity's real evidence sentences verbatim — this
 * epic's DoD-required "not a generic template string with no real data
 * interpolated." */
export function evidenceSummaryForRecommendation(opportunityScore: number, priority: 1 | 2 | 3, evidence: readonly EvidenceRow[]): string {
  const quoted = evidence.map((e) => e.summary).join(' ');
  const prefix = `Opportunity score ${opportunityScore}/100 (priority ${priority}).`;
  return quoted ? `${prefix} ${quoted}` : prefix;
}

// ── implementation_notes: the dual SEO+GEO requirement, per action_type ───

/** Transcribed from `docs/10-seo/SEO_ENGINE.md`'s Page Analysis Checklist —
 * the subset of checklist items relevant to each `action_type`, not the
 * whole checklist verbatim for every type (a `fix_technical` brief has no
 * business telling someone to write a meta description). */
const SEO_REQUIREMENTS: Record<recommendation_action_type, string> = {
  create_page:
    'Title tag 50-60 characters containing the primary keyword; meta description 140-160 characters with a clear CTA; exactly one H1 containing the primary keyword; minimum 300 words of body content with internal links to related pages; Organization/Service schema; HTTPS, a correct canonical tag, and inclusion in the sitemap.',
  update_page:
    'Re-audit the existing title tag, meta description, and H1 against the checklist (50-60 / 140-160 characters, primary keyword present, H1 different from the title tag); add internal links to related pages if missing; expand content to at least 300 words if thin; add FAQ or Product/Service schema if missing.',
  fix_technical:
    'Fix HTTPS, the canonical tag, any accidental noindex, robots.txt crawler accessibility, broken internal links, and missing image alt text — the Technical section of the Page Analysis Checklist.',
  build_citations:
    "Before pursuing citations, confirm the linked page itself passes the checklist's Technical section (HTTPS, correct canonical tag, not noindexed, in the sitemap, accessible to crawlers) so AI and search crawlers can actually retrieve it once citations point to it.",
};

/** Transcribed from `docs/11-geo/GEO_ENGINE.md`'s "GEO OPTIMIZATION
 * PRINCIPLES" list, same per-`action_type` narrowing as the SEO side
 * above. */
const GEO_REQUIREMENTS: Record<recommendation_action_type, string> = {
  create_page:
    'Server-render the page (no JS-only content) so AI can retrieve it (principle 1); write its claims in FAQ/numbered-list form AI can lift directly (principle 5); explicitly state the entity association between the brand and this use case (principle 2).',
  update_page:
    "Add named, citable evidence — a benchmark, a data point, \"Company X's 2025 study showed...\" (principle 4) — and restructure existing prose into FAQ/numbered-claim form so AI can lift it directly (principle 5).",
  fix_technical:
    'Ensure the fixed page is server-rendered and crawlable — AI cannot retrieve what it cannot read (principle 1) — and keep its content fresh going forward (principle 7).',
  build_citations:
    'Pursue placement on the domains AI already trusts for this category — G2, industry publications, comparison sites (principle 3) — and publish named benchmarks that become citable facts (principle 4).',
};

export function implementationNotesForRecommendation(actionType: recommendation_action_type, intentText: string, competitorName: string | null): string {
  const grounding = competitorName
    ? ` Evidence: AI responses for "${intentText}" currently cite ${competitorName}, not this brand.`
    : ` Evidence: this brief is generated for the intent "${intentText}".`;
  return `SEO requirements: ${SEO_REQUIREMENTS[actionType]}\n\nGEO requirements: ${GEO_REQUIREMENTS[actionType]}${grounding}`;
}
