# SEO ENGINE — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

---

## PURPOSE

The BeBest SEO Engine provides complete search engine optimization intelligence and automation. It measures where a brand stands in traditional search, identifies high-value opportunities, generates recommendations, and eventually executes improvements.

This is ENGINE 1 of BeBest's two growth engines. It shares Brand Intelligence, Intent Intelligence, and the Opportunity Engine with ENGINE 2 (GEO).

---

## CAPABILITIES (Target State)

### Technical SEO Analysis
- Page crawling and analysis
- Title tag analysis (length, keyword presence, duplicate detection)
- Meta description analysis
- Heading structure (H1–H6 hierarchy, keyword relevance)
- Canonical tag analysis (missing, self-referencing, cross-domain)
- Robots.txt analysis
- Sitemap analysis (coverage, errors)
- Structured data / schema.org validation
- OpenGraph and Twitter card analysis
- Internal linking analysis
- Broken link detection
- Redirect chain analysis
- Duplicate content detection
- Thin content identification
- Core technical signals (HTTPS, mobile-friendly, page speed where available)

### Keyword Intelligence
- Query universe generation (from brand, competitors, categories, use cases)
- Keyword intent classification (informational, navigational, commercial, transactional)
- Topic clustering (group related keywords into themes)
- Search volume estimation (via abstracted provider — no paid API assumed)
- Keyword difficulty estimation (abstracted)
- Competitor keyword analysis (what keywords do competitors rank for?)
- Content gap analysis (keywords competitors rank for that customer does not)
- Current ranking analysis (where measurable without paid APIs)

### Content Analysis
- Page-level content quality scoring
- Entity coverage analysis (which entities does this page establish authority for?)
- Intent coverage per page (which buyer intents does this page serve?)
- Internal linking opportunities
- Thin content detection
- Duplicate content detection
- Content freshness analysis (last modified dates)

### Content Opportunity Engine
- Service page opportunities
- Product page opportunities
- Comparison page opportunities ("X vs Y")
- Use case page opportunities ("X for [industry]")
- FAQ page opportunities
- Educational content opportunities
- Location page opportunities
- Industry-specific page opportunities

### Measurement
- SEO health score (technical + content composite)
- Opportunity score (size × gap × effort)
- Progress tracking over time
- Change attribution (what changed vs. what improved)

---

## DATA SOURCES

BeBest does NOT assume access to paid SEO APIs.

All data sources are abstracted behind a `SEODataProvider` interface.

### Available Without Paid APIs
| Source | Data Available |
|---|---|
| Customer website (crawl) | All technical signals, content, structure |
| Competitor websites (crawl) | Same — limited by robots.txt |
| Google Search Console (customer-connected) | Rankings, clicks, impressions, queries |
| sitemap.xml | URL universe |
| robots.txt | Crawl instructions |
| schema.org markup | Structured data |
| OpenGraph / Twitter Cards | Social metadata |
| Bing Webmaster Tools (customer-connected) | Rankings (Bing) |

### Abstracted (Optional Paid Providers)
| Provider | Data |
|---|---|
| Semrush API | Keyword volume, difficulty, rankings |
| Ahrefs API | Backlinks, keywords, rankings |
| Moz API | Domain authority, keywords |
| DataForSEO | Keyword data, SERP data |
| Serper.dev | SERP results |
| ValueSERP | SERP results |

If no paid provider is configured, BeBest uses:
1. Customer-connected Search Console data (best)
2. AI-assisted keyword research (LLM estimates intent and volume — low confidence, labeled as estimate)
3. Manual keyword input by customer

---

## SEO PROVIDER ABSTRACTION

```typescript
interface SEODataProvider {
  name: string;
  
  // Keyword data
  getKeywordData(keywords: string[]): Promise<KeywordData[]>;
  
  // Competitor keywords
  getCompetitorKeywords(domain: string, limit?: number): Promise<KeywordData[]>;
  
  // Ranking data (if available)
  getRankings(domain: string, keywords: string[]): Promise<RankingData[]>;
}

interface KeywordData {
  keyword: string;
  intent: 'informational' | 'navigational' | 'commercial' | 'transactional';
  monthlyVolume: number | null;  // null if unavailable
  difficulty: number | null;     // 0-100 or null if unavailable
  confidence: 'high' | 'medium' | 'low' | 'estimate';
  source: string;                // which provider returned this
}
```

---

## SEO OPPORTUNITY SCORING

Every SEO opportunity is scored on two dimensions:

**Value** = `demand_score × (1 - current_coverage)` 

Where:
- `demand_score` = normalized search volume or estimated intent strength (0–100)
- `current_coverage` = how well the brand currently serves this intent (0–1)

**Effort** = `content_complexity × technical_difficulty` (0–100)

**Opportunity Score** = `(Value × 0.7 + Value/Effort × 0.3)` normalized to 0–100

This formula is version 1.0. It must be documented and versioned.

---

## INTENT GRAPH

Every SEO analysis builds an Intent Graph for the brand's category.

Example for "freight visibility software":

```
CATEGORY: Freight Visibility Software

Informational
├── "what is freight visibility" (vol: HIGH, coverage: 0%)
├── "how does freight tracking work" (vol: MED, coverage: 0%)
└── "AI in freight management" (vol: MED, coverage: 0%)

Problem-Aware
├── "improve freight visibility" (vol: HIGH, coverage: 0%)
└── "freight tracking problems" (vol: MED, coverage: 0%)

Commercial
├── "best freight visibility software" (vol: HIGH, coverage: 3%)
├── "freight visibility solutions" (vol: HIGH, coverage: 2%)
└── "managed freight visibility" (vol: MED, coverage: 0%)

Comparison
├── "freight visibility software comparison" (vol: MED, coverage: 0%)
├── "X vs Y freight visibility" (vol: LOW, coverage: 0%)
└── "freight visibility alternatives" (vol: LOW, coverage: 0%)

Transactional
├── "freight visibility pricing" (vol: MED, coverage: 0%)
└── "buy freight visibility software" (vol: LOW, coverage: 0%)
```

The intent graph drives:
- Content gap identification
- Priority ranking
- Content brief generation

---

## TECHNICAL SEO ANALYSIS RULES

### Page Analysis Checklist
```
Title tag:
  - [ ] Present
  - [ ] 50-60 characters
  - [ ] Contains primary keyword
  - [ ] Not duplicated across site
  
Meta description:
  - [ ] Present
  - [ ] 140-160 characters
  - [ ] Contains primary keyword
  - [ ] Contains CTA or value proposition
  
H1:
  - [ ] Exactly one per page
  - [ ] Contains primary keyword
  - [ ] Different from title tag
  
Heading hierarchy:
  - [ ] H2s exist
  - [ ] No skipped heading levels (H1 → H3 without H2)
  
Content:
  - [ ] Minimum 300 words (for non-index pages)
  - [ ] Primary keyword present (not stuffed)
  - [ ] Internal links to related pages
  - [ ] External links to authoritative sources
  
Schema:
  - [ ] Organization schema on homepage
  - [ ] FAQ schema on FAQ pages
  - [ ] Article schema on articles
  - [ ] Product/Service schema on service pages
  
Technical:
  - [ ] HTTPS
  - [ ] Canonical tag present and correct
  - [ ] Not noindexed accidentally
  - [ ] In sitemap
  - [ ] Accessible to crawlers (check robots.txt)
  - [ ] No broken internal links
  - [ ] Images have alt text
```

---

## SEO AGENT (See Epic 18)

The SEO Agent automates the SEO intelligence loop:

1. **Research** — crawl customer site, analyze competitors, build intent graph
2. **Identify** — find gaps, score opportunities
3. **Brief** — create content briefs for top opportunities
4. **Draft** — generate content drafts (with approval gate)
5. **Recommend** — technical improvement recommendations
6. **Measure** — track outcomes post-implementation

The agent runs on Ollama locally. Cloud AI providers optional.
