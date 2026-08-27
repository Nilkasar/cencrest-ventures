# CUSTOMER JOURNEY — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

---

## OVERVIEW

The customer journey moves from awareness → acquisition → activation → value → retention → expansion. Every screen and feature must serve a specific stage of this journey.

---

## STAGE 1: AWARENESS

**How customers discover BeBest:**
- Search: "how to improve AI visibility" / "GEO optimization" / "why isn't my brand recommended by ChatGPT"
- AI search: asking AI assistants about AI brand visibility
- Content: founder articles, research studies
- Referral: customer sharing their results
- Outreach: founder-led sales

**What they see:**
- Marketing site (bebestwithai.com)
- Research articles
- Founder content

**Goal of this stage:** Create the "aha — this is the problem I have" moment.

---

## STAGE 2: ACQUISITION — FREE SNAPSHOT

**Trigger:** Visitor decides to try BeBest.

**Entry points:**
- "Get Free Snapshot" CTA in navigation
- "Get Free Snapshot" button in hero section
- Apply form at bottom of page

**Flow:**

```
1. Visitor clicks CTA
2. Shown: simple form
   - Name
   - Work email
   - Company name
   - Website URL
   - Industry/category (optional)
   - Biggest competitor (optional)

3. Submits form
4. Confirmation screen: "Your snapshot is being prepared. We'll email you within 24 hours."

5. Behind the scenes:
   a. Lead created in CRM
   b. Website crawl initiated
   c. Sample AI queries run (20-50 queries × 4 models)
   d. Basic SEO analysis run
   e. Report generated

6. Email: "Your AI Visibility Snapshot is ready" + link to web report

7. Report shows:
   - AI Visibility Score (sample run)
   - 3 competitors identified
   - Where competitors appear vs. where you appear
   - Top 3 content gaps
   - Top 3 recommendations
   - CTA: "See your full analysis — book a call or sign up"
```

**Goal:** Convert visitor into lead. Convert lead into interested prospect.

**Metrics:**
- Form completion rate
- Snapshot delivery rate
- Snapshot open rate
- Conversion rate (snapshot → call / signup)

---

## STAGE 3: ACTIVATION — ONBOARDING

**Entry:** Customer signs up (trial or paid).

**Onboarding flow:**

```
Step 1: Welcome screen
  "Let's get your AI Visibility Baseline. This takes about 20 minutes."
  
Step 2: Brand setup
  - Confirm company name, website
  - Add up to 5 competitors
  - Select primary industry/category
  - Add 3-5 key use cases ("who uses your product and why?")
  - Add known brand claims ("our differentiator is X")
  
Step 3: AI Visibility Baseline kicks off (background)
  - Generate query universe for category
  - Run full query set across 4 models
  - Extract and score all observations
  - (May take 30-60 minutes)
  - Customer can leave and receive email when complete

Step 4: Website analysis kicks off (background)
  - Crawl and analyze customer website
  - Technical SEO analysis
  - Content analysis
  - (May take 10-15 minutes)

Step 5: Baseline ready notification (email + in-app)
  "Your baseline is ready. Your AI Visibility Score is 32/100."
  
Step 6: Baseline report shown
  - AI Visibility Score with model breakdown
  - Top 3 competitors and their scores
  - Top 10 gaps identified (SEO + GEO combined)
  - First 3 recommendations
  - CTA: "See all opportunities"
```

**Goal:** Get customer to "first value moment" — seeing their real score and feeling the urgency to fix it.

---

## STAGE 4: VALUE — ONGOING USE

**Customer portal structure:**

### Overview Dashboard
- AI Visibility Score (with trend)
- SEO Health Score (with trend)
- Active opportunities count
- Recent actions
- Next recommended action

### AI Visibility (GEO)
- Score breakdown by model
- Score breakdown by intent
- Response explorer (browse raw AI responses)
- Citation source map
- Sentiment analysis

### SEO Intelligence
- Technical health score
- Keyword coverage
- Content gaps
- Internal link opportunities
- Page-level analysis

### Competitors
- Competitor AI Visibility Scores
- Share of AI voice
- Competitor content analysis
- Movement alerts

### Opportunities
- Unified opportunity list (SEO + GEO)
- Filtered by: effort, impact, type
- Each opportunity shows evidence
- Status: open / in progress / complete / dismissed

### Actions
- Pending approvals
- In-progress actions
- Completed actions (with outcome)
- Rolled-back actions

### Content
- Active content briefs
- Drafts awaiting approval
- Published content
- Content performance (where measurable)

### Reports
- Weekly digest (automated)
- Monthly performance report (automated)
- Custom reports (manual trigger)
- Baseline comparison report (quarterly)

### Settings
- Brand profile
- Competitors
- Integrations (Search Console, CMS)
- Team members
- Notifications
- Billing
- Autonomy level settings

---

## STAGE 5: RETENTION — CONTINUOUS VALUE

**What keeps customers:**
- Measurable improvement in AI Visibility Score over time
- Competitor movement alerts ("CompetitorA just increased their AI visibility by 15 points")
- Regular new opportunities discovered as content landscape changes
- Weekly digest that proves value ("Here's what improved this week")
- Low effort to implement recommendations (system drafts, human approves)

**Retention risks:**
- Score doesn't improve → investigate why, proactively surface blockers
- No opportunities found → check if query universe is sufficient
- Customer stops checking portal → trigger email with new findings

---

## STAGE 6: EXPANSION

**Expansion triggers:**
- Usage limit reached (upgrade path triggered)
- "You're tracking 5/5 competitors — upgrade to track 10"
- New use case: "You can also track this secondary brand"
- Team growth: "Invite your SEO team to collaborate"
- Agency use case: "Track all your clients from one place"

---

## SCREEN DESIGN PRINCIPLES

Every screen must answer a customer question:

| Screen | Question answered |
|---|---|
| Overview | "How am I doing?" |
| AI Visibility | "What do AI assistants say about me?" |
| SEO | "Where do I stand in search?" |
| Competitors | "How do I compare?" |
| Opportunities | "What should I do next?" |
| Actions | "What have I done and what happened?" |
| Reports | "Can I show this to my team/board?" |

No screen should exist purely to display data for its own sake. Every screen should prompt action or create understanding.

---

## EMPTY STATES

All empty states should:
1. Explain why the state is empty
2. Tell the customer what to do
3. Make it easy to take that action

Examples:
- No opportunities: "We're still analyzing your brand. Come back in [time]. Or add more competitors to find more gaps."
- No competitors tracked: "Add competitors to see how you compare in AI recommendations."
- No integrations: "Connect Google Search Console to unlock keyword ranking data."
