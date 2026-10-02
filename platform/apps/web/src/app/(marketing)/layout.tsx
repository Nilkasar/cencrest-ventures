import Link from "next/link";

/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — the public route group.
 * Redesigned to match the auth split-panel layout: dark left panel (~55%),
 * light right panel (~45%), full-screen no scroll.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh flex overflow-hidden bg-background">
      {/* ── Left panel (dark, ~55%, desktop only) ─────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between bg-ink-950 text-ink-0 px-14 py-12 w-[55%] shrink-0">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="BeBest" className="size-8 object-contain" />
            <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">BeBest</span>
            <span className="size-1.5 rounded-full bg-verdant-400" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-1.5 border border-ink-0/20 bg-ink-0/5 rounded-full px-3 py-1">
            <span className="size-1.5 rounded-full bg-verdant-400" aria-hidden="true" />
            <span className="text-[12px] text-ink-0/70">Free AI Visibility Snapshot</span>
          </div>
        </div>

        {/* Center hero */}
        <div className="flex flex-col gap-6 max-w-lg">
          <div className="flex flex-col gap-3">
            <h1 className="font-display text-[58px] leading-[1.08] font-semibold tracking-[-0.02em] text-ink-0">
              Your brand&apos;s AI<br />
              <span className="text-verdant-400">visibility score.</span>
            </h1>
            <p className="text-[14.5px] text-ink-0/60 leading-relaxed max-w-md">
              See exactly how ChatGPT, Claude, Gemini and Perplexity discover, trust and recommend your brand — versus your competitors.
            </p>
          </div>

          {/* Score metric flow diagram */}
          <div className="w-full mt-2">
            <svg
              viewBox="0 0 520 240"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full"
              aria-hidden="true"
            >
              <defs>
                <filter id="glow-green-snap" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <linearGradient id="line-fade-snap" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#5c9c78" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#5c9c78" stopOpacity="0.15" />
                </linearGradient>
              </defs>

              {/* Metric cards — left column */}
              {/* AI Mentions */}
              <rect x="0" y="10" width="140" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="5s" repeatCount="indefinite" begin="0s" />
              </rect>
              <circle cx="20" cy="32" r="7" fill="#2d5a3d" />
              <circle cx="20" cy="32" r="3.5" fill="#5c9c78" />
              <text x="35" y="28" fill="#f4f2ec" fontSize="10.5" fontWeight="600">AI Mentions</text>
              <text x="35" y="43" fill="#5c9c78" fontSize="10" fontWeight="600">68%</text>

              {/* Citation Rank */}
              <rect x="0" y="66" width="140" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="6s" repeatCount="indefinite" begin="1.2s" />
              </rect>
              <circle cx="20" cy="88" r="7" fill="#2d4a5a" />
              <circle cx="20" cy="88" r="3.5" fill="#4a9ec7" />
              <text x="35" y="84" fill="#f4f2ec" fontSize="10.5" fontWeight="600">Citation Rank</text>
              <text x="35" y="99" fill="#4a9ec7" fontSize="10" fontWeight="600">#4</text>

              {/* Trust Score */}
              <rect x="0" y="122" width="140" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="7s" repeatCount="indefinite" begin="2.4s" />
              </rect>
              <circle cx="20" cy="144" r="7" fill="#3a2d1a" />
              <circle cx="20" cy="144" r="3.5" fill="#c9a24a" />
              <text x="35" y="140" fill="#f4f2ec" fontSize="10.5" fontWeight="600">Trust Score</text>
              <text x="35" y="155" fill="#c9a24a" fontSize="10" fontWeight="600">7.2/10</text>

              {/* Sentiment */}
              <rect x="0" y="178" width="140" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="8s" repeatCount="indefinite" begin="3.6s" />
              </rect>
              <circle cx="20" cy="200" r="7" fill="#2d1a3a" />
              <circle cx="20" cy="200" r="3.5" fill="#9c6abf" />
              <text x="35" y="196" fill="#f4f2ec" fontSize="10.5" fontWeight="600">Sentiment</text>
              <text x="35" y="211" fill="#9c6abf" fontSize="10" fontWeight="600">+0.42</text>

              {/* Bezier curves — metrics to Your Score */}
              <path id="path-snap-mentions" d="M140 32 C270 32 270 120 390 120" stroke="url(#line-fade-snap)" strokeWidth="1.5" filter="url(#glow-green-snap)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" begin="0s" />
              </path>
              <path id="path-snap-citation" d="M140 88 C265 88 265 118 390 120" stroke="url(#line-fade-snap)" strokeWidth="1.5" filter="url(#glow-green-snap)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="3.5s" repeatCount="indefinite" begin="0.5s" />
              </path>
              <path id="path-snap-trust" d="M140 144 C265 144 265 122 390 120" stroke="url(#line-fade-snap)" strokeWidth="1.5" filter="url(#glow-green-snap)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="4s" repeatCount="indefinite" begin="1s" />
              </path>
              <path id="path-snap-sentiment" d="M140 200 C265 200 265 124 390 120" stroke="url(#line-fade-snap)" strokeWidth="1.5" filter="url(#glow-green-snap)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="3.8s" repeatCount="indefinite" begin="1.5s" />
              </path>

              {/* Flowing dots — AI Mentions path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="4s" repeatCount="indefinite" begin="0s">
                  <mpath href="#path-snap-mentions" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="4s" repeatCount="indefinite" begin="1.3s">
                  <mpath href="#path-snap-mentions" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="4s" repeatCount="indefinite" begin="2.6s">
                  <mpath href="#path-snap-mentions" />
                </animateMotion>
              </circle>

              {/* Flowing dots — Citation Rank path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="5s" repeatCount="indefinite" begin="0.4s">
                  <mpath href="#path-snap-citation" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="5s" repeatCount="indefinite" begin="2s">
                  <mpath href="#path-snap-citation" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="5s" repeatCount="indefinite" begin="3.6s">
                  <mpath href="#path-snap-citation" />
                </animateMotion>
              </circle>

              {/* Flowing dots — Trust Score path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="6s" repeatCount="indefinite" begin="0.8s">
                  <mpath href="#path-snap-trust" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="6s" repeatCount="indefinite" begin="2.8s">
                  <mpath href="#path-snap-trust" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="6s" repeatCount="indefinite" begin="4.8s">
                  <mpath href="#path-snap-trust" />
                </animateMotion>
              </circle>

              {/* Flowing dots — Sentiment path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="4.5s" repeatCount="indefinite" begin="1.2s">
                  <mpath href="#path-snap-sentiment" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="4.5s" repeatCount="indefinite" begin="2.7s">
                  <mpath href="#path-snap-sentiment" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="4.5s" repeatCount="indefinite" begin="4.2s">
                  <mpath href="#path-snap-sentiment" />
                </animateMotion>
              </circle>

              {/* Label annotations floating near lines */}
              <text x="158" y="26" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">QUERIES</text>
              <text x="158" y="82" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">CITATIONS</text>
              <text x="150" y="138" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">BRAND RANK</text>
              <text x="155" y="194" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">RECOMMENDATIONS</text>

              {/* Soft halo pulse behind "Your Score" box center */}
              <circle cx="455" cy="120" r="16" fill="#5c9c78">
                <animate attributeName="opacity" values="0;0.15;0" dur="2.5s" repeatCount="indefinite" begin="0s" />
              </circle>

              {/* Your Score box — right */}
              <rect x="390" y="88" width="130" height="64" rx="10" fill="#1e2b22" stroke="#5c9c78" strokeWidth="1.5">
                <animate attributeName="strokeOpacity" values="0.3;0.9;0.3" dur="2s" repeatCount="indefinite" begin="0s" />
              </rect>
              <text x="455" y="114" textAnchor="middle" fill="#f4f2ec" fontSize="13" fontWeight="600">Your Score</text>
              <text x="455" y="132" textAnchor="middle" fill="#5c9c78" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">AI VISIBILITY</text>
            </svg>
          </div>

          {/* Bullet list */}
          <ul className="flex flex-col gap-2.5">
            {[
              "1,400+ buying-intent queries across 4 AI models",
              "Your score vs. top 3 competitors",
              "Source citations traced to exact pages",
              "Priority action plan — no fluff",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-[13.5px] text-ink-0/70">
                <span className="size-1.5 rounded-full bg-verdant-400 shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom stats */}
        <div className="flex items-center gap-0">
          <div className="flex flex-col gap-0.5 pr-8">
            <span className="font-mono text-[20px] font-semibold text-ink-0">24h</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-0/40">Delivery Time</span>
          </div>
          <div className="w-px h-8 bg-ink-0/15" />
          <div className="flex flex-col gap-0.5 px-8">
            <span className="font-mono text-[20px] font-semibold text-ink-0">4</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-0/40">AI Models</span>
          </div>
          <div className="w-px h-8 bg-ink-0/15" />
          <div className="flex flex-col gap-0.5 pl-8">
            <span className="font-mono text-[20px] font-semibold text-ink-0">Free</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-0/40">No Credit Card</span>
          </div>
        </div>
      </div>

      {/* ── Right panel (light, ~45%) ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-between px-6 py-10 bg-background overflow-y-auto">
        <div className="flex-1 flex items-center justify-center w-full">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <Link
          href="/login"
          className="text-[12.5px] text-subtle-foreground hover:text-foreground transition-colors"
        >
          Already have an account? <span className="underline">Sign in</span>
        </Link>
      </div>
    </div>
  );
}
