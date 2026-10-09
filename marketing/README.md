# marketing-starter — the render kit for MARKETING-STUDIO.md

Posters, Instagram carousels, vertical reels and original music, built from a product's **real screens** in
headless Chrome + ffmpeg + a small Python audio engine. Works on Windows, macOS and Linux.

## Install into a new project (2 minutes)
```bash
cp -r marketing-starter <project>/marketing         # or unzip marketing-starter.zip there
cp MARKETING-STUDIO.md <project>/                    # the playbook the agent follows
cd <project> && node marketing/setup.mjs --smoke     # installs everything + the /brag skill, renders a test
```
Needs: Node 18+, Python 3.9+, Google Chrome (or set `CHROME=`). ffmpeg comes from `imageio-ffmpeg` if missing.
Then tell the agent: *"Read MARKETING-STUDIO.md and follow it. Start with Phase 1."*

## What's inside
| Path | What |
|---|---|
| `setup.mjs` | installs deps, finds Chrome/ffmpeg → `studio.config.json`, installs `.claude/skills/brag`, makes folders, `--smoke` test |
| `templates/brand.js` | **the one file to edit per product**: brand tokens, FEATURES, HERO numbers, LAUNCH offer |
| `templates/poster.html` | 1080×1350 posters: `peek-<feature>` sneak-peek series, `giant` number, `faceoff` comparison |
| `templates/carousel.html` | seamless carousels: `A` what's coming · `B` swipe for a surprise · `C` guess the feature |
| `templates/reel.html` | 24 s vertical reel on a 100 BPM grid, phone-as-hero, taps/rings/toasts |
| `audio/studio_audio.py` | synth engine: drums, supersaws, plucks, bass, vocal chops, vibes, marimba, risers, UI SFX, stereo mix |
| `audio/example_futurepop.py` | score that matches `reel.html` beat-for-beat — copy it and **change the genre** |
| `audio/GENRES.md` | recipes for 12 genres; never repeat one inside a campaign |
| `tools/render.cjs` | `poster` / `carousel` / `stills` / `frames` renderer |
| `tools/encode.py` | frames + wav → bt709 mp4 with cover baked into frame 0, prints loudness |
| `tools/beatcheck.py` | detects cuts in the mp4 and checks them against planned hit times (±1 frame) |
| `tools/sheet.py` | contact sheet — look at every set before calling it done |
| `tools/deliver.py` | copy renders to deliverables, retrying locked files |
| `tools/placeholder_screens.py` | stand-in screens so the smoke test works — replace with real captures |
| `skill/brag/SKILL.md` | the `/brag` launch-video skill (setup installs it) |

## Everyday commands (from the project root)
```bash
node marketing/tools/render.cjs poster   marketing/templates/poster.html   marketing/out/posters peek-home,peek-feature1,giant,faceoff
node marketing/tools/render.cjs carousel marketing/templates/carousel.html marketing/out/carousels A,B,C
node marketing/tools/render.cjs stills   marketing/templates/reel.html     marketing/out/stills 1.5,4.5,6.3,8.3,10.2,21.8
node marketing/tools/render.cjs frames   marketing/templates/reel.html     marketing/out/frames
python marketing/audio/example_futurepop.py marketing/out/audio.wav
python marketing/tools/encode.py marketing/out/frames marketing/out/audio.wav marketing/deliverables/reel.mp4 --cover 21.8
python marketing/tools/beatcheck.py marketing/deliverables/reel.mp4 2.4,8.4,14.4,20.4
python marketing/tools/sheet.py marketing/out/sheet.jpg 5 300 "marketing/out/posters/*.png"
```
Templates are starting points. New sets should copy a template and invent a **new concept**
(MARKETING-STUDIO.md §5.5) — the kit guarantees quality, not variety.
