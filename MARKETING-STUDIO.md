# MARKETING-STUDIO.md — launch-grade posters, carousels, reels and music for any product

> **What this is.** The working agreement for an AI agent (Claude Code or any agent with a shell + browser) to
> act as an in-house creative studio for a software product: study the product, capture its real screens,
> and produce Instagram posters, swipe carousels, vertical reels, store screenshots and original music —
> at a quality you could post the same day.
> It was distilled from a real production run (Spendly, 150+ posters, 20+ reels, carousels, store assets).
> See `SPENDLY-MARKETING.md` for that worked example.
>
> **Start in any project / any account:**
> 1. Copy `marketing-starter/` to `<project>/marketing/` and this file to the project root.
> 2. Say: *"Read MARKETING-STUDIO.md and follow it. Product: <repo / URL>."*
> The agent runs Step 0 (auto-install, incl. the `/brag` skill), then Phase 1, and shows you the Fact Sheet
> before designing anything.

---

## Step 0 — Bootstrap (the agent does this automatically, every new project)
```bash
test -f marketing/studio.config.json || node marketing/setup.mjs --smoke
```
`setup.mjs` installs puppeteer-core and the Python packages (numpy, scipy, pillow, imageio-ffmpeg), finds Chrome
and ffmpeg, writes `marketing/studio.config.json`, **installs the `/brag` skill into `.claude/skills/brag/`**,
creates `marketing/shots|out|deliverables`, git-ignores the heavy folders, and renders a smoke test. Open
`marketing/out/smoke-sheet.jpg` and confirm it looks finished before going on. If `marketing/` is missing,
ask the user for `marketing-starter.zip` (it ships next to this file).

Then create **`<PRODUCT>-MARKETING.md`** in the project root (copy the structure of `SPENDLY-MARKETING.md`):
Fact Sheet, screen map, persona numbers, concept ledger, genre ledger, deliverables index. It is the
product's memory — update it after every set so the next chat never repeats a concept or a genre.

---

## 0. The quality bar (non-negotiable — each rule came from a real correction)

1. **Real product, never imaginary.** Every phone, row, number and badge is a real capture or a pixel-faithful
   rebuild of real UI with real copy. No generic dashboards, no stock UI kits.
2. **Never invent** a feature, price, number, limit or promise. Every claim traces to code, config, pricing or
   the live product (§2). Can't verify → drop it, and say you dropped it.
3. **Fine print where truth needs it:** trial rules and exclusions, "not tax/financial advice", privacy
   ("read on your phone, never uploaded"), assumptions behind any calculated number.
4. **The phone is the hero.** Reels: phone **85–90 % of frame height**; cropping top/bottom is fine, shrinking it
   to show the whole device is not. Posters: the screen must be readable at feed size (~400 px wide).
5. **No bouncy / elastic / overshoot motion.** Ease-out cubic and ease-in-out cubic only.
6. **Beat sync is measured, not eyeballed** — `tools/beatcheck.py`, ±1 frame at 30 fps.
7. **A different music genre for every video.** Keep the genre ledger; never repeat within a campaign.
8. **Every new set must look different from the last.** Check the concept ledger, pick a new idea (§5.5).
   "They all look the same" is a fail even if each poster is pretty.
9. **Keep the brand's tone** (friendly + emojis stays friendly + emojis). Don't "corporatise" it.
10. **No celebrity / film / superhero look-alikes, no third-party logos or trade dress** (banks, payment apps,
    official store badges) — use generic mock-ups and plain text ("Google Play").
11. **Look at everything before you say done:** contact sheet of every set, one item at full size, reel
    stills at every scene and mid-transition. Fix overlaps, clipping, contrast, arrows covering numbers.
12. **Never post, publish, commit or push** unless the owner asks. Never create accounts or type passwords —
    the owner logs in; you use the open tab.

---

## 1. Workflow
```
Step 0  Bootstrap kit + /brag skill + <PRODUCT>-MARKETING.md
Phase 1 Understand the product  → FACT SHEET + FEATURE INVENTORY + BRAND TOKENS   (show the owner)
Phase 2 Capture real screens    → marketing/shots/  (+ screen map with y-coordinates of key numbers)
Phase 3 Configure               → marketing/templates/brand.js
Phase 4 Produce                 → posters §5 · carousels §6 · reels §7 (or /brag) · music §8
Phase 5 QA + deliver            → §9, §10, update <PRODUCT>-MARKETING.md ledgers
```

### 1.1 Ask the owner only what you can't discover
Which logged-in account/environment to capture from · audience, market, currency, language · launch status
(live / beta / coming soon) · licensed music or reference videos · offers allowed in public and their exact
rules · anything that must never appear.

---

## 2. Phase 1 — Analyse the product system

**From a codebase** (delegate wide searches to a sub-agent; read in full what you'll quote):
routes/screens → feature inventory · pricing/plan tables → prices, limits, who gets what · in-app help or AI
guide (often lists every real button) · privacy code (OAuth scopes, permissions, "never stored") · theme/CSS
→ colours, fonts, radii, badge copy · `git log --oneline -30` → what's new · calculators → **run the real
module** to get poster numbers (never compute them by hand).

**From a website:** render headless (JS sites are empty to curl), dismiss banners, scroll section by section,
collect copy, pricing, FAQ, computed colours, loaded fonts, logo SVG, screenshots/videos.

**Output — the FACT SHEET** (goes into `<PRODUCT>-MARKETING.md`):
```markdown
## <Product> — <what it does, for whom, one sentence>
Status · Market · Currency · Language
### Plans (source: file:line)        ### Features (# · feature · screen · plan · proof)
### Allowed privacy wording (exact)  ### Persona numbers (read from the real screens)
### Do-not-say list (missing features, regulated claims, competitors)
```
When a memory note and the code disagree, the code wins.

**Brand tokens:** primary gradient, 2–3 accents, ink, light + dark backgrounds, display + UI fonts, radius,
emoji style, badge copy, logo SVG → `templates/brand.js`.

---

## 3. Phase 2 — Capture real screens
- A **demo persona with consistent numbers** (one month, everything adds up). All assets quote the same numbers.
- Mobile width 390 css px × DPR 2 → **780-px-wide PNGs**: `<screen>_screen.png` (first viewport, 780×1688),
  `<screen>_tall.png` (full scroll — enlarge the viewport and shoot once instead of stitching).
- Record a **screen map**: for each screen, the y of the app header bottom (crops start below it, ~125 px)
  and the x,y of key numbers — arrows, rings and crops aim at these (`brand.js → FEATURES[].target`).
- No real customer data. Chrome freezing on long pages → taller window, scroll the window not an inner
  scroller, wait for fonts/images, fresh tab on timeout.

---

## 4. The kit (installed in Step 0)
See `marketing/README.md` for every command. Contracts the templates follow:
- **Posters/carousels:** one HTML per set, `?k=` / `?c=` selects the item, `window.ready` awaits
  `document.fonts.load(...)` for every face + `img.decode()` (otherwise first renders fall back to serif).
- **Reels:** `window.render(t)` is a **pure function of time** (no CSS transitions, timers or unseeded
  randomness); `window.ready → {dur, fps}`.
- **Encoding:** bt709, yuv420p, CRF 17, faststart, AAC 256k; cover frame baked into frame 0.
- **Locked output folders** (sync apps): render to `marketing/out`, copy with `tools/deliver.py` (retries).
- Write multi-line scripts to files; shell heredocs with quotes break.

---

## 5. Posters

### 5.1 Formats
Feed/carousel **1080×1350** (default) · story/reel cover 1080×1920 · square 1080×1080 · store screenshots per
store spec · feature graphic 1024×500.

### 5.2 Typography & layout
- Headline: display font 800, 84–130 px, letter-spacing −.045em, line-height 1, **≤ 2 lines, ≤ ~7 words**;
  second line in the brand gradient or accent.
- Kicker: UI font 700–800, 22–28 px, letter-spacing .2em, UPPERCASE, accent.
- Sub-line 27–34 px / 600, ≤ 2 lines. Fine print ≥ 19 px.
- Margins 60–70 px. Nothing important in the bottom 40 px.
- **The hero number is the biggest thing on the poster** (₹0, 41.1 %, 3 taps).
- Grain overlay (SVG feTurbulence, 6–7 % overlay) for a printed feel. One idea per poster; lists ≤ 4 ✓ bullets.
- Crops start below the app's own header — a half-cut app bar looks broken.
- Annotation rings/arrows **end at the ring, never on top of the number**; give arrows a drop shadow.

### 5.3 Concept library — pick one not yet in the ledger
| Concept | Look | Best for |
|---|---|---|
| Sneak peek *(template)* | solid colour, tilted phone rising from the bottom, tape "SNEAK PEEK 👀 05/17", giant outlined number, handwritten note + arrow + ring | one-feature-per-post series |
| Giant number *(template)* | one huge number + the 4-step math underneath | calculators, savings, tax |
| Face-off *(template)* | loser card greyed, winner dark with "Saves ₹X" | comparisons |
| Document | rotated PDF with skeleton lines + checklist | reports, exports, statements |
| Report card | school report card, red-pen A+, handwritten comment | monthly summaries |
| Gauge | fuel gauge / speedometer with needle | budgets, limits |
| Search & filter | giant search bar, chips, real rows | lists, history |
| Lock-screen notifications | stacked notifications with real copy | automation, reminders |
| Ledger fill | rows dropping into a "TODAY" list with source badges | multiple input methods |
| Highlighter read | email/SMS text with marker on the key fields | "we read it for you" |
| Logo becomes the symbol | brand mark as diya / kite / gift | festivals |
| Real-world walls | poster on CC0 photos of walls/billboards (keep CREDITS.txt) | coming soon, OOH feel |
| Ticket / pass | perforated ticket with perks and price | premium, referral, early access |
| Avatar grid | the product's own avatars (no look-alikes) | community, referral |
| Kinetic type card | one bold sentence, words in different weights/colours | manifesto, brand |

### 5.4 Series
Same skeleton, changing colour/number/screen, numbered (01/17) so the grid looks planned. Save as
`deliverables/posters-vNN-<theme>/NN-<slug>.png`, and log the concept in the ledger.

---

## 6. Carousels
Draw the whole carousel as **one wide canvas** (N × 1080 by 1350) and slice it, so ribbons, roads and phones
cross slide edges — that's what makes people swipe. Every slide: position dots + a **"SWIPE →" pill with its
own background** (plain text disappears over a white phone screen). Last slide: CTA, no pill.
Template formats: **A** what's coming (cover with a phone peeking across the edge → one feature per slide →
end card) · **B** swipe for a surprise (ribbon into a gift box, hints, reveal + offer fine print) · **C** guess
the feature (blurred screen + hint + "?" → sharp answer → score card that drives comments).
Write a caption + hashtags per carousel in `captions.txt`.

---

## 7. Reels (1080×1920, 30 fps, 15–30 s) — or run `/brag`
1. **Grid first.** Choose BPM so chapters land on bars (100 BPM → beat .6 s, bar 2.4 s → chapters at 2.4 / 8.4 /
   14.4 / 20.4). Every event — tap, ring, toast, cut — sits on the grid.
2. **Structure:** hook (readable in 1 s) → 3–5 chapters (one idea, ~6 s, caption band with number + 3–6 words +
   FREE/PREMIUM) → outro (logo, status, URL).
3. **Motion:** phone rises in (ease-out .45 s), slow scroll of the real screen, finger-tap pulse, ring on the
   key number, toast "✓ …", staggered exit — never a muddy crossfade between two busy layouts. Whoosh .2 s
   before each cut.
4. **Check stills** at every scene + mid-transition → contact sheet → fix → render frames.
5. **Score** (§8) with the same event times → **encode** with `--cover <strongest settled frame>` →
   **beatcheck** with the planned cut times → all OK.
6. With a **licensed track**: detect its hits first (onset peaks) and build the edit on those times; make the
   logo appear exactly on the final hit (measure it).
Proven reel ideas: input-methods explainer filling a ledger · poster deck cut to a track · posters on real
walls · mosaic / zoom-through of the poster library · app-store feature cards · playful food-delivery-app
energy (style only, never their assets).

---

## 8. Music & sound (original, synthesised — no licensing risk)
- Engine: `marketing/audio/studio_audio.py` (stereo stems, reverb send, kick sidechain, soft clip, −1.5 dBFS).
- Start from `example_futurepop.py`, then **switch genre** using `audio/GENRES.md`; log it in the genre ledger.
- Every on-screen event has its SFX at the same timestamp (tap → tick, typing → soft ticks, row → pop,
  notification → ding, stamp → bell, chapter → riser + impact). SFX tuned to the key, gain 0.1–0.2, reverb-sent.
- Targets: RMS ≈ −12 dB, peak ≤ −1 dBFS, 1.8 s fade-out. `encode.py` prints the loudness.
- You can't hear the result — say so, and offer stereo-width / energy tweaks.

---

## 9. QA checklist (every set)
- [ ] Every claim is on the Fact Sheet; numbers match the screens exactly; fine print present where needed.
- [ ] Contact sheet viewed; one item at full size.
- [ ] No overflow, nothing touching a card edge, no annotation covering its number, nothing under the SWIPE pill.
- [ ] Fonts rendered (no serif fallback), images loaded.
- [ ] Reel: stills checked, duration exact, beatcheck OK, cover frame set, loudness in range.
- [ ] New concept + new genre, both logged in `<PRODUCT>-MARKETING.md`.
- [ ] No third-party logos, look-alikes or real customer data.
- [ ] Delivered with clear names + captions.

## 10. Reporting back
Lead with where the files are and a table (# · name · headline · what it shows). Say what you checked and how.
Name what you couldn't verify or hear, any claim you dropped and why, and what the owner must confirm before
posting (offers, store wording, regulated claims). One line of next options. No code dumps.

## 11. Prompt starters
- "Follow MARKETING-STUDIO.md. Product is this repo. Step 0 + Phase 1, then show me the Fact Sheet."
- "I'm logged in to the demo account in Chrome — capture the screens in the inventory and build the screen map."
- "Poster set, one per feature, using a concept we haven't used."
- "/brag --focus <feature> --tone default" · "Re-score reel X with a new genre, keep the visuals."
- "Three launching-soon carousels (A, B, C)."
