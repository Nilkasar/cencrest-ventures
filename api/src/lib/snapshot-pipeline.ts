import { db } from './db.js'
import { validateDomain, fetchSiteMeta } from './meta-fetch.js'
import { buildProvider } from './ai-provider.js'
import { extractMentions } from './analysis-pipeline.js'

function guessCategory(siteName: string | null, description: string | null): string {
  const text = `${siteName ?? ''} ${description ?? ''}`.toLowerCase()
  if (/shop|store|ecommerce|e-commerce|retail/.test(text)) return 'ecommerce'
  if (/saas|software|platform|app|tool/.test(text)) return 'software'
  if (/agency|marketing|design|creative/.test(text)) return 'agency'
  if (/health|medical|wellness|clinic/.test(text)) return 'healthcare'
  if (/finance|fintech|banking|invest/.test(text)) return 'finance'
  if (/edu|learning|course|training/.test(text)) return 'education'
  return 'technology'
}

function buildQueries(domain: string, siteName: string | null, description: string | null): string[] {
  const name = siteName ?? domain
  const category = guessCategory(siteName, description)
  return [
    `What is ${name}?`,
    `Who are the best ${category} companies?`,
    `Recommend ${category} tools for businesses`,
    `What are the top ${category} platforms in 2024?`,
    `Compare ${name} with competitors`,
    `Best alternatives to ${name}`,
    `Which ${category} solution should I use?`,
    `What are the leading ${category} providers?`,
    `How does ${name} compare to industry leaders?`,
    `What do experts recommend for ${category}?`,
  ]
}

export async function runSnapshot(snapshotId: string): Promise<void> {
  try {
    const snapshot = await db.snapshot_requests.findUnique({ where: { id: snapshotId } })
    if (!snapshot) throw new Error('Snapshot not found')

    await db.snapshot_requests.update({
      where: { id: snapshotId },
      data: { status: 'processing', updated_at: new Date() },
    })

    const domain = validateDomain(snapshot.domain)
    if (!domain) throw new Error('Domain is no longer valid or is private')

    const meta = await fetchSiteMeta(domain)
    const siteName = meta.name
    const description = meta.description

    const queries = buildQueries(domain, siteName, description)

    const provider = buildProvider('ollama', 'llama3.1:8b', null)

    const responses: Array<{ query: string; text: string | null }> = []

    for (const query of queries) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10000)
        let text: string | null = null
        try {
          const result = await provider.complete(query)
          text = result.text
        } finally {
          clearTimeout(timer)
        }
        responses.push({ query, text })
      } catch {
        responses.push({ query, text: null })
      }
    }

    const validResponses = responses.filter((r) => r.text !== null)
    const totalResponses = validResponses.length

    // Extract mentions and find competitors
    const brandName = siteName ?? domain
    const topCompetitorSet = new Set<string>()
    let mentionCount = 0
    const gaps: Array<{ type: string; description: string }> = []

    const contentGapQueries: string[] = []
    const citationGapQueries: string[] = []

    for (const r of validResponses) {
      if (!r.text) continue

      const mentions = extractMentions(
        r.text,
        { name: brandName, aliases: [] },
        [],
      )

      const brandMentions = mentions.filter((m) => m.entity_type === 'brand')
      const hasMention = brandMentions.some((m) => m.mention_count > 0)

      if (hasMention) {
        mentionCount++
      } else {
        contentGapQueries.push(r.query)
      }

      // Look for competitor mentions — any capitalized word groups not matching the brand
      const competitorPattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/g
      let match: RegExpExecArray | null
      while ((match = competitorPattern.exec(r.text)) !== null) {
        const candidate = match[1]
        if (
          candidate !== brandName &&
          candidate.length > 2 &&
          !['The', 'This', 'That', 'These', 'Those', 'When', 'What', 'Which', 'How'].includes(candidate)
        ) {
          topCompetitorSet.add(candidate)
        }
      }

      // Citation gap: no URL in the response that includes the domain
      if (!r.text.includes(domain)) {
        citationGapQueries.push(r.query)
      }
    }

    if (contentGapQueries.length > 0) {
      gaps.push({
        type: 'content gap',
        description: `${brandName} was not mentioned in ${contentGapQueries.length} of ${totalResponses} AI responses. Consider creating content that answers: ${contentGapQueries.slice(0, 2).join('; ')}`,
      })
    }

    if (topCompetitorSet.size > 0) {
      gaps.push({
        type: 'competitor gap',
        description: `Competitors appear in AI responses where ${brandName} is absent. Strengthen positioning against: ${[...topCompetitorSet].slice(0, 3).join(', ')}`,
      })
    }

    if (citationGapQueries.length > 0) {
      gaps.push({
        type: 'citation gap',
        description: `AI responses lack citations to ${domain} in ${citationGapQueries.length} of ${totalResponses} responses. Build authoritative content that earns links.`,
      })
    }

    const score = totalResponses > 0 ? (mentionCount / totalResponses) * 100 : 0

    const topCompetitors = [...topCompetitorSet].slice(0, 10)

    const result_json = {
      domain,
      siteName,
      score: Math.round(score * 10) / 10,
      totalQueries: queries.length,
      mentionCount,
      gaps: gaps.slice(0, 3),
      topCompetitors,
      generatedAt: new Date().toISOString(),
    }

    await db.snapshot_requests.update({
      where: { id: snapshotId },
      data: {
        status: 'complete',
        result_json,
        updated_at: new Date(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.snapshot_requests.update({
      where: { id: snapshotId },
      data: {
        status: 'failed',
        result_json: { error: message },
        updated_at: new Date(),
      },
    }).catch(() => {/* best-effort */})
  }
}
