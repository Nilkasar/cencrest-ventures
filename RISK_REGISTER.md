# RISK REGISTER — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

Format: Risk | Probability | Impact | Status | Mitigation | Owner

---

## CRITICAL RISKS

| # | Risk | Probability | Impact | Status | Mitigation |
|---|---|---|---|---|---|
| R01 | Apply form submissions are currently lost (fires alert(), no backend) | CONFIRMED | HIGH | ACTIVE | Wire to email/Airtable before any paid promotion |
| R02 | Core product (prompt runner, scoring) does not yet exist | CONFIRMED | HIGH | ACTIVE | Bridge with manual service delivery while building; set accurate delivery timelines |
| R03 | No revenue without product | CONFIRMED | HIGH | ACTIVE | Manual service bridge; Snapshot as lead-gen tool once form backend exists |
| R04 | Team capacity unknown | UNKNOWN | HIGH | OPEN | Confirm who is building what before committing to Phase 1 timeline |

---

## HIGH RISKS

| # | Risk | Probability | Impact | Status | Mitigation |
|---|---|---|---|---|---|
| R05 | AI providers change API pricing, make responses unpredictable, or block automated queries | HIGH | HIGH | MONITORING | Provider abstraction layer; cache results; use Ollama for development; diversify providers |
| R06 | AI models change behavior (model updates alter brand mention patterns) | HIGH | HIGH | DESIGN | Store every response with model + version; score formula versioning; re-run on model updates |
| R07 | SSRF vulnerability in website crawler could expose internal infrastructure | HIGH | HIGH | DESIGN | Strict SSRF blocklist in design; validate every URL before crawl |
| R08 | Multi-tenant isolation failure exposes one customer's data to another | MEDIUM | CRITICAL | DESIGN | PostgreSQL RLS + application-layer validation; explicit test in quality gate |
| R09 | Prompt injection from customer website content manipulates agent behavior | MEDIUM | HIGH | DESIGN | Treat all crawled content as data, never as instructions; sanitize before any AI call |
| R10 | Marketing site outpaces product — customers expect a product that doesn't exist | CURRENT | HIGH | ACTIVE | Do not run paid ads until Free Snapshot pipeline is live; be honest in sales |

---

## MEDIUM RISKS

| # | Risk | Probability | Impact | Status | Mitigation |
|---|---|---|---|---|---|
| R11 | Canvas animations perform poorly on mobile devices | MEDIUM | MEDIUM | MONITORING | Test on mobile; add prefers-reduced-motion guards; lazy-load/disable on low-end devices |
| R12 | Competitor enters market with similar offering and better funding | MEDIUM | HIGH | MONITORING | Move fast on differentiation (unified SEO+GEO opportunity engine); build moats via customer data |
| R13 | Search Console / Bing data unavailable (customer doesn't connect accounts) | HIGH | MEDIUM | DESIGN | Design SEO engine to work without paid APIs; use AI-estimated keyword data with labeled confidence |
| R14 | Customer website crawl blocked by robots.txt | HIGH | LOW | DESIGN | Respect robots.txt; document clearly that some analysis is unavailable if blocked |
| R15 | Billing provider (Stripe) down at renewal time | LOW | HIGH | DESIGN | Grace period + email fallback; retry logic; offline invoice support |
| R16 | Incorrect scores reported to customer (formula bug) | MEDIUM | HIGH | DESIGN | All formula changes version-bumped; unit tests; customer can request re-run |
| R17 | AI content generation produces factually incorrect content | HIGH | HIGH | DESIGN | Mandatory human approval before any content is published; fact-check step in pipeline |
| R18 | Legal: running automated queries against AI providers may violate ToS | UNKNOWN | HIGH | OPEN | Legal review of OpenAI, Anthropic, Google, Perplexity ToS before launch; design for compliance |
| R19 | GDPR/privacy: storing AI responses that may contain personal data | MEDIUM | HIGH | DESIGN | Data minimization; privacy policy; DPA with relevant parties; data retention policy |

---

## LOW RISKS

| # | Risk | Probability | Impact | Status | Mitigation |
|---|---|---|---|---|---|
| R20 | Domain bebestwithai.com expires | LOW | HIGH | MONITORING | Set auto-renew; calendar reminder 90 days before expiry |
| R21 | Vercel free tier limits reached | MEDIUM | LOW | MONITORING | Upgrade Vercel plan as traffic grows; backend not on Vercel free tier |
| R22 | Shared CSS file grows unmanageable (currently 65K) | LOW | LOW | DEFERRED | Consider CSS modules or Tailwind when introducing frontend framework |
| R23 | Hero canvas animation is not accessible | CONFIRMED | LOW | DEFERRED | Add prefers-reduced-motion; add aria-hidden; add text alternative |
| R24 | Customer deletes brand profile — cannot recover | DESIGN | MEDIUM | DESIGN | Soft delete pattern; 30-day recovery window; admin recovery tool |

---

## OPEN DECISIONS THAT AFFECT RISK

| # | Decision | Risk if Wrong |
|---|---|---|
| D01 | Backend language (Node vs Python) | Affects all Phase 1+ timelines |
| D02 | Frontend framework (static vs React/Next) | Affects customer portal UX quality |
| D03 | Queue system (Vercel Queues vs pg job table) | Affects AI runner reliability |
| D04 | Auth provider (custom vs Clerk vs Supabase) | Affects Phase 3 timeline and security posture |
| D05 | Legal review of AI provider ToS for automated queries | Affects Phase 3 launch |

---

## RISK REVIEW CADENCE

- Weekly: Review R01–R04 (critical/active)
- Monthly: Full register review
- Per-epic: Identify new risks before starting implementation
- Post-incident: Add new risks discovered in production
