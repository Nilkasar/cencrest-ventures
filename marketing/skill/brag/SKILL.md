---
name: brag
description: Make a polished launch video (and its poster + share copy) for the current project or a website — story, real UI, original music, render. Use when the user says /brag, "make a launch video / promo reel / brag video", or asks for a reel about a feature. Follows MARKETING-STUDIO.md quality rules and uses the marketing/ render kit.
---

# /brag — you built it, now brag

You make the whole video yourself — story, visuals, audio, render — with the kit in `marketing/`
(installed by `node marketing/setup.mjs`). If `marketing/studio.config.json` is missing, run that first.
Everything in **MARKETING-STUDIO.md §0 (quality bar)** applies: real UI only, no invented claims, phone 85–90 %
of frame height, no bounce, beat sync measured, a new music genre every time.

Usage: `/brag [input] [options]`. Options (flags or plain language):

| Option | Default |
|---|---|
| `--tone <preset or freeform>` | inferred; `default` if nothing clearly fits |
| `--format vertical\|landscape\|square` | vertical 1080×1920 (landscape 1920×1080, square 1080×1080), 30 fps |
| `--duration <s>` | about 20 s (15–30) |
| `--focus <feature/version>` | the whole product |

Deliverables go to `marketing/deliverables/brag-YYYY-MM-DD-<slug>/`; intermediates to `marketing/out/`.

## 1. Inspect
Decide what the input is: **project** (no input, current directory is a codebase) or **website** (a URL or bare
domain). Anything else → ask the user what to brag about.
- **Project:** read the main page, routes, key components, styles (exact colours + fonts), README, pricing/plan
  code, and recent `git log`. Find the product **in use**: entry → key action → result.
- **Website:** render it headless (JS sites are empty to curl), dismiss banners, scroll section by section;
  collect headline, tagline, features, CTAs, testimonials, meta tags, colours, fonts, logo, screenshots/videos.
- **Real screens:** capture them (or reuse `marketing/shots/`). Never rebuild what you can capture.

Then answer before planning: What is it (one sentence)? Who is it for, what does it do for them? What sets it
apart? Most impressive or funniest true claim? Visual hook? Which real flow to show? Tone? One-line caption?
Write the facts you'll use into the Fact Sheet (MARKETING-STUDIO.md §2.3) — nothing unverified goes on screen.

## 2. Plan
Write `brag-plan.md`: angle, hook, 2–3 highlights, punchline, tone, visual identity, **BPM + beat grid**, and a
scene-by-scene storyboard whose durations sum to the target and whose cuts sit on bar lines.
Shape (a start, not a template): Hook 2–3 s → Reveal 2–4 s → 2–3 sharp highlights → Punchline/outro 2–4 s.

## Creative laws
- **Short.** 15–25 s; 18–22 is the sweet spot.
- **Clear to a stranger.** After one view they know what it does, who it's for, how to get it.
- **The hook is everything.** First 2 s decide. Plan it first.
- **Show the thing.** The working product doing its job beats a landing page describing it. Small illustrative
  UI text is fine (a filename, an "Added ✓" toast); invented claims, numbers or testimonials are not.
- **Specific.** Use the product's own copy. Banned: "streamline your workflow" and friends.
- **Readable.** ≥ 0.3 s per word, counted from when the whole line is on screen.
- **Alive.** Things appear one by one, simulated taps, swipes, typing — not static slides.
- **Funny earns its place** — from the product's own absurdity.
- **Every frame postable.**

## Tones
| Tone | Feel | Pacing / transitions |
|---|---|---|
| `default` | punchy, playful, clean | 4–5 scenes; soft transitions |
| `polished` | serious, elegant | 3–4 scenes, long holds; soft fades |
| `yc-parody` | deadpan startup launch | 4–5 scenes, one claim each; hard cuts |
| `chaotic` | FAST, LOUD, ALL CAPS | 6–8 scenes, some < 2 s; flash/zoom cuts |
| `deadpan` | calm, dry | 3–4 scenes, big empty space; slow fades |
| `cinematic` | trailer-scale | 4–5 scenes, big type; dramatic wipes |
| `app-store` | clean feature cards | 4–6 scenes; smooth slides |

## Sound
Write music and SFX as one piece with `marketing/audio/studio_audio.py` (copy `example_futurepop.py`, then
**change the genre** — see `audio/GENRES.md` and the product's genre ledger). SFX in the song's key, in the
same reverb space, quiet, on the grid; one SFX per on-screen event at the exact same timestamp. Proper mix:
nothing harsh, repeated small sounds in the background, peak −1.5 dBFS.

## 3. Build, check, render
Start from `marketing/templates/reel.html` (pure `render(t)`, fonts/images awaited). Then:
1. `node marketing/tools/render.cjs stills <reel.html> marketing/out/stills <every scene + mid-transition times>`
2. `python marketing/tools/sheet.py marketing/out/stills.jpg 5 300 "marketing/out/stills/*.jpg"` → **look at it**.
   Fix overflow, collisions, low contrast, callouts covering numbers. Busy-to-busy crossfades → stagger or dip.
3. `node marketing/tools/render.cjs frames <reel.html> marketing/out/frames`
4. `python marketing/audio/<score>.py marketing/out/audio.wav`
5. `python marketing/tools/encode.py marketing/out/frames marketing/out/audio.wav <deliverable>/brag.mp4 --cover <t>`
6. `python marketing/tools/beatcheck.py <deliverable>/brag.mp4 <planned cut times>` → all OK.

## 4. Deliver
- **Poster:** the strongest settled frame → `brag.jpg`, baked in as frame 0 (`--cover`), duration unchanged.
- **`share-copy.txt`:** 1–3 sentences, postable as-is, specific, in tone. No "excited to share".
- **Tell the user** where the video and copy are, the creative angle in one sentence, what you verified
  (stills, beat check, loudness) and what you couldn't (you can't hear audio). Offer to re-roll a scene or tone.
