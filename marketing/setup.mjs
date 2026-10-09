#!/usr/bin/env node
// setup.mjs — one command to make a project ready for MARKETING-STUDIO.md.
//   node marketing/setup.mjs            (run from the PROJECT ROOT, after copying marketing-starter/ to ./marketing)
//   node marketing/setup.mjs --smoke    (also renders one poster, one carousel and a 2-second reel test)
// What it does:
//   1. npm install puppeteer-core (local to the kit)       4. installs the /brag skill into <project>/.claude/skills/brag
//   2. pip install numpy scipy pillow imageio-ffmpeg       5. creates shots/ (placeholders if empty), out/, deliverables/
//   3. finds Chrome + ffmpeg → studio.config.json          6. adds marketing/out and node_modules to .gitignore
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const sh = (c, o = {}) => execSync(c, { stdio: 'inherit', cwd: KIT, env: ENV, ...o });
const q = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const step = (s) => console.log(`\n▸ ${s}`);

step('Node packages (puppeteer-core)');
if (!fs.existsSync(path.join(KIT, 'node_modules', 'puppeteer-core'))) sh('npm install --no-audit --no-fund');

step('Python packages');
const PY = q('python3 --version') ? 'python3' : 'python';
sh(`${PY} -m pip install --quiet --disable-pip-version-check numpy scipy pillow imageio-ffmpeg`);

step('Chrome');
const chromeCandidates = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'), 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
}[process.platform] || [];
const chrome = process.env.CHROME || chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) { console.error('✗ Chrome not found. Install Google Chrome or set CHROME=/path/to/chrome and re-run.'); process.exit(1); }
console.log('  ', chrome);

step('ffmpeg');
const ffmpeg = process.env.FFMPEG || (q('ffmpeg -version') ? 'ffmpeg' : q(`${PY} -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`));
if (!ffmpeg) { console.error('✗ ffmpeg not found (pip install imageio-ffmpeg failed?). Set FFMPEG=/path/to/ffmpeg.'); process.exit(1); }
console.log('  ', ffmpeg);

const cfg = { chrome, ffmpeg, python: PY, puppeteer: path.join(KIT, 'node_modules', 'puppeteer-core').replace(/\\/g, '/') };
fs.writeFileSync(path.join(KIT, 'studio.config.json'), JSON.stringify(cfg, null, 2));
console.log('   wrote studio.config.json');

step('Brag skill → .claude/skills/brag');
const skillDst = path.join(ROOT, '.claude', 'skills', 'brag');
fs.mkdirSync(skillDst, { recursive: true });
fs.copyFileSync(path.join(KIT, 'skill', 'brag', 'SKILL.md'), path.join(skillDst, 'SKILL.md'));
console.log('  ', path.relative(ROOT, skillDst), '(use it as /brag in Claude Code)');

step('Working folders');
for (const d of ['shots', 'out', 'deliverables']) fs.mkdirSync(path.join(KIT, d), { recursive: true });
if (!fs.readdirSync(path.join(KIT, 'shots')).some((f) => f.endsWith('_screen.png'))) {
  sh(`${PY} tools/placeholder_screens.py shots`);
  console.log('   placeholders created — replace with REAL screens before publishing (MARKETING-STUDIO.md §3)');
}
const gi = path.join(ROOT, '.gitignore'), rel = path.relative(ROOT, KIT).replace(/\\/g, '/');
const want = [`${rel}/out/`, `${rel}/node_modules/`, `${rel}/studio.config.json`];
const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
const add = want.filter((w) => !cur.includes(w));
if (add.length && rel && !rel.startsWith('..')) fs.appendFileSync(gi, `\n# marketing studio\n${add.join('\n')}\n`);

if (process.argv.includes('--smoke')) {
  step('Smoke test');
  sh('node tools/render.cjs poster templates/poster.html out/smoke peek-home,giant');
  sh('node tools/render.cjs carousel templates/carousel.html out/smoke B');
  sh('node tools/render.cjs stills templates/reel.html out/smoke 1.5,4.5,21.8');
  sh(`${PY} tools/sheet.py out/smoke-sheet.jpg 4 300 "out/smoke/*.png" "out/smoke/*.jpg"`);
  console.log('   open out/smoke-sheet.jpg — every image should be finished-looking (placeholder screens are expected)');
}
console.log('\n✓ Studio ready. Next: read MARKETING-STUDIO.md, do Phase 1 (Fact Sheet), capture real screens into', path.join(rel || '.', 'shots'));
