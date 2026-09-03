# CLAUDE.md — Cencrest Ventures

> **2026-09-04:** Project Identity, Tech Stack, Design System, Sections and Engagement Pricing rewritten to match the live site on disk. The site was rebranded from "Cencrest" (single-page, $24k/$65k/$12k-mo pricing) to **BeBest** on 2026-08-11 — a full multi-page site — but CLAUDE.md was never updated and the rebrand was never logged in session.md. This entry closes that gap. The repo/Vercel project name and folder are still `cencrest-ventures` — only the marketing brand shown on the site changed.

## Commit, Push & Deploy Rule

**After every task that modifies files:** commit all changes with a descriptive message, push to the remote, then run `vercel --prod` to deploy. Do this automatically — do not wait to be asked. If git is not initialized or there is no remote, initialize and set one up before proceeding.

## Token & Response Rules

**Minimum token usage.** Say only what is necessary. No summaries at end of responses, no restating what you just did, no filler phrases. One short sentence per update. Skip preamble — act, then report result.

**No unnecessary work.** Do only what is explicitly asked. No refactoring surrounding code, no adding comments, no creating helper abstractions, no "while I'm here" cleanup. If a task is ambiguous, ask one sharp question instead of guessing.

**No unsolicited suggestions.** Do not volunteer extra features, improvements, or alternative approaches unless directly relevant to the task at hand.

## Project Identity

**BeBest** (site domain `bebestwithai.com`; the underlying repo/Vercel project keeps the legacy name `cencrest-ventures`) is an AI Brand Intelligence firm. It measures how AI assistants (ChatGPT, Claude, Gemini, Perplexity) discover, trust and recommend a brand versus its competitors, traces every recommendation back to the sources those models read, and then closes the gap.

Tagline: *"Become the Brand AI Recommends."*
Positioning: "We are not an SEO agency. We are not a marketing agency. We are AI Brand Intelligence specialists" — instrument company, not an agency. Evidence over opinion; measurement before any recommendation. (`about.html`, `index.html` #firm section)

The marketing site is the top-of-funnel for the actual SaaS product (the "AI + SEO Growth Autopilot" per root `PRODUCT_VISION.md`). That product is being rebuilt from scratch in `platform/` (a pnpm+Turborepo monorepo, branch `rebuild/platform`, 17 of 19 product epics VERIFIED as of 2026-09-04 — see `platform/EPICS.md`); the older `api/`/`web-app/` implementation it replaces is left untouched as reference material until the rebuild's own Epic 20 (this epic) and Epic 21 (final audit) close it out. Every CTA on the site ("Get Free Snapshot") sends visitors to `https://app.bebestwithai.com/snapshot` — the platform — not to a form on this static site. The site's three packaged services (Snapshot / Audit / Monitoring, see Engagement Pricing below) are the marketing wrapper around the platform's AI Visibility Score engine; per `docs/09-ux/CUSTOMER_JOURNEY.md`, the free Snapshot flow runs a small sample of AI queries (20–50 × 4 models) behind the scenes to produce the lead's first score.

## Tech Stack

- Pure HTML/CSS/JS — no framework, no build step (this section covers the root marketing site only; the BeBest SaaS platform is the separate `platform/` monorepo — see `platform/EPICS.md`)
- Deployed on Vercel (project: `cencrest`, org: `team_g3nli6KRgXRnCg5VyS5iNsWM`)
- Shared scripts: `style.css`, `interactions.js`, `source-field.js`, `hero-film.js`, `clouds.js`
- Pages: `index.html`, `about.html`, `services.html`, `pricing.html`, `contact.html`, `blog.html`, `resources.html`, `ai-visibility-snapshot.html`, `ai-visibility-audit.html`, `ai-recommendation-strategy.html`, `terms.html`, `privacy-policy.html`, `cookie-policy.html`, `design-bible.html`
- Assets: `assets/band.png`, `assets/logo.png`, `assets/logo-mark.png`, `assets/logo-mark-dark.png`, `assets/logo-mark-light.png`, `assets/logo-mark-ember.png`

## Design System

- Colors (root `:root` in `style.css`): `--paper` (#F2EEE6), `--ink` (#0A0E18), `--ink-2` (#131829), `--pitch` (#06080F), `--slate` (#3A4055), `--smoke` (#7B819A), `--pebble` (#B6BACB), `--dim` (#A9AEC2), `--hair` / `--hair-2` (paper at 13%/26% alpha) — accent `--ember` (#D9B87C, champagne/gold — "marks machine speech") with `--ember-2` (#C2A067); `--ember-r` (#C2410C, rust) is kept as a separate variant reserved for the design bible, though the nav logo mark and favicon still hardcode rust (#C2410C) directly rather than via a CSS var. Semantic: `--danger` (#C0705C), `--success` (#6E9B87).
- Fonts: Fraunces (`--fd`, display/headlines), Inter (`--fs`, sans UI), Spectral (`--fr`, serif body), JetBrains Mono (`--fm`, mono labels/eyebrows) — unchanged from the Cencrest era.
- Dark background sections use `--ink`/`--pitch` bg with `--paper` text (`.inner-section-dark`, interstitial bands).
- Left rail: `--rail` is 96px on desktop, 36px on narrow viewports (not the previously documented fixed 236px) — used for scroll-progress indicator and content gutter offset.

## Sections (site map — every real page, in nav order)

| Page | Purpose |
|---|---|
| `index.html` | Homepage. Long-scroll narrative: `#hero` → `#provocation` ("now run it on you" company input) → `#chorus` (4-model response grid) → marquee tape → `.band` (full-bleed photo) → `#sources` (340-node source-field canvas) → `#signals` (8 measurement signals) → manifesto interstitial → `#method` (4-phase: Analyze → Measure → Optimize → Monitor) → `#artefact` (the AI Brand Intelligence Report deliverable) → `#firm` (who we are) → monitored-surfaces interstitial → `#engagements` (service tiers, mirrors `pricing.html`) → by-the-numbers interstitial → `#index` (research index, points to `blog.html`) → `#faq` → `#apply` (lead form, posts to the same backend as `contact.html`) |
| `about.html` | Positioning ("instrument company, not a marketing agency"), method, founder story (founded by Nilesh), values |
| `services.html` | The three services in detail: `#snapshot`, `#audit`, `#monitoring`, plus how they sequence |
| `pricing.html` | Pricing page — see Engagement Pricing below |
| `ai-visibility-snapshot.html` | Landing/detail page for the free Snapshot service |
| `ai-visibility-audit.html` | Landing/detail page for the paid Audit service |
| `ai-recommendation-strategy.html` | Add-on: 90-day implementation programme that follows the Audit |
| `contact.html` | Lead-capture form (same field set/shape as the homepage `#apply` form) + direct email |
| `blog.html` | Blog / published research index |
| `resources.html` | Research, guides & insights hub |
| `terms.html`, `privacy-policy.html`, `cookie-policy.html` | Legal pages |
| `design-bible.html` | Internal design-system reference — note: its `<title>` still says "Cencrest — Design Bible v1.0", a leftover from before the rebrand |

Nav (all pages): How It Works (`/#method`) · Services · Pricing · About · Resources, plus a persistent "Get Free Snapshot" CTA to `app.bebestwithai.com/snapshot`. Footer: About · Services · Pricing · Resources · Contact · `hello@bebestwithai.com`.

## Engagement Pricing

Source of truth: `pricing.html` (live 2026-09-04). No fixed one-time or monthly dollar amounts are published — pricing is scoped per engagement:

- **AI Visibility Snapshot** — FREE. AI Visibility Score across 4 models, top-3 competitor comparison, high-level gap summary, top 2–3 opportunities. Delivered in 24 hours.
- **AI Visibility Audit** — priced on request ("Get in touch"), scoped by category complexity/competitor count/prompt-set depth. 1,400+ prompts across 4 AI models, full AI Brand Intelligence Report, citation source mapping, competitor AI presence analysis, content & technical gap audit, prioritized action plan. 2–3 week delivery.
- **AI Visibility Monitoring** — monthly retainer, priced on request. Requires a completed Audit as baseline. Monthly AI Visibility Score, competitor movement tracking, new citation source alerts, monthly report, quarterly strategy review.
- **AI Recommendation Strategy** (add-on, sold separately, see `ai-recommendation-strategy.html`) — 90-day implementation programme following the Audit, aimed at measurable AI Visibility Score gains.

This replaces the old fixed-fee Cencrest model ($24k / $65k / $12k-mo) entirely — do not quote those figures.
