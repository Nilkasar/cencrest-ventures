# Project Plan — Cencrest Ventures

## What Cencrest Is

An AI Recommendation Intelligence firm. We run 1,400 buying questions through 4 AI models (ChatGPT, Gemini, Claude, Perplexity), map every citation to its source, and deliver a 120-page "Recommendation Intelligence Bible" showing exactly why competitors get recommended instead of you — and the 6 specific content moves to fix it.

**Positioning:** Instrument company. Evidence over opinion.
**Buyers:** B2B category leaders (logistics, fintech, cybersecurity etc.) who are losing AI-generated recommendations to competitors.

---

## The Product (What We Deliver)

### Engagement Tiers

| Tier | Price | What |
|------|-------|------|
| Diagnostic | $24,000 one-time | 1,400 prompt baseline, 4-model analysis, source mapping graph, executive presentation |
| Full Rebuild | $65,000 / 3-month | Full diagnostic + technical & content execution (HTML benchmarks, trade press placement) |
| Retained Intelligence | $12,000 / month | Weekly automated runs, competitor alerts, algorithm drift monitoring, quarterly board updates |

### The 8 Signals We Measure

1. Competitor Visibility — which names dominate AI answers
2. Prompt Coverage — how many buying questions you appear in
3. Source Websites — which domains write your category
4. Citation Patterns — the specific sentences models lift
5. Authority Signals — review volume, named experts, published data
6. Content Gaps — facts true about you but not retrievable by models
7. Website Defects — pages a crawler can't read (client-rendered, noindex, PDF-only)
8. Opportunities — ranked moves by effort/impact

### The 4-Phase Method

| Phase | Week | Output |
|-------|------|--------|
| Frame | Week 1 | Prompt Universe (2,000 buyer questions) |
| Measure | Week 2 | Visibility Matrix (4 models × 3 temp levels) |
| Trace | Week 3 | Retrieval Graph (citations → domain sources) |
| Rebuild | Week 4 | Diagnostic Bible (actionable content moves) |

---

## The Website — Current State

Single-page HTML/CSS/JS site. No framework. Deployed on Vercel.

**Sections live:**
- Hero with CTA
- "Now run it on you" interactive company input
- 4-model chorus grid (simulated)
- Marquee tape of signals
- Full-bleed photo band
- Source field canvas (340 nodes)
- 8 signals with data visualizations
- Method (4 phases)
- Artefact (deliverable preview)
- Firm identity
- Pricing tiers
- Research index (3 placeholder articles)
- Apply form (no backend yet)

---

## What Needs to Be Built

### Priority 1 — Make the site functional

- [ ] **Apply form backend** — wire form submissions to email or Airtable/Typeform. Currently fires a browser `alert()`.
- [ ] **Chorus section live data** — Section 03 shows AI model answers. Currently static. Needs real API calls or curated real examples.
- [ ] **Research index articles** — Section 10 has 3 placeholder entries. Need real published content at actual URLs.

### Priority 2 — Product infrastructure

- [ ] **Prompt runner** — internal tool to actually run 1,400 prompts across 4 models and record results. Core to delivering the product.
- [ ] **Citation parser** — extract and attribute source URLs from model responses.
- [ ] **Report generator** — produce the 120-page Diagnostic Bible from raw data.
- [ ] **Client dashboard** — optional, show clients their live visibility score over time.

### Priority 3 — Growth & distribution

- [ ] **Public research index** — publish real category benchmarks (logistics, fintech, etc.) to drive SEO and establish authority.
- [ ] **Trade press outreach** — place data-backed articles in vertical publications.
- [ ] **G2 presence** — Cencrest needs its own G2 listing to be citable by the same models it monitors.

### Priority 4 — Site polish

- [ ] Mobile audit — verify all sections on small screens
- [ ] Analytics — add Vercel Analytics or Plausible
- [ ] Performance — hero-film.js (18KB) and canvas animations on mobile need testing
- [ ] `design-bible.html` — currently a standalone page, not linked from nav; decide if it stays internal or goes public

---

## Tech Decisions Pending

| Decision | Options | Notes |
|----------|---------|-------|
| Apply form backend | Resend + Airtable / Typeform / custom API route | Simplest: Typeform embed or Airtable form |
| Chorus live data | Real API calls / curated static examples | Real calls add cost + latency; curated is safer for demo |
| Report format | PDF generation / Notion / custom HTML | 120-page report needs a template |
| Prompt runner infra | Python script / Vercel cron / dedicated service | Depends on scale and frequency |

---

## Design Constraints (from design-bible.html)

- Brand: Fraunces (display), Inter (sans), Spectral (serif), JetBrains Mono (labels)
- Palette: paper (#F7F3EC) · ink (#16140F) · ember (#C2410C) · slate (#4A4538)
- Tone: precise, evidentiary, never promotional
- Motion: purposeful, editorial — not flashy
- Identity: instrument company. Refuse wrong work. Method in the open.
