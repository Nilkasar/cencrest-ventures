/**
 * Epic 11 (Content Intelligence & Generation) — step 3 of the generation
 * pipeline ("Generate outline, then full draft (via AIProvider — task
 * 'content.generation', per Epic 6's routing table)"). Same shape as
 * `lib/ai-visibility/pipeline.ts`'s single-call pattern, simplified: one
 * (brief) job needs exactly one `complete()` call, not a (query x provider)
 * fan-out, so this runs synchronously inside the route handler rather than
 * scheduled through the `JobQueue` (`lib/queue/job-queue.ts`).
 */
import path from 'node:path';
import {
  loadPromptTemplate,
  renderPrompt,
  promptVersionFor,
  type AIProviderRegistry,
} from '@bebest/ai-provider';
import type { BrandClaimForBrief } from './brief-builder.js';

export interface GenerateDraftInput {
  brandName: string;
  contentType: string;
  title: string;
  targetQuery: string;
  keywords: string[];
  implementationNotes: string;
  evidenceSummary: string;
  outline: Array<{ section: string; notes: string }>;
  brandClaims: BrandClaimForBrief[];
}

export interface GeneratedDraftContent {
  providerName: string;
  modelName: string | null;
  promptVersion: string;
  title: string;
  metaDescription: string | null;
  body: string;
  wordCount: number;
  requestId: string | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensTotal: number | null;
  latencyMs: number | null;
}

export interface DraftGeneratorDeps {
  registry: AIProviderRegistry;
  /** Root prompts directory. Defaults to `apps/api/src/prompts`, same
   * convention `lib/ai-visibility/pipeline.ts` uses. */
  promptsBaseDir?: string;
}

function defaultPromptsBaseDir(): string {
  return path.join(import.meta.dirname, '../../prompts');
}

/**
 * Parses the provider's response against `content/generation.v1.0.txt`'s
 * required `TITLE: / META: / BODY:` format. A provider (including a test's
 * hand-rolled mock) that does not follow the format degrades gracefully —
 * the entire raw response becomes the body and the brief's own title is
 * kept — rather than throwing and losing evidence the provider DID return
 * (same "never lose evidence on a downstream parsing failure" principle
 * `ai-visibility/pipeline.ts`'s extraction step already documents, applied
 * here to a simpler regex parse instead of a schema-validated extraction
 * call).
 */
export function parseGeneratedContent(rawResponse: string, fallbackTitle: string): { title: string; metaDescription: string | null; body: string } {
  const titleMatch = /^TITLE:\s*(.+)$/m.exec(rawResponse);
  const metaMatch = /^META:\s*(.+)$/m.exec(rawResponse);
  const bodyMatch = /^BODY:\s*\n([\s\S]*)$/m.exec(rawResponse);

  if (!titleMatch || !bodyMatch) {
    return { title: fallbackTitle, metaDescription: null, body: rawResponse.trim() };
  }

  return {
    title: titleMatch[1]!.trim(),
    metaDescription: metaMatch ? metaMatch[1]!.trim() : null,
    body: bodyMatch[1]!.trim(),
  };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Runs the ACTUAL generation call. `deps.registry` defaults to
 * `getDefaultAiProviderRegistry()` in the route (never constructed here —
 * same "tests inject a hand-rolled fake `AIProvider`, never a real network
 * call" discipline `pipeline.ts` documents), routed via
 * `taskDefaults['content.generation']` (`['openai', 'ollama']` per Epic 6 —
 * see `@bebest/ai-provider`'s `DEFAULT_TASK_DEFAULTS`), never hardcoded to
 * one provider here.
 */
export async function generateDraftContent(input: GenerateDraftInput, deps: DraftGeneratorDeps): Promise<GeneratedDraftContent> {
  const template = loadPromptTemplate({
    baseDir: deps.promptsBaseDir ?? defaultPromptsBaseDir(),
    category: 'content',
    name: 'generation',
  });
  const promptVersion = promptVersionFor(template);

  const userPrompt = renderPrompt(template, {
    brandName: input.brandName,
    contentType: input.contentType,
    title: input.title,
    targetQuery: input.targetQuery,
    keywords: input.keywords.join(', ') || '(none specified)',
    implementationNotes: input.implementationNotes,
    evidenceSummary: input.evidenceSummary,
    brandClaims: input.brandClaims.length > 0 ? input.brandClaims.map((c) => `- ${c.claim}`).join('\n') : '(none on file)',
    outline: input.outline.map((s) => `- ${s.section}: ${s.notes}`).join('\n'),
  });

  const provider = await deps.registry.resolveAvailable('content.generation');
  const result = await provider.complete({ userPrompt, promptVersion });
  const parsed = parseGeneratedContent(result.rawResponse, input.title);

  return {
    providerName: result.provider,
    modelName: result.model ?? null,
    promptVersion: result.promptVersion,
    title: parsed.title,
    metaDescription: parsed.metaDescription,
    body: parsed.body,
    wordCount: countWords(parsed.body),
    requestId: result.requestId ?? null,
    tokensPrompt: result.tokensUsed?.promptTokens ?? null,
    tokensCompletion: result.tokensUsed?.completionTokens ?? null,
    tokensTotal: result.tokensUsed?.totalTokens ?? null,
    latencyMs: result.latencyMs ?? null,
  };
}
