import { db } from './db.js'
import { completeWithFallback } from './ai-provider.js'

export type ContentBrief = {
  id: string
  brand_id: string
  page_id?: string | null
  content_type: string
  title: string
  target_query?: string | null
  target_stage?: string | null
  target_intent?: string | null
  keywords: string[]
  outline: unknown[]
  status: string
  created_by?: string | null
  created_at: Date
  updated_at: Date
  deleted_at?: Date | null
}

export type GeneratedContentRow = {
  id: string
  brief_id: string
  brand_id: string
  provider_name: string
  model_name: string
  content_type: string
  title: string
  body: string
  word_count: number
  ai_readiness_score: number
  entity_count: number
  structured_data_included: boolean
  status: string
  feedback: unknown
  generated_at: Date
  created_at: Date
  updated_at: Date
}

function computeWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function computeEntityCount(text: string): number {
  const matches = text.match(/\b[A-Z][a-z]+\b/g) ?? []
  return new Set(matches).size
}

function computeStructuredData(text: string): boolean {
  return text.includes('FAQ') || text.includes('##') || text.includes('<schema')
}

function computeAiReadinessScore(
  text: string,
  wordCount: number,
  entityCount: number,
  structuredDataIncluded: boolean,
  keywords: string[],
): number {
  let score = 0

  if (wordCount >= 800) score += 30
  else if (wordCount >= 500) score += 20

  if (entityCount >= 10) score += 20
  else if (entityCount >= 5) score += 10

  if (structuredDataIncluded) score += 25

  if (keywords.length > 0) {
    const lower = text.toLowerCase()
    const found = keywords.filter((kw) => lower.includes(kw.toLowerCase())).length
    score += Math.round(25 * (found / keywords.length))
  }

  return Math.min(score, 100)
}

export async function generateContentFromBrief(briefId: string, orgId: string): Promise<GeneratedContentRow> {
  const brief = await db.content_briefs.findFirst({ where: { id: briefId, deleted_at: null } }) as ContentBrief | null
  if (!brief) throw new Error(`Brief not found: ${briefId}`)

  const keywords: string[] = Array.isArray(brief.keywords) ? brief.keywords : []

  const systemPrompt =
    'You are an expert content writer optimizing for AI visibility. Write content that is comprehensive, factual, and includes structured information that AI models can easily cite.'

  const userPrompt =
    `Write a ${brief.content_type} titled '${brief.title}'. Target query: ${brief.target_query ?? ''}. Keywords to include: ${keywords.join(', ')}. Buyer stage: ${brief.target_stage ?? ''}. Write 600-1200 words. Include an FAQ section at the end with 3-5 questions.`

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ]

  // completeWithFallback is mocked in tests; in production the real lib handles providers
  const result = await (completeWithFallback as unknown as (
    messages: Array<{ role: string; content: string }>,
    orgId: string,
  ) => Promise<{ text: string; provider: string; model: string }>)(messages, orgId)

  const wordCount = computeWordCount(result.text)
  const entityCount = computeEntityCount(result.text)
  const structuredDataIncluded = computeStructuredData(result.text)
  const aiReadinessScore = computeAiReadinessScore(result.text, wordCount, entityCount, structuredDataIncluded, keywords)

  const row = await db.generated_content.create({
    data: {
      brief_id: briefId,
      brand_id: brief.brand_id,
      provider_name: result.provider,
      model_name: result.model,
      content_type: brief.content_type,
      title: brief.title,
      body: result.text,
      word_count: wordCount,
      ai_readiness_score: aiReadinessScore,
      entity_count: entityCount,
      structured_data_included: structuredDataIncluded,
      status: 'draft',
      feedback: {},
      generated_at: new Date(),
    },
  }) as unknown as GeneratedContentRow

  await db.content_briefs.update({
    where: { id: briefId },
    data: { status: 'generated', updated_at: new Date() },
  })

  return row
}

export async function scoreDraft(
  generatedContentId: string,
): Promise<{ ai_readiness_score: number; suggestions: string[] }> {
  const draft = await db.generated_content.findFirst({ where: { id: generatedContentId } }) as GeneratedContentRow | null
  if (!draft) throw new Error(`Draft not found: ${generatedContentId}`)

  const keywords: string[] = []
  const wordCount = draft.word_count
  const entityCount = draft.entity_count
  const structuredDataIncluded = draft.structured_data_included

  const aiReadinessScore = computeAiReadinessScore(
    draft.body ?? '',
    wordCount,
    entityCount,
    structuredDataIncluded,
    keywords,
  )

  const suggestions: string[] = []
  if (wordCount < 500) suggestions.push('Add more depth — target 500+ words')
  if (entityCount < 5) suggestions.push('Include more named entities (brands, products, people)')
  if (!structuredDataIncluded) suggestions.push('Add an FAQ or structured section for AI citability')

  await db.generated_content.update({
    where: { id: generatedContentId },
    data: { ai_readiness_score: aiReadinessScore, updated_at: new Date() },
  })

  return { ai_readiness_score: aiReadinessScore, suggestions }
}

export async function listBriefs(brandId: string, status?: string): Promise<ContentBrief[]> {
  const where: Record<string, unknown> = { brand_id: brandId, deleted_at: null }
  if (status) where['status'] = status
  return db.content_briefs.findMany({
    where,
    orderBy: { created_at: 'desc' },
  }) as unknown as ContentBrief[]
}

export async function createBrief(data: {
  brand_id: string
  content_type: string
  title: string
  target_query?: string
  target_stage?: string
  target_intent?: string
  keywords?: string[]
  outline?: unknown[]
  created_by?: string
}): Promise<ContentBrief> {
  return db.content_briefs.create({
    data: {
      brand_id: data.brand_id,
      content_type: data.content_type,
      title: data.title,
      target_query: data.target_query ?? null,
      target_stage: data.target_stage ?? null,
      target_intent: data.target_intent ?? null,
      keywords: data.keywords ?? [],
      outline: data.outline ?? [],
      status: 'draft',
      created_by: data.created_by ?? null,
    },
  }) as unknown as ContentBrief
}
