import { db } from './db.js'

export interface ContentAnalysis {
  id: string
  page_id: string
  brand_id: string
  ai_readiness_score: number
  thin_content_flag: boolean
  topic_coverage_score: number
  structured_data_present: boolean
  word_count: number
  reading_level: string
  entity_density: number
  citations_found_in_ai_responses: number
  gap_types: string[]
  improvement_suggestions: ImprovementSuggestion[]
  analyzed_at: Date
  created_at?: Date
  updated_at?: Date
}

export interface ImprovementSuggestion {
  type: string
  priority: string
  suggestion: string
}

export interface GapSummary {
  total_pages: number
  thin_pages: number
  low_readiness_pages: number
  no_structured_data_pages: number
  avg_ai_readiness_score: number
  pages_needing_improvement: ContentAnalysis[]
}

export interface Improvement {
  type: string
  priority: string
  suggestion: string
  affected_pages_count: number
}

const SIGNAL_WORDS = ['what', 'how', 'why', 'when', 'where', 'best', 'compare', 'review', 'price', 'alternative']

const GAP_SUGGESTIONS: Record<string, ImprovementSuggestion> = {
  thin_content: {
    type: 'thin_content',
    priority: 'P1',
    suggestion: 'Expand page content to at least 300 words. Add supporting details, examples, and context to improve depth.',
  },
  no_structured_data: {
    type: 'no_structured_data',
    priority: 'P2',
    suggestion: 'Add JSON-LD structured data (e.g. Article, Product, FAQ) to help AI models and search engines understand your content.',
  },
  low_topic_coverage: {
    type: 'low_topic_coverage',
    priority: 'P2',
    suggestion: 'Improve topic coverage by addressing common questions (what, how, why, comparisons, pricing) that AI models use to evaluate content quality.',
  },
  low_ai_readiness: {
    type: 'low_ai_readiness',
    priority: 'P1',
    suggestion: 'Improve overall AI readiness by adding an H1 tag, meta description, sufficient word count, and structured data to the page.',
  },
}

function getWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function computeReadingLevel(words: string[]): string {
  if (words.length === 0) return 'basic'
  const avgLen = words.reduce((sum, w) => sum + w.replace(/[^a-zA-Z]/g, '').length, 0) / words.length
  if (avgLen < 5) return 'basic'
  if (avgLen < 7) return 'intermediate'
  return 'advanced'
}

export async function analyzeContent(pageId: string, brandId: string): Promise<ContentAnalysis> {
  const page = await db.pages.findFirst({
    where: { id: pageId, brand_id: brandId },
  }) as (Awaited<ReturnType<typeof db.pages.findFirst>> & { content_text?: string | null }) | null

  if (!page) throw new Error(`Page ${pageId} not found for brand ${brandId}`)

  const contentText: string = (page as Record<string, unknown>).content_text as string ?? ''
  const words = contentText ? getWords(contentText) : []
  const word_count = words.length

  const thin_content_flag = word_count < 300

  const structured_data_present = contentText.includes('<script type="application/ld+json">')

  const uniqueWords = new Set(words.map(w => w.toLowerCase()))
  const entity_density = words.length > 0 ? uniqueWords.size / words.length : 0

  const reading_level = computeReadingLevel(words)

  const lowerContent = contentText.toLowerCase()
  const matchedSignals = SIGNAL_WORDS.filter(w => lowerContent.includes(w))
  const topic_coverage_score = (matchedSignals.length / SIGNAL_WORDS.length) * 100

  // AI readiness score
  let ai_readiness_score = 0
  if (page.h1) ai_readiness_score += 15
  if (page.meta_description) ai_readiness_score += 15
  if (word_count >= 500) ai_readiness_score += 20
  else if (word_count >= 300) ai_readiness_score += 10
  if (structured_data_present) ai_readiness_score += 20
  if (entity_density >= 0.02) ai_readiness_score += 15
  else ai_readiness_score += Math.round((entity_density / 0.02) * 15)
  if (!thin_content_flag) ai_readiness_score += 15

  const citations_found_in_ai_responses = await db.ai_responses.count({
    where: { response_text: { contains: page.url } },
  })

  const gap_types: string[] = []
  if (thin_content_flag) gap_types.push('thin_content')
  if (!structured_data_present) gap_types.push('no_structured_data')
  if (topic_coverage_score < 40) gap_types.push('low_topic_coverage')
  if (ai_readiness_score < 50) gap_types.push('low_ai_readiness')

  const improvement_suggestions: ImprovementSuggestion[] = gap_types.map(g => GAP_SUGGESTIONS[g])

  const now = new Date()

  const upserted = await db.content_analyses.upsert({
    where: { page_id: pageId },
    update: {
      brand_id: brandId,
      ai_readiness_score,
      thin_content_flag,
      topic_coverage_score,
      structured_data_present,
      word_count,
      reading_level,
      entity_density,
      citations_found_in_ai_responses,
      gap_types,
      improvement_suggestions,
      analyzed_at: now,
      updated_at: now,
    },
    create: {
      page_id: pageId,
      brand_id: brandId,
      ai_readiness_score,
      thin_content_flag,
      topic_coverage_score,
      structured_data_present,
      word_count,
      reading_level,
      entity_density,
      citations_found_in_ai_responses,
      gap_types,
      improvement_suggestions,
      analyzed_at: now,
    },
  })

  return upserted as unknown as ContentAnalysis
}

export async function getContentGaps(brandId: string): Promise<GapSummary> {
  const analyses = await db.content_analyses.findMany({
    where: { brand_id: brandId },
  }) as unknown as ContentAnalysis[]

  const total_pages = analyses.length
  const thin_pages = analyses.filter(a => a.thin_content_flag).length
  const low_readiness_pages = analyses.filter(a => a.ai_readiness_score < 60).length
  const no_structured_data_pages = analyses.filter(a => !a.structured_data_present).length
  const avg_ai_readiness_score = total_pages > 0
    ? analyses.reduce((sum, a) => sum + a.ai_readiness_score, 0) / total_pages
    : 0

  const pages_needing_improvement = analyses
    .filter(a => a.ai_readiness_score < 60)
    .sort((a, b) => a.ai_readiness_score - b.ai_readiness_score)
    .slice(0, 20)

  return {
    total_pages,
    thin_pages,
    low_readiness_pages,
    no_structured_data_pages,
    avg_ai_readiness_score,
    pages_needing_improvement,
  }
}

export async function getContentImprovements(brandId: string): Promise<Improvement[]> {
  const analyses = await db.content_analyses.findMany({
    where: { brand_id: brandId },
    select: { improvement_suggestions: true },
  }) as unknown as Array<{ improvement_suggestions: ImprovementSuggestion[] }>

  const countByType: Record<string, { suggestion: ImprovementSuggestion; count: number }> = {}

  for (const analysis of analyses) {
    const suggestions = Array.isArray(analysis.improvement_suggestions) ? analysis.improvement_suggestions : []
    for (const s of suggestions) {
      if (!countByType[s.type]) {
        countByType[s.type] = { suggestion: s, count: 0 }
      }
      countByType[s.type].count++
    }
  }

  const priorityOrder: Record<string, number> = { P1: 1, P2: 2, P3: 3 }

  return Object.entries(countByType)
    .map(([type, { suggestion, count }]) => ({
      type,
      priority: suggestion.priority,
      suggestion: suggestion.suggestion,
      affected_pages_count: count,
    }))
    .sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99))
}
