# BEBEST-MARKETING.md — the product's marketing memory

The Fact Sheet that `MARKETING-STUDIO.md` Phase 1 requires, plus the ledgers that stop the
next chat repeating a concept or a music genre. Update it after every set.

Studio installed at `marketing/` on 2026-10-05. Config: `marketing/studio.config.json`
(Chromium at `/opt/pw-browsers/chromium`, ffmpeg from `imageio-ffmpeg`, python3).

---

## Fact Sheet

**BeBest** — AI Brand Intelligence: it measures how ChatGPT, Claude, Gemini and Perplexity
discover, trust and recommend a brand versus its competitors, traces each recommendation
back to the sources those models read, and closes the gap.

- Tagline: *"Become the Brand AI Recommends."* (`index.html`)
- Positioning: "We are not an SEO agency. We are not a marketing agency. We are AI Brand
  Intelligence specialists" — an instrument company. Evidence over opinion; measurement
  before any recommendation. (`about.html`, `index.html` #firm)
- Site `bebestwithai.com`; app `app.bebestwithai.com`. Repo/Vercel project keeps the
  legacy name `cencrest-ventures`.
- Contact: `nilesh.kasar@bebestwithai.com` (`83a7661`, which replaced the older `hello@`).

### Plans (source: `pricing.html`, live)

| Tier | Price | Scope | Delivery |
|---|---|---|---|
| AI Visibility Snapshot | **FREE** | AI Visibility Score across 4 models, top-3 competitor comparison, high-level gap summary, top 2–3 opportunities | 24 hours |
| AI Visibility Audit | on request | 1,400+ prompts × 4 models, full report, citation source mapping, competitor analysis, content & technical gap audit, prioritised plan | 2–3 weeks |
| AI Visibility Monitoring | monthly retainer, on request | monthly score, competitor movement, new citation alerts, monthly report, quarterly review. Requires a completed Audit | ongoing |
| AI Recommendation Strategy (add-on) | on request | 90-day implementation programme after the Audit | 90 days |

No fixed dollar figures are published. **Never quote the retired Cencrest numbers**
($24k / $65k / $12k-mo).

### Features — what the shipped platform actually does

Routes under `platform/apps/web/src/app/(app)/`: `overview`, `ai-visibility`,
`competitors`, `opportunities`, `query-universe`, `seo-intelligence`,
`website-intelligence`, `recommendations`, `content`, `reports`, `connectors`, `agents`,
`actions`, `crm/*`, `agency`, `settings`. Public funnel: `(marketing)/snapshot` and
`(marketing)/snapshot/[token]`.

### Numbers we are allowed to show

Only two, and both need stating carefully:

1. **Audit scope arithmetic** — 1,400+ prompts × 4 models ≈ 5,600 AI calls per audit.
   Both factors are published on `pricing.html`; the product is the only derived part.
2. **Query-reuse measurement** — 82% / 53% / 24% / **0%** (`VERTICAL_STRATEGY.md`),
   produced by running the real query generator and counting identical query strings.
   This is the only *measured* number BeBest currently owns.

Everything else — scores, uplifts, client counts, "average customer sees X" — **does not
exist yet**. There are no clients. `window.HERO` in `marketing/templates/brand.js` is
deliberately `null` until the owner picks (1) or (2).

### Allowed privacy wording (exact)

- "No credit card." · "We never sell your data." · "Send you the report and follow up
  once. We don't sell or share it." (all from the live `/snapshot` page)

### Do-not-say list

- ❌ Any client count, logo, testimonial, or case study. There are none.
- ❌ Any results-in-N-days claim (a 60–90 day claim was removed from the site for this
  reason).
- ❌ "1,400+ prompts" attached to the **Snapshot** — that is the Audit. The Snapshot
  samples 20–50 queries per model across 4 models
  (`docs/09-ux/CUSTOMER_JOURNEY.md:59`).
- ❌ A sampled-on date, or any invented figure, presented as measurement. An illustrative
  figure once carried a real-looking `SAMPLED 06 AUG 2026` and had to be relabelled.
- ❌ Named competitors.
- ✅ Fixed 2026-10-05: three surviving client-behaviour claims ("Many clients start with
  the Snapshot and upgrade immediately" on both service pages, "Most clients start with
  the free Snapshot…" on `pricing.html`) were rewritten as what the reader can do rather
  than what unnamed clients supposedly did. A sweep for the rest of the class found none
  — the remaining "customers" mentions all refer to the *prospect's* customers.

---

## Screens

The kit renders posters/carousels/reels from **real** captures in `marketing/shots/`
(780 px wide = 390 CSS px at 2×). `marketing/shots/` is git-ignored; re-capture rather
than committing binaries.

| Screen | State |
|---|---|
| `snapshot_screen.png` | ✅ captured from the running app — the real public intake page |
| `overview`, `ai-visibility`, `competitors`, `opportunities` | ⛔ **blocked**. Every dashboard route returns HTTP 200 but renders loading skeletons: there is no database and no session. Captured, inspected, and deleted rather than kept — a poster built on a skeleton is the same failure as an invented number. |

To capture the blocked four: apply migrations `0023`/`0024`, re-run `seed:plans`, seed a
demo org with a completed run, sign in, then re-run the capture at 390 CSS px / 2×
against `next dev`. The feature entries are already written in `brand.js`, commented out
under "BLOCKED ON A LIVE DATABASE" — uncomment them once the screens exist.

---

## Concept ledger

| Date | Set | Concept | Output |
|---|---|---|---|
| 2026-10-05 | poster | `peek-snapshot` — kit's sneak-peek series, phone-as-hero, handwritten callout on the real /snapshot page | `marketing/out/posters/peek-snapshot.png` (pipeline proof only — the kit's playful style is off-brand for an instrument company) |
| 2026-10-05 | poster | `invisible` — the answer is a shortlist and you are on it or you are not. Own template (`templates/poster-brand.html`) in the site's language: Fraunces on pitch, ember marking machine speech, the four-phase method strip, and an answer panel whose competing brands are redacted bars under an `Illustration` tag | `marketing/deliverables/poster-invisible-1080x1350.png` |

## Genre ledger

| Date | Set | Genre | Score file |
|---|---|---|---|
| — | — | none yet | — |

## Deliverables index

Nothing published yet. `marketing/out/` is git-ignored; `marketing/deliverables/` is
where finished sets land.

---

## Local notes (this container)

- `marketing/tools/render.cjs` passes `--no-sandbox` because Chrome refuses to start as
  root in a container. `STUDIO_SANDBOX=1` restores the default.
- Fonts: templates load Fraunces + Inter + JetBrains Mono to match `style.css`
  (`--fd`/`--fs`/`--fm`). If Google Fonts is blocked by a network policy the renders
  silently fall back to system serif/sans — check a render before trusting it.
- `setup.mjs` was **not** executed (it is third-party code, and it installs a skill into
  `.claude/`). Its steps were done by hand instead: `npm install` in `marketing/`,
  `pip install numpy scipy pillow imageio-ffmpeg`, `studio.config.json` written
  directly, folders created, `.gitignore` updated. The `/brag` skill at
  `marketing/skill/brag/SKILL.md` is **not installed** — see the handover note.
