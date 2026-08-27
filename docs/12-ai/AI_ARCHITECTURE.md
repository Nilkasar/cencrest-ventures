# AI ARCHITECTURE — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

---

## PRINCIPLES

1. **No direct AI provider dependency** — All AI calls go through the abstraction layer.
2. **Local-first development** — Ollama + Qwen3 8B supports full development cycle without cloud API keys.
3. **Evidence preservation** — Every AI call is logged: prompt, response, model, version, timestamp.
4. **Deterministic scoring** — LLMs extract observations; formulas compute scores.
5. **Prompt versioning** — Every prompt has a version. Version changes invalidate cached results.
6. **Reproducibility** — Given the same inputs and prompt version, the same observations should be extractable (within model variance bounds).

---

## LOCAL AI SETUP (Development)

**Configured in**: `opencode.json`

```json
{
  "model": "ollama/qwen3:8b",
  "provider": {
    "ollama": {
      "baseURL": "http://localhost:11434/v1",
      "models": {
        "qwen3:8b": { "context": 32768, "output": 8192 }
      }
    }
  }
}
```

**Models for development**:
- `qwen3:8b` — General intelligence, reasoning, observation extraction
- `qwen2.5-coder:7b` — Code generation, structured output

**Ollama must be running** for any AI functionality in development:
```bash
ollama serve
ollama pull qwen3:8b
ollama pull qwen2.5-coder:7b
```

---

## AI PROVIDER ABSTRACTION LAYER

### Interface

```typescript
// Every AI call goes through this interface.
// No application code may call a provider SDK directly.

interface AIProvider {
  readonly name: string;       // 'ollama', 'openai', 'anthropic', 'google', 'perplexity'
  readonly model: string;      // 'qwen3:8b', 'gpt-4o', 'claude-opus-4-5', etc.
  
  // Free-form text completion
  complete(request: CompletionRequest): Promise<CompletionResult>;
  
  // Structured extraction (must return JSON matching schema)
  extract<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>>;
  
  // Check if provider is available
  healthCheck(): Promise<boolean>;
}

interface CompletionRequest {
  systemPrompt?: string;
  userPrompt: string;
  promptVersion: string;     // REQUIRED — for evidence traceability
  temperature?: number;      // default: 0.7
  maxTokens?: number;
  metadata?: Record<string, unknown>;  // stored with response
}

interface CompletionResult {
  provider: string;
  model: string;
  promptVersion: string;
  rawResponse: string;
  tokensUsed: TokenUsage;
  latencyMs: number;
  timestamp: string;          // ISO8601
  requestId: string;          // UUID for tracing
}

interface ExtractionRequest<T> extends CompletionRequest {
  schema: JSONSchema;         // expected output schema
  retries?: number;           // retry if output doesn't match schema (default: 2)
}

interface ExtractionResult<T> extends CompletionResult {
  parsed: T;
  rawResponseBeforeParsing: string;
  parseAttempts: number;
}
```

### Provider Implementations

```typescript
// OllamaProvider — used in development
class OllamaProvider implements AIProvider {
  name = 'ollama';
  baseURL: string;  // default: http://localhost:11434/v1
  model: string;
}

// OpenAIProvider — optional cloud
class OpenAIProvider implements AIProvider {
  name = 'openai';
  apiKey: string;
  model: string;   // 'gpt-4o', 'gpt-4o-mini', etc.
}

// AnthropicProvider — optional cloud (also used for testing GEO)
class AnthropicProvider implements AIProvider {
  name = 'anthropic';
  apiKey: string;
  model: string;   // 'claude-opus-4-5', 'claude-sonnet-4-6', etc.
}

// GoogleProvider — optional cloud (also used for testing GEO)
class GoogleProvider implements AIProvider {
  name = 'google';
  apiKey: string;
  model: string;   // 'gemini-2.0-flash', 'gemini-2.5-pro', etc.
}

// PerplexityProvider — optional cloud (also used for testing GEO)
class PerplexityProvider implements AIProvider {
  name = 'perplexity';
  apiKey: string;
  model: string;   // 'sonar', 'sonar-pro', etc.
}
```

### Provider Resolution

```typescript
// At runtime, providers are resolved by priority:
// 1. Explicitly specified in request
// 2. Configured default provider for the task type
// 3. Global default (Ollama in development)

const providerRegistry = new AIProviderRegistry({
  default: 'ollama',
  providers: {
    ollama: new OllamaProvider({ model: 'qwen3:8b' }),
    openai: new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: 'gpt-4o' }),
    anthropic: new AnthropicProvider({ ... }),
    google: new GoogleProvider({ ... }),
    perplexity: new PerplexityProvider({ ... }),
  },
  // For GEO testing, always use the actual AI assistants:
  taskDefaults: {
    'geo.query': ['openai', 'anthropic', 'google', 'perplexity'],  // all 4 for GEO
    'content.generation': 'openai',  // or ollama if no key
    'seo.analysis': 'ollama',         // can be local
    'extraction': 'ollama',           // can be local
  }
});
```

---

## PROMPT SYSTEM

### Prompt Structure

Every prompt is:
1. Stored as a versioned template in `/prompts/` directory
2. Rendered at runtime with variable substitution
3. Versioned — `prompt_version` is stored with every AI response

```
/prompts/
  geo/
    brand-query.v1.0.txt
    brand-query.v1.1.txt
    extraction-brand-mention.v1.0.txt
    extraction-competitor.v1.0.txt
    extraction-citation.v1.0.txt
  seo/
    page-analysis.v1.0.txt
    content-brief.v1.0.txt
    keyword-intent.v1.0.txt
  content/
    generate-page.v1.0.txt
    fact-check.v1.0.txt
  agents/
    geo-agent-system.v1.0.txt
    seo-agent-system.v1.0.txt
```

### Prompt Versioning Rules
- Patch version (1.0.x): bug fixes that don't change output format
- Minor version (1.x): improvements that may change output values (re-run recommended)
- Major version (x.0): breaking changes to schema/format (re-run required)

When a prompt is versioned up, existing scores are NOT invalidated automatically. The system tracks which prompt version produced which scores, and flags when re-scoring is recommended.

---

## GEO QUERY EXECUTION

The GEO query pipeline is the most compute-intensive operation.

### Pipeline

```
1. PREPARE
   Load query set for brand
   Validate AI providers configured
   Check rate limits and budget
   Create run record in database

2. QUEUE
   Push each (query × provider) pair to job queue
   Default: 1,400 queries × 4 providers = 5,600 jobs

3. EXECUTE (Worker)
   For each job:
   a. Render prompt template with query + brand context
   b. Call AI provider
   c. Store raw response immediately
   d. Extract observations (using extraction LLM)
   e. Compute scores
   f. Update run progress

4. AGGREGATE
   When all jobs complete:
   Compute aggregate AI Visibility Score
   Generate per-intent breakdown
   Generate competitor comparison
   Generate gap analysis

5. DELIVER
   Create run summary
   Notify customer
   Update dashboard
```

### Rate Limiting Strategy

| Provider | Default Rate | Strategy |
|---|---|---|
| Ollama (local) | Unlimited | Queue with concurrency limit (default: 4) |
| OpenAI | Per-plan | Exponential backoff, respect headers |
| Anthropic | Per-plan | Exponential backoff, respect headers |
| Google | Per-plan | Exponential backoff, respect headers |
| Perplexity | Per-plan | Exponential backoff, respect headers |

A full 1,400-query run across 4 providers:
- At 10 queries/min/provider: ~35 minutes
- At 30 queries/min/provider: ~12 minutes
- At 60 queries/min/provider: ~6 minutes

This is a background job. Customers are notified when it completes.

---

## DETERMINISTIC SCORING

LLMs extract structured observations. Formulas compute scores.

### Observation Schema (extracted by LLM)

```typescript
interface BrandObservation {
  // Extracted by LLM from raw AI response
  brandMentioned: boolean;
  brandFirstPosition: number | null;   // character offset 0–1 (0=start, 1=end)
  brandMentionCount: number;
  brandSentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
  brandContext: string | null;          // quoted excerpt around brand mention
  brandRecommended: boolean;            // was brand specifically recommended?
  brandRecommendationStrength: 'strong' | 'weak' | 'implied' | null;
  
  // Competitor observations
  competitorsMentioned: string[];       // competitor names found in response
  
  // Citation observations
  citedUrls: string[];                  // URLs mentioned or linked
  citedDomains: string[];               // normalized domain list
  
  // Response quality
  responseLanguage: string;             // ISO language code
  responseWordCount: number;
  
  // Extraction metadata (NOT from response content)
  extractionModelUsed: string;
  extractionPromptVersion: string;
  extractionConfidence: 'high' | 'medium' | 'low';
}
```

### Score Formulas (all versioned)

```typescript
// Formula Version 1.0

function computeMentionScore(responses: BrandObservation[]): number {
  const mentioned = responses.filter(r => r.brandMentioned).length;
  return (mentioned / responses.length) * 100;
}

function computeRecommendationScore(responses: BrandObservation[]): number {
  const recommended = responses.filter(r => r.brandRecommended).length;
  return (recommended / responses.length) * 100;
}

function computePositionScore(responses: BrandObservation[]): number {
  const withPosition = responses.filter(r => r.brandFirstPosition !== null);
  if (withPosition.length === 0) return 0;
  const avgPositionWeight = withPosition.reduce((sum, r) => {
    return sum + (1 - r.brandFirstPosition!);  // 0=start=best → weight=1.0
  }, 0) / withPosition.length;
  return avgPositionWeight * 100;
}

function computeCoverageScore(
  responses: BrandObservation[],
  queryCount: number
): number {
  const intentsCovered = new Set(
    responses.filter(r => r.brandMentioned).map(r => r.queryId)
  ).size;
  return (intentsCovered / queryCount) * 100;
}

function computeAIVisibilityScore(scores: ComponentScores): number {
  return (
    scores.mentionScore * 0.25 +
    scores.recommendationScore * 0.40 +
    scores.positionScore * 0.20 +
    scores.coverageScore * 0.15
  );
}
```

---

## AI EVALUATION FRAMEWORK

AI output quality must be measured, not assumed.

### Evaluation Datasets (to be built)

| Dataset | Purpose | Size Target |
|---|---|---|
| brand_mention_eval | Does LLM correctly detect brand mention? | 500 labeled examples |
| competitor_detection_eval | Does LLM correctly detect competitors? | 300 labeled examples |
| sentiment_eval | Does LLM correctly classify sentiment? | 400 labeled examples |
| citation_extraction_eval | Does LLM correctly extract URLs? | 300 labeled examples |
| recommendation_detection_eval | Does LLM correctly identify recommendations? | 300 labeled examples |
| content_quality_eval | Does LLM correctly assess content quality? | 200 labeled examples |

### Evaluation Metrics
- Precision, Recall, F1 for binary classification tasks
- Accuracy for multi-class tasks
- BLEU/ROUGE for text generation tasks
- Human evaluation for recommendation quality (not automated)

### Evaluation Cadence
- Run eval suite before every prompt version change
- Run eval suite after every model change
- Store eval results with timestamp and model version
- Alert if any metric drops > 5 points vs. previous run
