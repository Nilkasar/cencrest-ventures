// render.cjs — one renderer for posters, carousels and reels (headless Chrome via puppeteer-core).
//   node tools/render.cjs poster   templates/poster.html   out/posters  home,safe,giant   [1080x1350]
//   node tools/render.cjs carousel templates/carousel.html out/carousel A,B,C
//   node tools/render.cjs stills   templates/reel.html     out/stills   1.2,3,5.5,9
//   node tools/render.cjs frames   templates/reel.html     out/frames
// Poster/carousel pages: ?k=<key>, expose window.ready (carousel: resolves to slide count).
// Reel pages: expose window.render(t) and window.ready → {dur, fps?}.
const path = require('path'), url = require('url'), fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'studio.config.json'), 'utf8'));
const P = require(cfg.puppeteer);
const [mode, html, outDir, list = '', size] = process.argv.slice(2);
if (!mode || !html || !outDir) { console.log('usage: render.cjs poster|carousel|stills|frames <html> <outDir> [keys|times] [WxH]'); process.exit(1); }
const href = (q = '') => url.pathToFileURL(path.resolve(html)).href + q;
const O = path.resolve(outDir); fs.mkdirSync(O, { recursive: true });

(async () => {
  // `--no-sandbox` is required when the renderer runs as root in a container (Chrome
  // refuses to start otherwise). Harmless on a workstation; the pages rendered are
  // local template files, not untrusted web content. Set STUDIO_SANDBOX=1 to drop it.
  const sandboxArgs = process.env.STUDIO_SANDBOX === '1' ? [] : ['--no-sandbox', '--disable-setuid-sandbox'];
  const b = await P.launch({ executablePath: cfg.chrome, headless: 'new', args: ['--force-color-profile=srgb', '--hide-scrollbars', '--allow-file-access-from-files', ...sandboxArgs] });
  const pg = await b.newPage();
  pg.on('pageerror', (e) => console.error('page error:', e.message));
  if (mode === 'poster') {
    const [w, h] = (size || '1080x1350').split('x').map(Number);
    await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    for (const k of list.split(',').filter(Boolean)) {
      await pg.goto(href('?k=' + k), { waitUntil: 'networkidle0' }); await pg.evaluate(() => window.ready);
      await pg.screenshot({ path: path.join(O, k + '.png') }); console.log('poster', k);
    }
  } else if (mode === 'carousel') {
    for (const k of list.split(',').filter(Boolean)) {
      await pg.setViewport({ width: 1080 * 12, height: 1350, deviceScaleFactor: 1 });
      await pg.goto(href('?c=' + k), { waitUntil: 'networkidle0' }); const n = await pg.evaluate(() => window.ready);
      const d = path.join(O, k); fs.mkdirSync(d, { recursive: true });
      for (let i = 0; i < n; i++) await pg.screenshot({ path: path.join(d, String(i + 1).padStart(2, '0') + '.png'), clip: { x: i * 1080, y: 0, width: 1080, height: 1350 } });
      console.log('carousel', k, n, 'slides');
    }
  } else {
    await pg.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await pg.goto(href(), { waitUntil: 'networkidle0' });
    const info = await pg.evaluate(() => window.ready), fps = info.fps || 30;
    const shot = async (t, f) => {
      await pg.evaluate((t) => window.render(t), t);
      await pg.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => 0))));
      await pg.screenshot({ path: f, type: 'jpeg', quality: 93 });
    };
    if (mode === 'stills') for (const t of list.split(',').map(Number)) await shot(t, path.join(O, `t-${t.toFixed(2)}.jpg`));
    else { const n = Math.round(info.dur * fps); for (let i = 0; i < n; i++) await shot(i / fps, path.join(O, String(i).padStart(5, '0') + '.jpg')); console.log(n, 'frames'); }
  }
  await b.close();
})();
