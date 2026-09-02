/**
 * Epic 8 — Competitive Intelligence domain model. Mirrors
 * `platform/apps/api/src/routes/competitive-intelligence.ts` +
 * `routes/competitor-ai-runs.ts` field-for-field — see
 * `docs/epics/08-competitive-intelligence-backend.md`'s "API surface (exact
 * response shapes)" section, which is the literal contract this file was
 * written against (the actual route source was read too, not just the doc).
 *
 * A competitor's AI run itself reuses Epic 7's `AiRun` shape verbatim
 * (`@/data/ai-visibility/types`) — `competitorId` is non-null on it instead
 * of a separate type, since it's genuinely the same `ai_runs` row shape,
 * same statuses, same polling contract.
 */

export interface EntityRunSummary {
  id: string;
  aiVisibilityScore: number | null;
  completedAt: string | null;
}

export interface PerIntentTypeGap {
  /** `queries.intent_type`, or the literal string `'uncategorized'` when a
   *  query has none — never a `null`/`undefined` gap in this array. */
  intentType: string;
  queryCount: number;
  yourScore: number;
  competitorScore: number;
  gap: number;
}

export interface CompetitiveGapCompetitor {
  competitorId: string;
  competitorName: string;
  /** `null` = this competitor has no completed run on the brand's CURRENT
   *  active query set yet (a real, user-visible "re-run me" state, not an
   *  error — see the backend doc's "Not done" section). */
  run: EntityRunSummary | null;
  /** Competitor AVS − Your AVS, aggregate. `null` whenever either side has
   *  no score to compare (mirrors `run` being `null`, or the brand itself
   *  having no completed run). */
  competitiveGap: number | null;
  perIntentTypeGap: PerIntentTypeGap[];
}

export interface QueryStats {
  mentionRatePct: number;
  position: 1 | 2 | 3 | 4 | null;
}

export interface PerQueryCompetitorRow {
  competitorId: string;
  competitorName: string;
  stats: QueryStats;
  /** The signature evidence sentence, verbatim-shaped per
   *  `docs/11-geo/GEO_ENGINE.md`: 'For "<query>," <Competitor> appears in
   *  X% of responses at position N, you appear in Y% of responses at
   *  position M.' — the "at position N" clause is omitted, never
   *  fabricated, when that side was never mentioned at all. */
  sentence: string;
}

export interface PerQueryBreakdownRow {
  queryId: string;
  queryText: string;
  intentType: string | null;
  category: string | null;
  yourStats: QueryStats;
  competitors: PerQueryCompetitorRow[];
}

export type GapType = "intent_gap" | "content_gap" | "entity_gap" | "source_gap";
export type GapSeverity = "high" | "medium";

interface GapCompetitorMention {
  competitorId: string;
  competitorName: string;
  mentionRatePct: number;
}

interface GapCompetitorPresence {
  competitorId: string;
  competitorName: string;
  presencePct: number;
}

interface GapCompetitorCitation {
  competitorId: string;
  competitorName: string;
  citationRatePct: number;
}

export interface IntentGapFinding {
  gapType: "intent_gap";
  severity: GapSeverity;
  queryId: string;
  queryText: string;
  yourMentionRatePct: number;
  competitors: GapCompetitorMention[];
}

export interface ContentGapFinding {
  gapType: "content_gap";
  severity: "medium";
  queryId: string;
  queryText: string;
  citedDomains: string[];
}

export interface EntityGapFinding {
  gapType: "entity_gap";
  severity: GapSeverity;
  category: string;
  yourPresencePct: number;
  competitors: GapCompetitorPresence[];
}

export interface SourceGapFinding {
  gapType: "source_gap";
  severity: GapSeverity;
  domain: string;
  citedByCompetitors: GapCompetitorCitation[];
}

export type GapFinding = IntentGapFinding | ContentGapFinding | EntityGapFinding | SourceGapFinding;

export interface CompetitiveGapsResponse {
  querySetId: string;
  /** `true` once the BRAND has a completed run on this query_set — `false`
   *  is a normal 200 response (poll it like run status), not an error. */
  computed: boolean;
  brandRun: EntityRunSummary | null;
  competitors: CompetitiveGapCompetitor[];
  perQueryBreakdown: PerQueryBreakdownRow[];
  gaps: GapFinding[];
}

export interface ShareOfVoiceCompetitor {
  competitorId: string;
  competitorName: string;
  mentions: number;
  sharePct: number;
  /** `false` = no completed run yet on the brand's current active query
   *  set — contributes 0 mentions, which is the mathematically correct
   *  answer, not a distinct "unknown" state. */
  tracked: boolean;
}

export interface ShareOfVoiceResponse {
  querySetId: string;
  yourMentions: number;
  yourSharePct: number;
  totalMentions: number;
  competitors: ShareOfVoiceCompetitor[];
}

export type MovementDirection = "increase" | "decrease" | "flat";

export interface MovementResult {
  previousScore: number | null;
  latestScore: number | null;
  delta: number | null;
  direction: MovementDirection | null;
  /** e.g. "CompetitorA just increased their AI visibility by 15 points." —
   *  `null` only when no previous completed run exists yet to compare. */
  sentence: string | null;
}
