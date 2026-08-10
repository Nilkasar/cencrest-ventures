# CLAUDE.md — Cencrest Ventures

## Commit, Push & Deploy Rule

**After every task that modifies files:** commit all changes with a descriptive message, push to the remote, then run `vercel --prod` to deploy. Do this automatically — do not wait to be asked. If git is not initialized or there is no remote, initialize and set one up before proceeding.

## Token & Response Rules

**Minimum token usage.** Say only what is necessary. No summaries at end of responses, no restating what you just did, no filler phrases. One short sentence per update. Skip preamble — act, then report result.

**No unnecessary work.** Do only what is explicitly asked. No refactoring surrounding code, no adding comments, no creating helper abstractions, no "while I'm here" cleanup. If a task is ambiguous, ask one sharp question instead of guessing.

**No unsolicited suggestions.** Do not volunteer extra features, improvements, or alternative approaches unless directly relevant to the task at hand.

## Project Identity

**Cencrest** is a Recommendation Intelligence firm. It measures how AI models (ChatGPT, Gemini, Claude, Perplexity) describe markets and competitors, then rebuilds the evidence those models read.

Tagline: *"See why AI recommends your competitors."*
Positioning: Instrument company, not a marketing agency. Evidence over opinion.

## Tech Stack

- Pure HTML/CSS/JS — no framework, no build step
- Deployed on Vercel (project: `cencrest`, org: `team_g3nli6KRgXRnCg5VyS5iNsWM`)
- Files: `index.html`, `style.css`, `interactions.js`, `source-field.js`, `hero-film.js`
- Assets: `assets/band.png`

## Design System

- Colors: `--paper` (#F7F3EC), `--ink` (#16140F), `--ember` (#C2410C), `--dim`, `--slate`
- Fonts: Fraunces (display/headlines), Inter (sans UI), Spectral (serif body), JetBrains Mono (mono labels)
- Dark background sections use `--ink` bg with `--paper` text
- Left rail: fixed 236px sidebar for scroll progress on desktop

## Sections (in order)

| # | ID | Label |
|---|----|-|
| 01 | `#hero` | Hero — main headline + CTA |
| 02 | `#provocation` | "Now run it on you" — company input |
| 03 | `#chorus` | 4-model response grid |
| — | marquee | Scrolling tape of signals |
| — | `.band` | Full-bleed photo band |
| 04 | `#sources` | Source field canvas (340 nodes) |
| 05 | `#signals` | 8 measurement signals |
| 06 | `#method` | 4-phase process (Frame → Measure → Trace → Rebuild) |
| 07 | `#artefact` | The deliverable — 120-page Recommendation Intelligence Bible |
| 08 | `#firm` | Who we are |
| 09 | `#engagements` | Pricing tiers ($24k / $65k / $12k mo) |
| 10 | `#index` | Public research index |
| 11 | `#apply` | Application form |

## Engagement Pricing

- Diagnostic (Audit & Baseline): $24,000 one-time
- Full Rebuild (Diagnostic + Execution): $65,000 / 3-month
- Continuous (Retained Intelligence): $12,000 / month
