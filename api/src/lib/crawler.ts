import { load } from 'cheerio'
import robotsParser from 'robots-parser'
import { db } from './db.js'
import { validateDomain } from './meta-fetch.js'

const USER_AGENT = 'BeBestBot/1.0 (+https://bebestwith.ai)'
const MAX_PAGES = 500
const RATE_LIMIT_MS = 500 // 2 req/s

interface CrawlPage {
  url: string
  title: string | null
  metaDescription: string | null
  h1: string | null
  canonical: string | null
  statusCode: number
  wordCount: number
  loadMs: number
  internalLinks: number
  externalLinks: number
  schemaTypes: string[]
}

interface PageIssue {
  issueType: string
  severity: 'critical' | 'warning' | 'info'
  detail: string | null
}

function detectIssues(page: CrawlPage, origin: string): PageIssue[] {
  const issues: PageIssue[] = []

  if (!page.title) issues.push({ issueType: 'missing_title', severity: 'critical', detail: null })
  else if (page.title.length > 60) issues.push({ issueType: 'title_too_long', severity: 'warning', detail: `${page.title.length} chars` })

  if (!page.metaDescription) issues.push({ issueType: 'missing_meta', severity: 'warning', detail: null })
  else if (page.metaDescription.length > 160) issues.push({ issueType: 'meta_too_long', severity: 'info', detail: `${page.metaDescription.length} chars` })

  if (!page.h1) issues.push({ issueType: 'missing_h1', severity: 'warning', detail: null })
  if (!page.canonical) issues.push({ issueType: 'missing_canonical', severity: 'info', detail: null })
  if (page.wordCount < 300) issues.push({ issueType: 'thin_content', severity: 'info', detail: `${page.wordCount} words` })

  return issues
}

function parsePage(html: string, url: string, statusCode: number, loadMs: number): CrawlPage {
  const $ = load(html)
  const origin = new URL(url).origin

  const title = $('title').first().text().trim() || null
  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null
  const h1 = $('h1').first().text().trim() || null
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || null
  const noindex = $('meta[name="robots"]').attr('content')?.toLowerCase().includes('noindex') ?? false

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const wordCount = bodyText ? bodyText.split(' ').filter(Boolean).length : 0

  const schemaTypes: string[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? '{}')
      const type = data['@type']
      if (typeof type === 'string') schemaTypes.push(type)
      else if (Array.isArray(type)) schemaTypes.push(...type)
    } catch { /* ignore malformed JSON-LD */ }
  })

  let internalLinks = 0
  let externalLinks = 0
  const hrefs: string[] = []

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    try {
      const abs = new URL(href, url)
      if (abs.origin === origin) { internalLinks++; hrefs.push(abs.href) }
      else externalLinks++
    } catch { /* ignore bad hrefs */ }
  })

  return {
    url, title, metaDescription, h1, canonical, statusCode,
    wordCount, loadMs, internalLinks, externalLinks, schemaTypes,
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function runCrawl(crawlJobId: string, brandId: string, startUrl: string): Promise<void> {
  await db.crawl_jobs.update({
    where: { id: crawlJobId },
    data: { status: 'running', started_at: new Date() },
  })

  try {
    const origin = new URL(startUrl).origin
    let robotsRules: ReturnType<typeof robotsParser> | null = null

    try {
      const robotsRes = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      })
      if (robotsRes.ok) {
        const text = await robotsRes.text()
        robotsRules = robotsParser(`${origin}/robots.txt`, text)
      }
    } catch { /* no robots.txt, crawl freely */ }

    const visited = new Set<string>()
    const queue: string[] = [startUrl]
    let pagesFound = 0

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const url = queue.shift()!
      const normalized = url.split('?')[0].split('#')[0]
      if (visited.has(normalized)) continue

      if (robotsRules && !robotsRules.isAllowed(normalized, USER_AGENT)) continue

      visited.add(normalized)
      pagesFound++

      const start = Date.now()
      let html = ''
      let statusCode = 0
      try {
        const res = await fetch(normalized, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000),
          redirect: 'follow',
        })
        statusCode = res.status
        const ct = res.headers.get('content-type') ?? ''
        if (ct.includes('text/html')) html = await res.text()
      } catch {
        statusCode = 0
      }
      const loadMs = Date.now() - start

      if (!html) {
        await sleep(RATE_LIMIT_MS)
        continue
      }

      const pageData = parsePage(html, normalized, statusCode, loadMs)
      const issues = detectIssues(pageData, origin)

      const page = await db.pages.create({
        data: {
          crawl_job_id: crawlJobId,
          brand_id: brandId,
          url: pageData.url,
          title: pageData.title,
          meta_description: pageData.metaDescription,
          h1: pageData.h1,
          canonical: pageData.canonical,
          status_code: pageData.statusCode,
          word_count: pageData.wordCount,
          load_ms: pageData.loadMs,
          internal_links: pageData.internalLinks,
          external_links: pageData.externalLinks,
          schema_types: pageData.schemaTypes,
        },
      })

      if (issues.length > 0) {
        await db.page_issues.createMany({
          data: issues.map((i) => ({
            page_id: page.id,
            issue_type: i.issueType as never,
            severity: i.severity as never,
            detail: i.detail,
          })),
        })
      }

      // discover internal links to queue
      const $ = load(html)
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')?.trim()
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
        try {
          const abs = new URL(href, normalized)
          const clean = abs.href.split('?')[0].split('#')[0]
          if (abs.origin === origin && !visited.has(clean) && !queue.includes(clean)) {
            queue.push(clean)
          }
        } catch { /* ignore bad hrefs */ }
      })

      await db.crawl_jobs.update({
        where: { id: crawlJobId },
        data: { pages_crawled: visited.size, pages_found: pagesFound, updated_at: new Date() },
      })

      await sleep(RATE_LIMIT_MS)
    }

    await db.crawl_jobs.update({
      where: { id: crawlJobId },
      data: { status: 'completed', completed_at: new Date(), pages_crawled: visited.size, pages_found: pagesFound },
    })
  } catch (err) {
    await db.crawl_jobs.update({
      where: { id: crawlJobId },
      data: { status: 'failed', completed_at: new Date(), error_message: String(err) },
    })
  }
}
