# Epic 7 — AI Visibility Engine (GEO core) (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 5 (Query Universe) and Epic 6 (AI Provider Abstraction) both existing.

## Why this epic

This is the product's core differentiator (`docs/11-geo/GEO_ENGINE.md`): running a brand's query universe across real AI assistants and computing a deterministic, evidence-backed AI Visibility Score. Everything in `PRODUCT_VISION.md`'s "product loop" (OBSERVE → MEASURE) starts here.

## Domain model (`docs/06-database/SCHEMA.md` §3, already ported/audited in Epic 0)

- `ai_runs` — one execution of a `query_set` across a set of providers: `providers[]`, `status`, `total_jobs`/`completed_jobs`/`failed_jobs`, `ai_visibility_score`, `scoring_formula_version`.
- `ai_responses` — one (query × provider) result: `raw_response`, `prompt_version`, `temperature`, token/latency metrics, `request_id`.
- `brand_observations` — the LLM-extracted structured fields per response (`brand_mentioned`, `brand_first_position`, `brand_sentiment`, `brand_recommended`, `competitors_mentioned[]`, `cited_urls[]`, extraction metadata) — this is the ADR-004 boundary: LLMs write this table, nothing else.

## The pipeline (`docs/12-ai/AI_ARCHITECTURE.md` "GEO Query Execution", implement exactly this shape)

```
1. PREPARE — load query set, validate providers configured, check rate limits/budget, create ai_run record
2. QUEUE — push each (query × provider) pair as a job (Epic 0/3's job mechanism — pg-boss if wired, else the documented setImmediate placeholder with a TODO)
3. EXECUTE (worker) — render prompt template, call AIProvider.complete(), store raw response immediately (before extraction — never lose data if extraction fails), then AIProvider.extract() against the BrandObservation schema, compute scores, update run progress
4. AGGREGATE — once all jobs complete, compute the composite AVS, per-intent breakdown, competitor comparison
5. DELIVER — run summary, notify customer, update dashboard
```

**Store the raw response before extraction, always** — this is the evidence-traceability guarantee (`docs/11-geo/GEO_ENGINE.md`'s "every score must be explainable, click through to raw responses"). If extraction fails or is retried later, the raw evidence must never be lost.

## AI Visibility Score — formula v1.0 (`docs/11-geo/GEO_ENGINE.md`, verbatim, versioned)

```
MentionScore = mentioned / (queries × models) × 100
RecommendationScore = top-3-recommended / queries × 100
PositionScore = average(1 - first_position) × 100
CoverageScore = intents_covered / total_intents × 100
AVS = MentionScore×0.25 + RecommendationScore×0.40 + PositionScore×0.20 + CoverageScore×0.15
```
Deterministic, unit-tested with fixed inputs/expected outputs, `scoring_formula_version = "1.0"` stored on every computed score. This is the second load-bearing formula in the system (after Epic 4's SEO Opportunity Score) — reuse Epic 4's testing pattern.

## Provider routing (`docs/12-ai/AI_ARCHITECTURE.md`)

GEO queries specifically MUST use `taskDefaults['geo.query'] = ['openai', 'anthropic', 'google', 'perplexity']` — all 4 real cloud assistants, never Ollama, because the product's entire claim is "here's what real AI assistants say," and a local model's opinion isn't evidence of that. Extraction (`extract()` on the raw responses) may use Ollama. This distinction must be enforced in code, not left to convention.

## API surface

- `POST /brands/:id/ai-runs` — kicks off a run against the brand's active query_set, entitlement-checked (query volume against the plan's monthly AI-query limit from `docs/16-billing/BILLING_ARCHITECTURE.md`).
- `GET /ai-runs/:id` — status/progress (job counts).
- `GET /ai-runs/:id/score` — the AVS + full formula breakdown (mirrors the evidence-trace example in `docs/11-geo/GEO_ENGINE.md`).
- `GET /ai-runs/:id/responses` — paginated raw-response explorer.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "AI Visibility" screen ("What do AI assistants say about me?"): score with model breakdown, score breakdown by intent, a raw response explorer, citation source map, sentiment analysis. The score display must let a user drill from the number down to the formula to the underlying observations to the actual raw AI response — this is non-negotiable per the evidence-traceability principle; a bare number is a failed implementation of this screen. Long-running run progress (30–60 minutes for a full run) needs real step-by-step status per `docs/13-agents/AGENT_ARCHITECTURE.md`'s event types, not a spinner — reuse whatever progress-UI pattern Epic 3's crawler screen established.

## End-to-end flow (qa-flow-tester must trace every step below, not just each pipeline stage in isolation)

1. `POST /brands/:id/ai-runs` — confirm it's rejected with a specific entitlement error if it would exceed the plan's monthly AI-query limit, BEFORE any provider is called (not after burning the budget).
2. A queued job executes (mocked provider) — confirm the raw response is persisted to `ai_responses` even if the subsequent extraction step throws (evidence must never be lost to an extraction bug).
3. Extraction runs and writes `brand_observations` — confirm the row links back to the exact `ai_responses.id` it came from, so a UI can walk score → observation → raw response.
4. All jobs for the run complete — confirm the aggregate `ai_visibility_score` on `ai_runs` is computed from the formula (not hand-set), `scoring_formula_version` is stamped, and `GET /ai-runs/:id/score` returns a breakdown whose four components actually sum to the stored total under the stated weights.
5. The customer-facing "AI Visibility" screen renders the completed run — confirm a user can click from the headline score down to a specific intent's breakdown down to a specific raw AI response, not just see a static number.
6. Re-run the same query set — confirm a new `ai_runs` row is created (history preserved) rather than overwriting the prior run, so before/after comparison (Epic 14) has data to work with.
7. Tenant isolation check across every table touched above (`ai_runs`, `ai_responses`, `brand_observations`).

## Definition of done

Standard DoD. Formula unit tests (hard gate). A test proving raw responses are persisted even when extraction subsequently fails (evidence-preservation guarantee). Provider-routing test proving GEO queries never silently fall back to Ollama.
