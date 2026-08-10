/* ============================================================
   CENCREST — Hero Film (8-Act Scroll-Driven Canvas)
   ============================================================ */

const MODELS = [
  { name:'CHATGPT',    hue:'236,240,236', x:0.19, y:0.29, size:0.115, kind:'rock',  spin:0.030, tilt:-0.22, ring:0 },
  { name:'CLAUDE',     hue:'217,184,124', x:0.76, y:0.23, size:0.150, kind:'gas',   spin:0.046, tilt: 0.30, ring:1 },
  { name:'GEMINI',     hue:'150,166,214', x:0.26, y:0.75, size:0.128, kind:'gas',   spin:0.038, tilt:-0.38, ring:0 },
  { name:'PERPLEXITY', hue:'138,178,168', x:0.82, y:0.71, size:0.100, kind:'ocean', spin:0.034, tilt: 0.16, ring:0 }
];

const STAR_CLASS = [
  [169,196,255, 0.06, 1.35],
  [225,233,255, 0.13, 1.10],
  [246,246,240, 0.24, 0.95],
  [255,240,214, 0.27, 0.90],
  [255,208,160, 0.19, 0.85],
  [255,176,138, 0.11, 0.80]
];

const LIGHT = { x:-0.62, y:-0.58 };
const SOURCES = ['wikipedia','g2.com','reddit','github','docs','capterra','trade press','stackoverflow','youtube','forums','directories','research'];
const PROMPT  = 'best freight visibility software for mid-market logistics';
const ACTS    = ['I · THE FIELD','II · THE MINDS','III · THE QUESTION','IV · RETRIEVAL','V · THE VERDICT','VI · THE GAP','VII · REPAIR','VIII · THE ANSWER'];
const CUES    = [0, 0.10, 0.20, 0.30, 0.44, 0.56, 0.70, 0.84];

const clamp   = (v,a,b) => Math.max(a, Math.min(b,v));
const seg     = (p,a,b) => clamp((p-a)/(b-a), 0, 1);
const ease    = (t) => t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
const easeOut = (t) => 1-Math.pow(1-t,3);
const rnd     = (s) => { let x=Math.sin(s)*10000; return x-Math.floor(x); };

class HeroFilm {
  constructor({ track, canvas, actEl, promptEl, promptTextEl, verdictEl, verdictKickEl, verdictBodyEl, finalEl, hintEl, barFillEl }) {
    this._track = track;
    this._canvas = canvas;
    this._actEl = actEl;
    this._promptEl = promptEl;
    this._promptTextEl = promptTextEl;
    this._verdictEl = verdictEl;
    this._verdictKickEl = verdictKickEl;
    this._verdictBodyEl = verdictBodyEl;
    this._finalEl = finalEl;
    this._hintEl = hintEl;
    this._barFillEl = barFillEl;

    this._p   = 0;
    this._mx  = 0; this._my  = 0;
    this._tx  = 0; this._ty  = 0;
    this._pn  = -1;
    this._actIdx = -1;
    this._vLate  = null;
    this._raf    = null;
    this._visible = true;

    this._seedField();
    this._bind();
    this._pump();
  }

  _bind() {
    this._onScroll = () => {
      const r = this._track.getBoundingClientRect();
      const span = this._track.offsetHeight - window.innerHeight;
      this._p = span > 0 ? clamp(-r.top / span, 0, 1) : 0;
    };
    this._onMove = (e) => {
      this._tx = e.clientX / window.innerWidth - 0.5;
      this._ty = e.clientY / window.innerHeight - 0.5;
    };
    this._onVis = () => { this._pump(); };

    window.addEventListener('scroll', this._onScroll, { passive:true });
    window.addEventListener('mousemove', this._onMove, { passive:true });
    document.addEventListener('visibilitychange', this._onVis);

    this._io = new IntersectionObserver(
      (e) => { this._visible = e[0].isIntersecting; this._pump(); },
      { rootMargin:'10%' }
    );
    this._io.observe(this._track);
    this._onScroll();
  }

  destroy() {
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._io) this._io.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _pump() {
    const run = this._visible && !document.hidden;
    if (run && !this._raf) this._raf = requestAnimationFrame(this._draw);
    if (!run && this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _seedField() {
    this._dust = [];
    for (let i=0; i<1150; i++) {
      const d   = rnd(i*1.7);
      const mag = Math.pow(rnd(i*2.3), 3.1);
      let acc=0, cls=STAR_CLASS[2];
      const roll = rnd(i*13.7);
      for (const c of STAR_CLASS) { acc+=c[3]; if (roll<=acc){cls=c;break;} }
      this._dust.push({
        x: rnd(i*3.1), y: rnd(i*5.3), z: 0.25+d*0.75,
        ph: rnd(i*7.9)*6.28, tw: 0.6+rnd(i*17.1)*1.9,
        r: (0.45+mag*0.62)*cls[4], mag,
        c: cls[0]+','+cls[1]+','+cls[2],
        spike: mag>0.94
      });
    }

    this._neb = [];
    for (let i=0; i<7; i++) {
      this._neb.push({
        x: rnd(i*21.3), y: 0.18+rnd(i*31.7)*0.64,
        r: 0.16+rnd(i*41.1)*0.30,
        c: i%3===0?'96,110,168':(i%3===1?'150,166,214':'110,96,140'),
        a: 0.020+rnd(i*51.9)*0.030
      });
    }

    this._srcs = SOURCES.map((n,i) => {
      const a  = (i/SOURCES.length)*6.28+0.4;
      const rr = 0.20+rnd(i*11.3)*0.10;
      return { n, x:0.5+Math.cos(a)*rr*1.5, y:0.5+Math.sin(a)*rr, weak:i>7 };
    });

    this._you    = { x:0.5, y:0.5 };
    this._rivals = [
      { n:'NORTHWIND',  x:0.34, y:0.50 },
      { n:'DELTA RAIL', x:0.50, y:0.38 },
      { n:'COPPERLINE', x:0.66, y:0.50 }
    ];
  }

  _planet(ctx, x, y, R, m, t, a) {
    const hue=m.hue, lx=x+LIGHT.x*R, ly=y+LIGHT.y*R, rot=t*m.spin;

    // atmosphere halo
    const at = ctx.createRadialGradient(x,y,R*0.94,x,y,R*1.55);
    at.addColorStop(0,   'rgba('+hue+','+0.34*a+')');
    at.addColorStop(0.35,'rgba('+hue+','+0.12*a+')');
    at.addColorStop(1,   'rgba('+hue+',0)');
    ctx.fillStyle=at; ctx.beginPath(); ctx.arc(x,y,R*1.5,0,6.2832); ctx.fill();

    // ring (back half)
    if (m.ring) this._ring(ctx,x,y,R,hue,m.tilt,a,true);

    // body
    ctx.save();
    ctx.beginPath(); ctx.arc(x,y,R,0,6.2832); ctx.clip();
    ctx.fillStyle='rgba(10,13,22,'+0.94*a+')';
    ctx.fillRect(x-R,y-R,R*2,R*2);

    // lit hemisphere
    const lit = ctx.createRadialGradient(lx,ly,R*0.04,lx,ly,R*1.55);
    lit.addColorStop(0,    'rgba('+hue+','+1.0*a+')');
    lit.addColorStop(0.30, 'rgba('+hue+','+0.68*a+')');
    lit.addColorStop(0.62, 'rgba('+hue+','+0.22*a+')');
    lit.addColorStop(1,    'rgba('+hue+',0)');
    ctx.fillStyle=lit; ctx.fillRect(x-R,y-R,R*2,R*2);

    // surface
    ctx.save();
    ctx.translate(x,y); ctx.rotate(m.tilt);
    if (m.kind==='gas') {
      for (let b=-5;b<=5;b++) {
        const yy  = (b/5.6)*R;
        const hh  = R*(0.055+0.045*Math.abs(Math.sin(b*1.7+rot)));
        const wob = Math.sin(rot*1.4+b*0.9)*R*0.05;
        const sh  = b%2===0?0.10:-0.09;
        ctx.fillStyle = sh>0?'rgba(255,255,255,'+0.09*a+')':'rgba(0,0,0,'+0.14*a+')';
        ctx.beginPath(); ctx.ellipse(wob,yy,R*1.02,hh,0,0,6.2832); ctx.fill();
      }
      const sx=Math.cos(rot*1.1)*R*0.42;
      if (Math.cos(rot*1.1)>-0.2) {
        ctx.fillStyle='rgba(0,0,0,'+0.16*a+')';
        ctx.beginPath(); ctx.ellipse(sx,R*0.22,R*0.20,R*0.085,0,0,6.2832); ctx.fill();
      }
    } else {
      for (let k=0;k<11;k++) {
        const ang=k*2.399+rot*(m.kind==='ocean'?0.7:1);
        const rr =R*(0.16+((k*37)%61)/61*0.62);
        const cxp=Math.cos(ang)*rr, cyp=Math.sin(ang*0.7)*rr*0.8;
        const cr =R*(0.10+((k*53)%37)/37*0.22);
        ctx.fillStyle=m.kind==='ocean'
          ?(k%2?'rgba(255,255,255,'+0.07*a+')':'rgba(0,0,0,'+0.13*a+')')
          :'rgba(0,0,0,'+0.11*a+')';
        ctx.beginPath(); ctx.ellipse(cxp,cyp,cr,cr*0.72,ang,0,6.2832); ctx.fill();
      }
    }
    ctx.restore();

    // limb darkening
    const lb=ctx.createRadialGradient(x,y,R*0.55,x,y,R);
    lb.addColorStop(0,'rgba(0,0,0,0)');
    lb.addColorStop(1,'rgba(4,6,12,'+0.30*a+')');
    ctx.fillStyle=lb; ctx.fillRect(x-R,y-R,R*2,R*2);

    // terminator
    const tm=ctx.createRadialGradient(lx,ly,R*0.75,lx,ly,R*2.25);
    tm.addColorStop(0,    'rgba(0,0,0,0)');
    tm.addColorStop(0.55, 'rgba(6,8,15,'+0.30*a+')');
    tm.addColorStop(1,    'rgba(6,8,15,'+0.72*a+')');
    ctx.fillStyle=tm; ctx.fillRect(x-R,y-R,R*2,R*2);
    ctx.restore();

    // atmospheric rim
    ctx.save();
    const ra=Math.atan2(LIGHT.y,LIGHT.x);
    ctx.strokeStyle='rgba('+hue+','+0.78*a+')';
    ctx.lineWidth=Math.max(1,R*0.022);
    ctx.beginPath(); ctx.arc(x,y,R*0.995,ra-1.35,ra+1.35); ctx.stroke();
    ctx.restore();

    // ring (front half)
    if (m.ring) this._ring(ctx,x,y,R,hue,m.tilt,a,false);
  }

  _ring(ctx,x,y,R,hue,tilt,a,back) {
    ctx.save();
    ctx.translate(x,y); ctx.rotate(tilt+0.24);
    ctx.beginPath();
    ctx.rect(-R*3, back?-R*3:0, R*6, R*3);
    ctx.clip();
    [[1.42,1.72,0.20],[1.78,1.95,0.11],[2.02,2.16,0.07]].forEach(([r0,r1,al])=>{
      const g=ctx.createLinearGradient(-R*r1,0,R*r1,0);
      g.addColorStop(0,    'rgba('+hue+',0)');
      g.addColorStop(0.22, 'rgba('+hue+','+al*a+')');
      g.addColorStop(0.5,  'rgba('+hue+','+al*0.5*a+')');
      g.addColorStop(0.78, 'rgba('+hue+','+al*a+')');
      g.addColorStop(1,    'rgba('+hue+',0)');
      ctx.strokeStyle=g;
      ctx.lineWidth=R*(r1-r0);
      ctx.beginPath();
      ctx.ellipse(0,0,R*(r0+r1)/2,R*(r0+r1)/2*0.28,0,0,6.2832);
      ctx.stroke();
    });
    ctx.restore();
  }

  _draw = (now) => {
    const cv=this._canvas;
    const w=cv.clientWidth, h=cv.clientHeight;
    if (!w||!h) { this._raf=requestAnimationFrame(this._draw); return; }

    const dpr=Math.min(2,window.devicePixelRatio||1);
    if (cv.width!==Math.round(w*dpr)) { cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }

    const ctx=cv.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);

    const p=this._p, t=now/1000;
    this._mx+=(this._tx-this._mx)*0.05;
    this._my+=(this._ty-this._my)*0.05;

    const zoom=1+ease(p)*0.42;
    const cx=w/2, cy=h/2;
    const PX=(nx,dep)=>cx+(nx-0.5)*w*zoom+this._mx*46*dep;
    const PY=(ny,dep)=>cy+(ny-0.5)*h*zoom+this._my*30*dep;

    // — ACT I: Star field + nebulas —
    const dustIn  = easeOut(seg(p,0.004,0.10));
    const dustOut  = 1-seg(p,0.62,0.86)*0.55;
    const fieldA   = dustIn*dustOut;

    // nebula wash
    this._neb.forEach(n=>{
      const nx=PX(n.x,0.18), ny=PY(n.y,0.18), R=n.r*Math.max(w,h);
      const g=ctx.createRadialGradient(nx,ny,0,nx,ny,R);
      g.addColorStop(0,   'rgba('+n.c+','+n.a*2.2*fieldA+')');
      g.addColorStop(0.55,'rgba('+n.c+','+n.a*1.0*fieldA+')');
      g.addColorStop(1,   'rgba('+n.c+',0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(nx,ny,R,0,6.2832); ctx.fill();
    });

    // stars
    this._dust.forEach(d=>{
      const dep=d.z;
      const sx=PX((d.x+t*0.003*dep)%1,dep);
      const sy=PY(d.y+Math.sin(t*0.18+d.ph)*0.004,dep);
      if (sx<-40||sx>w+40||sy<-40||sy>h+40) return;

      const amp=0.42*(1-d.mag*0.7);
      const tw =1-amp+amp*Math.sin(t*d.tw+d.ph);
      const a  =(0.26+d.mag*0.74)*(0.45+dep*0.55)*tw*fieldA;
      const R  =d.r*dep;

      if (d.mag>0.72) {
        const HR=R*2.4;
        const g=ctx.createRadialGradient(sx,sy,0,sx,sy,HR);
        g.addColorStop(0,'rgba('+d.c+','+a*0.22+')');
        g.addColorStop(1,'rgba('+d.c+',0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,sy,HR,0,6.2832); ctx.fill();
      }
      ctx.fillStyle='rgba('+d.c+','+Math.min(1,a)+')';
      ctx.beginPath(); ctx.arc(sx,sy,R,0,6.2832); ctx.fill();

      if (d.spike) {
        const L=R*(3.4+tw*0.8);
        const lg=ctx.createLinearGradient(sx-L,sy,sx+L,sy);
        lg.addColorStop(0,'rgba('+d.c+',0)');
        lg.addColorStop(0.5,'rgba('+d.c+','+a*0.45+')');
        lg.addColorStop(1,'rgba('+d.c+',0)');
        ctx.fillStyle=lg; ctx.fillRect(sx-L,sy-0.3,L*2,0.6);
        const vg=ctx.createLinearGradient(sx,sy-L,sx,sy+L);
        vg.addColorStop(0,'rgba('+d.c+',0)');
        vg.addColorStop(0.5,'rgba('+d.c+','+a*0.45+')');
        vg.addColorStop(1,'rgba('+d.c+',0)');
        ctx.fillStyle=vg; ctx.fillRect(sx-0.3,sy-L,0.6,L*2);
      }
    });

    // — ACT II: Four AI model planets —
    MODELS.forEach((m,i)=>{
      const stag=easeOut(seg(p,0.045+i*0.030,0.26+i*0.030));
      if (stag<=0.001) return;
      const x=PX(m.x,0.55), y=PY(m.y,0.55);
      const R=Math.min(w,h)*m.size*(0.72+0.28*stag);
      this._planet(ctx,x,y,R,m,t,stag);
      ctx.fillStyle='rgba('+m.hue+','+0.62*stag+')';
      ctx.font='10px "JetBrains Mono",monospace';
      ctx.textAlign='center';
      ctx.fillText(m.name, x, y+R*1.62);
      ctx.textAlign='left';
    });

    // — ACT IV: Retrieval — sources light up, edges fire —
    const retr=seg(p,0.30,0.46);
    if (retr>0) {
      this._srcs.forEach((s,i)=>{
        const on=easeOut(seg(retr,i/SOURCES.length*0.55,i/SOURCES.length*0.55+0.4));
        if (on<=0) return;
        const sx=PX(s.x,0.8), sy=PY(s.y,0.8);
        ctx.fillStyle='rgba(242,238,230,'+0.5*on+')';
        ctx.fillRect(sx-1.6,sy-1.6,3.2,3.2);
        ctx.fillStyle='rgba(182,186,203,'+0.4*on+')';
        ctx.font='9px "JetBrains Mono",monospace';
        ctx.fillText(s.n,sx+8,sy+3);

        MODELS.forEach((m,k)=>{
          if ((i+k)%3) return;
          const mxp=PX(m.x,0.55), myp=PY(m.y,0.55);
          ctx.strokeStyle='rgba('+m.hue+','+0.16*on+')';
          ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(mxp,myp); ctx.stroke();
          const ph=((t*0.32)+(i*0.13)+(k*0.29))%1;
          const px2=sx+(mxp-sx)*ph, py2=sy+(myp-sy)*ph;
          ctx.fillStyle='rgba('+m.hue+','+0.85*on+')';
          ctx.beginPath(); ctx.arc(px2,py2,1.5,0,6.2832); ctx.fill();
        });
      });
    }

    // — ACT V: Verdict — rivals resolve, you stay dark —
    const res=seg(p,0.44,0.58);
    if (res>0) {
      this._rivals.forEach((r,i)=>{
        const on=easeOut(seg(res,i*0.16,i*0.16+0.42));
        const rx=PX(r.x,0.4), ry=PY(r.y,0.4);
        const R=26*on;
        const g=ctx.createRadialGradient(rx,ry,0,rx,ry,R*2.4);
        g.addColorStop(0,'rgba(242,238,230,'+0.42*on+')');
        g.addColorStop(1,'rgba(242,238,230,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(rx,ry,R*2.4,0,6.2832); ctx.fill();
        ctx.fillStyle='rgba(242,238,230,'+0.92*on+')';
        ctx.beginPath(); ctx.arc(rx,ry,3.4*on,0,6.2832); ctx.fill();
        ctx.font='10px "JetBrains Mono",monospace';
        ctx.textAlign='center';
        ctx.fillStyle='rgba(242,238,230,'+0.7*on+')';
        ctx.fillText(r.n,rx,ry-18);
        ctx.textAlign='left';
      });

      // your node: outline only
      const yx=PX(this._you.x,0.4), yy=PY(this._you.y+0.16,0.4);
      const yOn=easeOut(seg(res,0.5,1));
      ctx.strokeStyle='rgba(123,129,154,'+0.75*yOn+')';
      ctx.setLineDash([3,4]); ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(yx,yy,9,0,6.2832); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font='10px "JetBrains Mono",monospace';
      ctx.textAlign='center';
      const blink=p<0.56&&(Math.floor(t*1.6)%2===0);
      ctx.fillStyle='rgba(123,129,154,'+0.85*yOn+')';
      ctx.fillText(p<0.56?(blink?'SEARCHING…':''):'NOT FOUND',yx,yy+26);
      ctx.textAlign='left';
    }

    // — ACT VI: Cencrest scan pulse + defect flags —
    const scan=seg(p,0.56,0.70);
    if (scan>0) {
      const yx=PX(this._you.x,0.4), yy=PY(this._you.y+0.16,0.4);
      for (let k=0;k<3;k++) {
        const ph=(scan*1.6+k*0.33)%1;
        ctx.strokeStyle='rgba(217,184,124,'+0.4*(1-ph)*Math.min(1,scan*3)+')';
        ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.arc(yx,yy,ph*Math.max(w,h)*0.6,0,6.2832); ctx.stroke();
      }
      this._srcs.filter(s=>s.weak).forEach((s,i)=>{
        const on=easeOut(seg(scan,0.25+i*0.1,0.7+i*0.1));
        if (on<=0) return;
        const sx=PX(s.x,0.8), sy=PY(s.y,0.8);
        const pulse=0.6+0.4*Math.sin(t*3+i);
        ctx.strokeStyle='rgba(217,184,124,'+0.9*on*pulse+')';
        ctx.lineWidth=1.2;
        ctx.strokeRect(sx-6,sy-6,12,12);
      });
    }

    // — ACT VII/VIII: Repair — edges rebuild, node ignites —
    const fix=seg(p,0.70,0.90);
    if (fix>0) {
      const yx=PX(this._you.x,0.4), yy=PY(this._you.y+0.16,0.4);
      this._srcs.forEach((s,i)=>{
        const on=easeOut(seg(fix,i/SOURCES.length*0.5,i/SOURCES.length*0.5+0.45));
        if (on<=0) return;
        const sx=PX(s.x,0.8), sy=PY(s.y,0.8);
        ctx.strokeStyle='rgba(217,184,124,'+0.28*on+')';
        ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(yx,yy); ctx.stroke();
        const ph=((t*0.5)+i*0.11)%1;
        ctx.fillStyle='rgba(217,184,124,'+0.9*on+')';
        ctx.beginPath(); ctx.arc(sx+(yx-sx)*ph,sy+(yy-sy)*ph,1.7,0,6.2832); ctx.fill();
      });

      const ig=easeOut(seg(p,0.80,0.92));
      if (ig>0) {
        const yx2=PX(this._you.x,0.4), yy2=PY(this._you.y+0.16,0.4);
        const R=60*ig;
        const g=ctx.createRadialGradient(yx2,yy2,0,yx2,yy2,R);
        g.addColorStop(0,'rgba(217,184,124,'+0.55*ig+')');
        g.addColorStop(1,'rgba(217,184,124,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(yx2,yy2,R,0,6.2832); ctx.fill();
        ctx.fillStyle='rgba(217,184,124,'+ig+')';
        ctx.beginPath(); ctx.arc(yx2,yy2,4.5*ig,0,6.2832); ctx.fill();
      }
    }

    // final wash
    const wash=seg(p,0.90,1);
    if (wash>0) {
      ctx.fillStyle='rgba(6,8,15,'+wash*0.82+')';
      ctx.fillRect(0,0,w,h);
    }

    this._paintDom(p,t);
    this._raf=requestAnimationFrame(this._draw);
  };

  _paintDom(p,t) {
    const set=(el,o,extra)=>{ if(!el) return; el.style.opacity=o; if(extra) el.style.transform=extra; };

    // act label
    let ai=0;
    for (let i=0;i<CUES.length;i++) if(p>=CUES[i]) ai=i;
    if (this._actEl && this._actIdx!==ai) {
      this._actIdx=ai;
      this._actEl.textContent=ACTS[ai];
    }

    // prompt card
    const pr=seg(p,0.20,0.26), pOut=1-seg(p,0.32,0.38);
    set(this._promptEl,(pr*pOut).toFixed(3),'translate(-50%,-50%) scale('+(0.97+pr*0.03).toFixed(3)+')');
    if (this._promptTextEl) {
      const n=Math.floor(seg(p,0.205,0.30)*PROMPT.length);
      if (n!==this._pn) { this._pn=n; this._promptTextEl.textContent=PROMPT.slice(0,n); }
    }

    // verdict
    const vIn=seg(p,0.50,0.56), vOut=1-seg(p,0.68,0.74);
    set(this._verdictEl,(vIn*vOut).toFixed(3));
    const late=p>=0.565;
    if (this._verdictBodyEl && this._vLate!==late) {
      this._vLate=late;
      this._verdictBodyEl.textContent=late?'You are not in the answer.':'Three names. Every model. Every run.';
      if (this._verdictKickEl) this._verdictKickEl.textContent=late?'NOT FOUND · 0 MENTIONS':'RESOLVED · 4 MODELS';
    }

    // final
    set(this._finalEl, seg(p,0.90,0.985).toFixed(3));
    if (this._finalEl) this._finalEl.style.pointerEvents=p>0.94?'auto':'none';

    // hint
    set(this._hintEl,(1-seg(p,0.02,0.08)).toFixed(3));

    // progress bar
    if (this._barFillEl) this._barFillEl.style.width=(p*100).toFixed(2)+'%';
  }
}

window.HeroFilm = HeroFilm;
