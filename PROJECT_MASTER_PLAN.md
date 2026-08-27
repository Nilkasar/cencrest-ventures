# PROJECT MASTER PLAN — BeBest

**Version**: 1.0  
**Date**: 2026-08-11  
**Status**: DOCUMENTATION PHASE  
**Classification**: INTERNAL

---

## 1. COMPANY OVERVIEW

**Company**: BeBest  
**Website**: https://bebestwithai.com  
**Tagline**: "Become the Brand AI Recommends."  
**Email**: hello@bebestwithai.com  
**Repository**: Cencrest-ventures (GitHub: Nilkasar/cencrest-ventures)  
**Deployment**: Vercel (project: cencrest, org: team_g3nli6KRgXRnCg5VyS5iNsWM)

---

## 2. CURRENT PRODUCT STATE

### What Exists Today
- 14-page pure HTML/CSS/JS marketing website
- Sophisticated scroll-driven canvas animations (hero-film, source-field, clouds)
- Design system with proprietary tokens, typography, spacing
- Structured data / schema markup
- Strategic robots.txt (AI crawlers allowed)
- Sitemap (14 URLs)
- Local AI config: Ollama / Qwen3 8B via opencode.json

### What Does NOT Exist Today
- No backend (form submissions fire `alert()`)
- No database
- No prompt runner (core product capability)
- No report generation
- No citation parsing
- No client portal
- No analytics
- No authentication
- No billing
- No CRM
- No AI API integrations
- No tests

### Current Readiness
| Layer | Readiness |
|---|---|
| Marketing site | 95% |
| Product infrastructure | 0% |
| Backend / API | 0% |
| Database | 0% |
| AI engine | 0% |
| Billing | 0% |
| CRM | 0% |
| Analytics | 0% |

---

## 3. LONG-TERM VISION

BeBest is NOT a dashboard. BeBest is an **AI + SEO Growth Autopilot**.

The customer should eventually provide only:
> "Here is my website. Here is what my business does. Here is who I want to reach."

And BeBest handles:
- Research
- SEO audit and optimization
- GEO / AI visibility audit and optimization
- Competitor intelligence
- Content opportunity discovery
- Recommendations
- Content generation (with approval)
- Execution (with approval)
- Measurement
- Continuous improvement

### Core Product Loop

```
OBSERVE → UNDERSTAND → MEASURE → DIAGNOSE → IDENTIFY OPPORTUNITY
    ↑                                                    ↓
 LEARN                                            RECOMMEND
    ↑                                                    ↓
 IMPROVE ← RE-MEASURE ← EXECUTE ← APPROVE ← GENERATE
```

---

## 4. PRODUCT PRINCIPLES

1. **Evidence over claims** — Every score, insight, and recommendation must be traceable to raw data.
2. **Customer value over feature count** — Ship fewer things that work, not more things that don't.
3. **Production quality over demo quality** — Never ship something that looks correct but isn't.
4. **Human control before autonomy** — Earn trust through recommendations before earning execution rights.
5. **Determinism over LLM opinion** — LLMs extract observations; formulas compute scores.
6. **Security by default** — All external input is untrusted. All tenant data is isolated.
7. **Simple until complex is justified** — No premature infrastructure.
8. **Local-first development** — Ollama + Qwen3 8B must support full development cycle.

---

## 5. TWO GROWTH ENGINES

### Engine 1: SEO Growth Engine
Tracks, analyzes, and improves traditional search engine visibility.

### Engine 2: GEO / AI Growth Engine
Tracks, analyzes, and improves AI assistant recommendation visibility.

Both engines share:
- Brand Intelligence
- Entity Intelligence
- Intent Intelligence
- Competitor Intelligence
- Content Intelligence
- Measurement
- Opportunity Engine

---

## 6. BUSINESS MODEL

### Revenue Tiers

| Tier | Price | Customer | Core Value |
|---|---|---|---|
| Free Snapshot | $0 | Marketing leaders wanting to understand their AI visibility | Sample AI Visibility Score + gaps |
| Starter | TBD | SMBs needing basic monitoring | Ongoing AI visibility tracking |
| Growth | TBD | Growing B2B companies | Full SEO + GEO intelligence |
| Pro | TBD | Category leaders | AI Growth Autopilot |
| Agency | TBD | Marketing/SEO agencies | Multi-client + white-label |
| Managed | TBD | Enterprise | Human + AI hybrid service |
| Enterprise | Custom | Large organizations | Custom SLAs and integrations |

*Exact prices are UNDECIDED. Do not hard-code.*

### Revenue Mechanics
- Free tier → trial conversion
- Self-serve subscriptions
- Agency white-label subscriptions
- Usage-based components (AI query volume)
- Managed service (human + tool)

### Key Metrics to Track
- MRR / ARR
- CAC / LTV
- Free → Paid conversion rate
- Trial → Customer conversion rate
- Churn rate
- Retention rate
- Expansion revenue
- Gross margin
- AI query usage
- Customer ROI (measurable SEO + GEO improvement)

---

## 7. COMPETITIVE LANDSCAPE

### Studied Products
- **RankAI** — autonomous SEO/AEO execution engine, YC-backed, strong social proof
- **Profound** — AI answer monitoring
- **Otterly** — AI visibility tracking
- **Peec** — AI brand monitoring
- **Scrunch** — AI content intelligence
- **Semrush** — Full-suite SEO platform
- **Ahrefs** — SEO intelligence platform

### BeBest Differentiation
BeBest does NOT simply track visibility. BeBest:
1. Measures AI visibility AND SEO demand together
2. Traces citations to source domains
3. Scores AI trust signals and content gaps
4. Identifies the UNIFIED opportunity (SEO demand + GEO gap = HIGH VALUE)
5. Generates evidence-backed recommendations
6. Offers a complete growth loop (not just a score)

### Gap Analysis vs. RankAI
| Capability | RankAI | BeBest Target |
|---|---|---|
| AI visibility tracking | AEO-focused | Full GEO intelligence |
| SEO intelligence | Basic | Full SEO engine |
| Citation source mapping | No | Yes |
| Evidence-backed recommendations | No | Yes |
| Unified SEO+GEO opportunity | No | Yes |
| Autonomous execution | Yes | Eventually (with approval gates) |
| Transparent pricing | No | Yes |
| Agency white-label | Yes | Planned |
| Investor backing visible | YC/a16z | N/A |
| Client case studies | 3 detailed | 0 currently |

**Current BeBest Gaps** (must close):
- No client logos / social proof
- No case study with named metric
- No interactive lead magnet (ROI calculator)
- No product screenshots of real dashboard
- No agency track

---

## 8. DOCUMENTATION MAP

See `/docs/` for all detailed documentation.

| Directory | Contents |
|---|---|
| `/docs/00-company` | Company identity, positioning, values |
| `/docs/01-product` | Product vision, principles, features |
| `/docs/02-market` | Market analysis, competitive landscape |
| `/docs/03-research` | Research findings, customer intelligence |
| `/docs/04-requirements` | Functional and non-functional requirements |
| `/docs/05-architecture` | System architecture, technology decisions |
| `/docs/06-database` | Schema, entities, relationships |
| `/docs/07-api` | API design, endpoints, contracts |
| `/docs/08-security` | Security architecture, threat model |
| `/docs/09-ux` | UX flows, wireframes, component specs |
| `/docs/10-seo` | SEO engine design |
| `/docs/11-geo` | GEO engine design |
| `/docs/12-ai` | AI provider abstraction, model strategy |
| `/docs/13-agents` | Agent architecture and specifications |
| `/docs/14-content` | Content intelligence and generation |
| `/docs/15-automation` | Automation workflows |
| `/docs/16-billing` | Billing architecture |
| `/docs/17-crm` | CRM design |
| `/docs/18-growth` | Growth strategy |
| `/docs/19-testing` | Testing strategy and requirements |
| `/docs/20-operations` | Operations, deployment, monitoring |
| `/docs/21-agency` | Agency / multi-client model |
| `/docs/22-integrations` | External integrations |
| `/docs/23-decisions` | Architecture decision records (ADRs) |
| `/docs/24-releases` | Release notes and changelogs |

---

## 9. EPIC SEQUENCE

See `EPICS.md` for full epic specifications.

| Epic | Title | Status |
|---|---|---|
| 0 | Repository Audit & Product Specification | COMPLETE |
| 1 | Platform Foundation | PLANNED |
| 2 | Organizations / Users / RBAC | PLANNED |
| 3 | Authentication / Security | PLANNED |
| 4 | Brand Intelligence | PLANNED |
| 5 | Website Intelligence | PLANNED |
| 6 | SEO Intelligence | PLANNED |
| 7 | Intent & Query Intelligence | PLANNED |
| 8 | AI Provider Abstraction | PLANNED |
| 9 | AI Visibility Engine | PLANNED |
| 10 | AI Response Intelligence | PLANNED |
| 11 | Competitive Intelligence | PLANNED |
| 12 | Unified SEO + GEO Opportunity Engine | PLANNED |
| 13 | GEO Gap Engine | PLANNED |
| 14 | Recommendation Engine | PLANNED |
| 15 | Content Intelligence | PLANNED |
| 16 | Content Generation | PLANNED |
| 17 | GEO Agent | PLANNED |
| 18 | SEO Agent | PLANNED |
| 19 | Unified Growth Agent | PLANNED |
| 20 | Action Center | PLANNED |
| 21 | Controlled Publishing | PLANNED |
| 22 | Measurement & Experimentation | PLANNED |
| 23 | Continuous Learning Loop | PLANNED |
| 24 | Reporting | PLANNED |
| 25 | Notifications | PLANNED |
| 26 | Billing | PLANNED |
| 27 | CRM | PLANNED |
| 28 | Free AI + SEO Snapshot | PLANNED |
| 29 | Customer Success Automation | PLANNED |
| 30 | Agency / Multi-client | PLANNED |
| 31 | White Label | PLANNED |
| 32 | Integrations | PLANNED |
| 33 | Marketing / Growth Engine | PLANNED |
| 34 | Entrepreneur Story Ecosystem | PLANNED |
| 35 | Autonomous Operations | PLANNED |
| 36 | Production Hardening | PLANNED |

---

## 10. IMPLEMENTATION SEQUENCE

### Phase 0 — Documentation (CURRENT)
Audit, plan, document. No code.

### Phase 1 — Foundation (Epics 1–3)
Backend runtime, database, auth, multi-tenancy. Nothing visible to customers yet.

### Phase 2 — Intelligence Baseline (Epics 4–8)
Brand intelligence, website crawling, SEO baseline, AI provider abstraction. Internal tooling.

### Phase 3 — AI Visibility MVP (Epics 9–11)
Run real AI queries, extract brand mentions, score, store evidence. First real product.

### Phase 4 — Opportunity Engine (Epics 12–14)
Unified SEO+GEO gap detection, opportunity scoring, recommendations. Core differentiator.

### Phase 5 — Free Snapshot (Epic 28)
Customer-facing free report. Acquisition engine. First public product.

### Phase 6 — Content & Agents (Epics 15–19)
Content intelligence, generation, SEO Agent, GEO Agent, Growth Agent.

### Phase 7 — Action & Measurement (Epics 20–23)
Action center, controlled publishing, experimentation, learning loop.

### Phase 8 — Platform (Epics 24–27)
Reporting, notifications, billing, CRM.

### Phase 9 — Growth (Epics 28–34)
Agency model, white-label, integrations, marketing engine, entrepreneur ecosystem.

### Phase 10 — Autonomous Operations (Epics 35–36)
Full autonomy levels, production hardening.

---

## 11. TECHNOLOGY DECISIONS

### Current Stack
- Frontend: Pure HTML/CSS/JS (no framework)
- Hosting: Vercel (JAMstack)
- Domain: bebestwithai.com

### Target Stack (DECIDED)
- Backend runtime: Node.js (Vercel Functions) or Python (FastAPI) — UNDECIDED
- Database: PostgreSQL
- Local AI: Ollama (Qwen3 8B, Qwen2.5-Coder 7B)
- Cloud AI: Abstracted (OpenAI, Anthropic, Google, Perplexity — via provider layer)
- Queue: UNDECIDED (Vercel Queues or simple job table)
- Cache: UNDECIDED

### Non-Negotiable Constraints
- AI providers MUST be abstracted — no direct dependency on any single vendor
- Local Ollama development MUST remain possible without cloud API keys
- PostgreSQL for all persistent data
- Multi-tenant from day one — no retrofitting tenant isolation later
- All external input (customer websites, AI responses) is UNTRUSTED

---

## 12. RISK REGISTER

See `RISK_REGISTER.md` for full register.

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Core product (prompt runner) takes months to build | HIGH | HIGH | Start with simple curated static examples; build real infrastructure in parallel |
| AI providers change APIs or pricing | HIGH | MEDIUM | Provider abstraction layer |
| AI responses change over time (model updates) | HIGH | MEDIUM | Version every prompt and scoring formula |
| No customers before product is built | HIGH | HIGH | Free Snapshot drives acquisition before full product ready |
| Marketing site outpaces product | CURRENT | MEDIUM | Keep marketing site live; build product in separate infra |
| Canvas animations break on new browsers/devices | MEDIUM | LOW | Test matrix, reduced-motion fallback |
| Form submissions currently lost | CURRENT | HIGH | Wire apply form to email/Airtable immediately (Epic 1) |

---

## 13. OPEN DECISIONS

See `DECISIONS.md` for full ADR log.

| Decision | Options | Deadline | Owner |
|---|---|---|---|
| Backend language | Node.js vs Python | Before Epic 1 | UNKNOWN |
| Backend framework | Express vs Hono vs FastAPI | Before Epic 1 | UNKNOWN |
| Frontend framework | Keep static vs adopt React/Next | Before Epic 5 | UNKNOWN |
| Form backend | Resend + Airtable vs Typeform vs custom | URGENT | UNKNOWN |
| Queue system | Vercel Queues vs pg-based job table | Before Epic 9 | UNKNOWN |
| Cache layer | Redis vs in-memory vs skip | Before Epic 9 | UNKNOWN |
| Analytics | Vercel Analytics vs Plausible vs PostHog | Before Epic 1 | UNKNOWN |
| Payment provider | Stripe vs Paddle vs Lemon Squeezy | Before Epic 26 | UNKNOWN |

---

## 14. QUALITY GATES

An epic is NOT complete until:

- [ ] All acceptance criteria verified
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing
- [ ] Security review completed
- [ ] Performance requirements met
- [ ] Documentation updated
- [ ] Accessibility reviewed
- [ ] PROJECT_STATUS.md updated
- [ ] No critical open bugs
- [ ] Manual walkthrough recorded

---

## 15. NEXT IMMEDIATE ACTION

**Before any implementation begins:**

1. Review this documentation
2. Approve or amend product decisions
3. Decide: backend language, framework, form backend
4. Wire apply form (currently losing all leads)
5. Begin Epic 1: Platform Foundation

**STOP. DO NOT CODE UNTIL THIS DOCUMENT IS REVIEWED AND APPROVED.**
