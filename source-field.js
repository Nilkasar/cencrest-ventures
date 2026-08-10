/* ============================================================
   CENCREST — Source Field Canvas (Section 04)
   ============================================================ */

class SourceField {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._nodes = [];
    this._edges = [];
    this._visible = true;
    this._raf = null;

    this._seed();
    this._bind();
    this._pump();
  }

  _seed() {
    const categories = ['Trade Press', 'Directory/G2', 'Owned Site', 'Community/Reddit', 'Docs/Github'];
    const hues = ['217,184,124', '142,151,180', '182,186,203', '123,129,154'];

    // Create 340 source nodes
    for (let i = 0; i < 340; i++) {
      const radiusDist = Math.pow(Math.random(), 1.8);
      const angle = Math.random() * Math.PI * 2;
      const depth = radiusDist < 0.33 ? 1 : radiusDist < 0.66 ? 2 : 3;

      this._nodes.push({
        x: Math.cos(angle) * radiusDist * 0.4 + 0.5,
        y: Math.sin(angle) * radiusDist * 0.4 + 0.5,
        baseR: depth === 1 ? 2.5 + Math.random() * 2 : 1.2 + Math.random() * 1.5,
        depth: depth,
        hue: hues[Math.floor(Math.random() * hues.length)],
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.5,
        isGap: i === 42 // Highlight 1 key gap
      });
    }

    // Connect nodes into co-citation edges
    for (let i = 0; i < 80; i++) {
      const a = Math.floor(Math.random() * this._nodes.length);
      let b = Math.floor(Math.random() * this._nodes.length);
      if (a !== b) {
        this._edges.push({ a, b, alpha: 0.04 + Math.random() * 0.08 });
      }
    }
  }

  _bind() {
    this._onVis = () => this._pump();
    document.addEventListener('visibilitychange', this._onVis);

    this._io = new IntersectionObserver(
      (entries) => {
        this._visible = entries[0].isIntersecting;
        this._pump();
      },
      { rootMargin: '10%' }
    );
    this._io.observe(this._canvas);
  }

  _pump() {
    const run = this._visible && !document.hidden;
    if (run && !this._raf) this._raf = requestAnimationFrame(this._draw);
    if (!run && this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  _draw = (now) => {
    const cv = this._canvas;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) {
      this._raf = requestAnimationFrame(this._draw);
      return;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }

    const ctx = this._ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t = now / 1000;

    // Draw depth concentric rings
    ctx.strokeStyle = 'rgba(242,238,230,0.05)';
    ctx.lineWidth = 1;
    [0.15, 0.3, 0.42].forEach((r) => {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) * r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Draw co-citation edges
    this._edges.forEach((e) => {
      const nA = this._nodes[e.a];
      const nB = this._nodes[e.b];
      const x1 = nA.x * w;
      const y1 = nA.y * h;
      const x2 = nB.x * w;
      const y2 = nB.y * h;

      ctx.strokeStyle = `rgba(242,238,230,${e.alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    // Draw source nodes
    this._nodes.forEach((n) => {
      const x = n.x * w + Math.sin(t * n.speed + n.phase) * 2;
      const y = n.y * h + Math.cos(t * n.speed * 0.8 + n.phase) * 2;
      const pulse = 1 + Math.sin(t * 2 + n.phase) * 0.2;
      const r = n.baseR * pulse;

      if (n.isGap) {
        // Ember gap marker
        ctx.strokeStyle = 'rgba(217,184,124,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#D9B87C';
        ctx.beginPath();
        ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#D9B87C';
        ctx.fillText('GAP 01', x + 12, y + 3);
      } else {
        ctx.fillStyle = `rgba(${n.hue}, ${n.depth === 1 ? 0.85 : 0.45})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    this._raf = requestAnimationFrame(this._draw);
  };
}

window.SourceField = SourceField;
