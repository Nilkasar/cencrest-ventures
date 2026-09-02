/**
 * Epic 7 — AI Visibility Engine (GEO core) domain model.
 *
 * Mirrors `apps/api/src/lib/ai-visibility/serialize.ts` field-for-field —
 * see `docs/epics/07-ai-visibility-engine-backend.md`'s "API surface"
 * section, which is the literal contract this file was written against
 * (read the actual route/serializer source too, not just the doc).
 */

export type AiRunStatus = "queued" | "running" | "completed" | "failed";

export interface AiRun {
  id: string;
  brandId: string;
  querySetId: string;
  /** Snapshotted at PREPARE time — e.g. `["openai","anthropic","google","perplexity"]`.
   *  Never Ollama; see `docs/12-ai/AI_ARCHITECTURE.md`'s routing table. */
  providers: string[];
  status: AiRunStatus;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  /** 100 once status is completed/failed, otherwise `(completed+failed)/total`. */
  progressPct: number;
  aiVisibilityScore: number | null;
  scoringFormulaVersion: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreComponent {
  value: number | null;
  weight: number;
  weightedContribution: number | null;
}

export type ScoreComponentKey = "mentionScore" | "recommendationScore" | "positionScore" | "coverageScore";

/** `GET /ai-runs/:id/score` — always 200, `computed: false` (every field
 *  null except `runId`/`status`/`formula`) before AGGREGATE finishes, so a
 *  frontend polls this exactly like it polls run status. */
export interface AiRunScore {
  runId: string;
  status: AiRunStatus;
  computed: boolean;
  aiVisibilityScore: number | null;
  scoringFormulaVersion: string | null;
  formula: string;
  breakdown: Record<ScoreComponentKey, ScoreComponent>;
}

export type ExtractionStatus = "pending" | "completed" | "failed";
export type BrandSentiment = "positive" | "neutral" | "negative" | "mixed";
export type RecommendationStrength = "strong" | "weak" | "implied";
export type ExtractionConfidence = "high" | "medium" | "low";

/** The ADR-004 boundary row — the only table an LLM's extraction call ever
 *  writes. 1:1 with the `AiRunResponse` it was extracted from. */
export interface BrandObservation {
  id: string;
  queryId: string;
  aiRunResponseId: string;
  brandMentioned: boolean;
  brandFirstPosition: number | null;
  brandMentionCount: number;
  brandSentiment: BrandSentiment | null;
  brandContext: string | null;
  brandRecommended: boolean;
  brandRecommendationStrength: RecommendationStrength | null;
  competitorsMentioned: string[];
  citedUrls: string[];
  citedDomains: string[];
  responseLanguage: string | null;
  responseWordCount: number | null;
  extractionModelUsed: string;
  extractionPromptVersion: string;
  extractionConfidence: ExtractionConfidence;
  createdAt: string;
}

/** One (query x provider) job's result. `rawResponse` is ALWAYS populated
 *  once this row exists at all — evidence is committed before extraction
 *  is even attempted, so it's intact even when `extractionStatus` is
 *  `"failed"`. `observation` is `null` only when extraction hasn't
 *  succeeded (yet, or ever) for this response. */
export interface AiRunResponse {
  id: string;
  queryId: string;
  provider: string;
  model: string;
  promptVersion: string;
  temperature: number | null;
  rawResponse: string;
  requestId: string | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensTotal: number | null;
  latencyMs: number | null;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  extractedAt: string | null;
  createdAt: string;
  observation: BrandObservation | null;
}

export interface AiRunResponsesPage {
  items: AiRunResponse[];
  total: number;
  limit: number;
  offset: number;
}

/** Lightweight projection of a `queries` row (`GET /brands/me/query-sets/:id/queries`)
 *  — only what the AI Visibility screen needs to label a response's query
 *  and group by intent. See `@/data/query-universe/types` for the full
 *  curation-side `Query` shape this deliberately doesn't duplicate. */
export interface AiVisibilityQueryMeta {
  id: string;
  text: string;
  intentType: "informational" | "commercial" | "comparison" | "transactional" | null;
  category: string | null;
}
