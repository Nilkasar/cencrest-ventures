/* ============================================================
   BEBEST — Hero Cloud Layer
   Procedural volumetric clouds, three-depth parallax drift
   ============================================================ */

(function () {
  'use strict';

  class HeroClouds {
    constructor(canvas) {
      this.canvas  = canvas;
      this.ctx     = canvas.getContext('2d');
      this.W       = 0;
      this.H       = 0;
      this.clouds  = [];
      this.raf     = null;
      this._onResize = () => this._resize();

      window.addEventListener('resize', this._onResize, { passive: true });
      this._resize();
      this._populate();
      this._tick();
    }

    /* ── setup ─────────────────────────────────────────────── */

    _resize() {
      const canvas = this.canvas;
      this.W = canvas.width  = canvas.offsetWidth;
      this.H = canvas.height = canvas.offsetHeight;
    }

    _populate() {
      /*
        Three depth layers — back (slow, opaque-ish), mid, fore (fast, faint).
        Each layer gets its own cloud count, speed, opacity and size band.
      */
      const layers = [
        { n: 3, vx: -0.055, opBase: 0.065, sMin: 1.10, sMax: 1.80 }, // back
        { n: 4, vx: -0.120, opBase: 0.040, sMin: 0.55, sMax: 0.95 }, // mid
        { n: 3, vx: -0.220, opBase: 0.022, sMin: 0.26, sMax: 0.50 }, // fore
      ];

      this.clouds = [];

      for (const L of layers) {
        for (let i = 0; i < L.n; i++) {
          const t  = (i + 0.1 + Math.random() * 0.8) / L.n;
          const sc = L.sMin + Math.random() * (L.sMax - L.sMin);
          this.clouds.push({
            x      : this.W * t,
            y      : this.H * (0.06 + Math.random() * 0.54),
            vx     : L.vx * (0.82 + Math.random() * 0.36),
            vyAcc  : 0,
            opacity: L.opBase * (0.78 + Math.random() * 0.44),
            scale  : sc,
            puffs  : this._makePuffs(),
            L,
          });
        }
      }

      /* Sort back-to-front so large slow clouds paint under smaller fast ones */
      this.clouds.sort((a, b) => a.scale - b.scale);
    }

    /* ── cloud geometry ─────────────────────────────────────── */

    _makePuffs() {
      const n      = 6 + Math.floor(Math.random() * 5);   // 6–10 base puffs
      const baseR  = 52 + Math.random() * 46;
      const puffs  = [];

      /* Main arch — lumpy on top, flatter on bottom */
      for (let i = 0; i < n; i++) {
        const t     = i / (n - 1);
        const arch  = Math.sin(t * Math.PI);              // 0 → 1 → 0 arch
        const jitterY = (Math.random() - 0.5) * baseR * 0.20;
        puffs.push({
          x: (t - 0.5) * n * baseR * 0.70,
          y: -arch * baseR * 0.40 + jitterY,
          r: baseR * (0.52 + arch * 0.52 + Math.random() * 0.30),
        });
      }

      /* A handful of smaller secondary puffs stacked above the arch */
      const extras = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < extras; i++) {
        const host = puffs[1 + Math.floor(Math.random() * (n - 2))];
        puffs.push({
          x: host.x + (Math.random() - 0.5) * host.r * 0.85,
          y: host.y - host.r * (0.28 + Math.random() * 0.38),
          r: host.r  * (0.30 + Math.random() * 0.28),
        });
      }

      return puffs;
    }

    /* ── rendering ──────────────────────────────────────────── */

    _drawCloud(c) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(c.x | 0, c.y | 0);
      ctx.scale(c.scale, c.scale);
      ctx.globalAlpha = c.opacity;

      for (const p of c.puffs) {
        /*
          Radial gradient: bright warm-cream centre → transparent edge.
          Offset inner centre slightly upward to fake volumetric lighting
          (light from above).
        */
        const g = ctx.createRadialGradient(
          p.x, p.y - p.r * 0.10, p.r * 0.03,   // inner (light top)
          p.x, p.y + p.r * 0.06, p.r            // outer (fade to transparent)
        );
        g.addColorStop(0.00, 'rgba(245, 240, 228, 0.96)');
        g.addColorStop(0.28, 'rgba(232, 225, 210, 0.68)');
        g.addColorStop(0.58, 'rgba(215, 206, 188, 0.28)');
        g.addColorStop(0.82, 'rgba(200, 190, 170, 0.08)');
        g.addColorStop(1.00, 'rgba(185, 175, 155, 0.00)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    /* ── animation loop ─────────────────────────────────────── */

    _cloudSpan(c) {
      let max = 0;
      for (const p of c.puffs) max = Math.max(max, Math.abs(p.x) + p.r);
      return max * c.scale * 2.4;
    }

    _tick() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.W, this.H);

      for (const c of this.clouds) {
        /* Horizontal drift */
        c.x += c.vx;

        /* Very slow, organic vertical wobble */
        c.vyAcc += (Math.random() - 0.5) * 0.00085;
        c.vyAcc *= 0.968;
        c.y += c.vyAcc;
        c.y = Math.max(this.H * 0.03, Math.min(this.H * 0.74, c.y));

        /* Wrap: re-enter from the right when fully off-screen left */
        const span = this._cloudSpan(c);
        if (c.x < -span * 0.55) {
          c.x     = this.W + span * 0.40;
          c.y     = this.H * (0.06 + Math.random() * 0.54);
          c.vyAcc = 0;
        }

        this._drawCloud(c);
      }

      this.raf = requestAnimationFrame(() => this._tick());
    }

    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      window.removeEventListener('resize', this._onResize);
    }
  }

  /* Auto-init on the hero canvas */
  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('hero-clouds');
    if (canvas) new HeroClouds(canvas);
  });

  window.HeroClouds = HeroClouds;
})();
