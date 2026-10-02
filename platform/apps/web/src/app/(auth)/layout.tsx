export default function AuthLayout({ children }: { children: React.ReactNode }) {
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
            <span className="text-[12px] text-ink-0/70">AI Visibility Platform</span>
          </div>
        </div>

        {/* Center hero */}
        <div className="flex flex-col gap-6 max-w-lg">
          <div className="flex flex-col gap-3">
            <h1 className="font-display text-[58px] leading-[1.08] font-semibold tracking-[-0.02em] text-ink-0">
              Become the brand<br />
              <span className="text-verdant-400">AI recommends.</span>
            </h1>
            <p className="text-[14.5px] text-ink-0/60 leading-relaxed max-w-md">
              Measure how ChatGPT, Claude, Gemini and Perplexity discover, trust and recommend your brand.
            </p>
          </div>

          {/* AI model flow diagram */}
          <div className="w-full mt-2">
            <svg
              viewBox="0 0 520 260"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full"
              aria-hidden="true"
            >
              <defs>
                <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <linearGradient id="line-fade" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#5c9c78" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#5c9c78" stopOpacity="0.15" />
                </linearGradient>
              </defs>

              {/* Model cards — left column */}
              {/* ChatGPT */}
              <rect x="0" y="10" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="5s" repeatCount="indefinite" begin="0s" />
              </rect>
              <circle cx="22" cy="32" r="9" fill="#10a37f" />
              <text x="22" y="36" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">G</text>
              <text x="38" y="28" fill="#f4f2ec" fontSize="11" fontWeight="600">ChatGPT</text>
              <text x="38" y="42" fill="#a89c81" fontSize="9">OpenAI</text>

              {/* Claude */}
              <rect x="0" y="66" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="6s" repeatCount="indefinite" begin="1.2s" />
              </rect>
              <circle cx="22" cy="88" r="9" fill="#cc785c" />
              <text x="22" y="92" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">✳</text>
              <text x="38" y="84" fill="#f4f2ec" fontSize="11" fontWeight="600">Claude</text>
              <text x="38" y="98" fill="#a89c81" fontSize="9">Anthropic</text>

              {/* Gemini */}
              <rect x="0" y="122" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="7s" repeatCount="indefinite" begin="2.4s" />
              </rect>
              <circle cx="22" cy="144" r="9" fill="#4285f4" />
              <polygon points="22,137 26,144 22,151 18,144" fill="white" />
              <text x="38" y="140" fill="#f4f2ec" fontSize="11" fontWeight="600">Gemini</text>
              <text x="38" y="154" fill="#a89c81" fontSize="9">Google</text>

              {/* Perplexity */}
              <rect x="0" y="178" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeWidth="1">
                <animate attributeName="strokeOpacity" values="0.2;0.45;0.2" dur="8s" repeatCount="indefinite" begin="3.6s" />
              </rect>
              <circle cx="22" cy="200" r="9" fill="#20b2aa" />
              <text x="22" y="204" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">❄</text>
              <text x="38" y="196" fill="#f4f2ec" fontSize="11" fontWeight="600">Perplexity</text>
              <text x="38" y="210" fill="#a89c81" fontSize="9">AI</text>

              {/* Bezier curves — model outputs to brand, with path IDs for animateMotion */}
              <path id="path-gpt" d="M130 32 C260 32 260 130 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" begin="0s" />
              </path>
              <path id="path-claude" d="M130 88 C255 88 255 128 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="3.5s" repeatCount="indefinite" begin="0.5s" />
              </path>
              <path id="path-gemini" d="M130 144 C255 144 260 132 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="4s" repeatCount="indefinite" begin="1s" />
              </path>
              <path id="path-perplexity" d="M130 200 C260 200 260 132 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)">
                <animate attributeName="strokeOpacity" values="0.3;0.6;0.3" dur="3.8s" repeatCount="indefinite" begin="1.5s" />
              </path>

              {/* Flowing dots — ChatGPT path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="4s" repeatCount="indefinite" begin="0s">
                  <mpath href="#path-gpt" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="4s" repeatCount="indefinite" begin="1.3s">
                  <mpath href="#path-gpt" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="4s" repeatCount="indefinite" begin="2.6s">
                  <mpath href="#path-gpt" />
                </animateMotion>
              </circle>

              {/* Flowing dots — Claude path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="5s" repeatCount="indefinite" begin="0.4s">
                  <mpath href="#path-claude" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="5s" repeatCount="indefinite" begin="2s">
                  <mpath href="#path-claude" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="5s" repeatCount="indefinite" begin="3.6s">
                  <mpath href="#path-claude" />
                </animateMotion>
              </circle>

              {/* Flowing dots — Gemini path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="6s" repeatCount="indefinite" begin="0.8s">
                  <mpath href="#path-gemini" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="6s" repeatCount="indefinite" begin="2.8s">
                  <mpath href="#path-gemini" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="6s" repeatCount="indefinite" begin="4.8s">
                  <mpath href="#path-gemini" />
                </animateMotion>
              </circle>

              {/* Flowing dots — Perplexity path */}
              <circle r="3" fill="#5c9c78" opacity="0.8">
                <animateMotion dur="4.5s" repeatCount="indefinite" begin="1.2s">
                  <mpath href="#path-perplexity" />
                </animateMotion>
              </circle>
              <circle r="2" fill="#5c9c78" opacity="0.5">
                <animateMotion dur="4.5s" repeatCount="indefinite" begin="2.7s">
                  <mpath href="#path-perplexity" />
                </animateMotion>
              </circle>
              <circle r="1.5" fill="#5c9c78" opacity="0.35">
                <animateMotion dur="4.5s" repeatCount="indefinite" begin="4.2s">
                  <mpath href="#path-perplexity" />
                </animateMotion>
              </circle>

              {/* Label annotations floating near lines */}
              <text x="155" y="26" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">QUESTIONS</text>
              <text x="155" y="82" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">CITATIONS</text>
              <text x="148" y="138" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">BRAND MENTIONS</text>
              <text x="155" y="192" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">SENTIMENT</text>

              {/* Soft halo pulse behind "Your Brand" box center */}
              <circle cx="455" cy="130" r="16" fill="#5c9c78">
                <animate attributeName="opacity" values="0;0.15;0" dur="2.5s" repeatCount="indefinite" begin="0s" />
              </circle>

              {/* Your Brand box — right */}
              <rect x="390" y="98" width="130" height="64" rx="10" fill="#1e2b22" stroke="#5c9c78" strokeWidth="1.5">
                <animate attributeName="strokeOpacity" values="0.3;0.9;0.3" dur="2s" repeatCount="indefinite" begin="0s" />
              </rect>
              <text x="455" y="124" textAnchor="middle" fill="#f4f2ec" fontSize="13" fontWeight="600">Your Brand</text>
              <text x="455" y="142" textAnchor="middle" fill="#5c9c78" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">RECOMMENDATIONS</text>
            </svg>
          </div>
        </div>

        {/* Bottom stats */}
        <div className="flex items-center gap-0">
          <div className="flex flex-col gap-0.5 pr-8">
            <span className="font-mono text-[20px] font-semibold text-ink-0">4</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-0/40">AI Models</span>
          </div>
          <div className="w-px h-8 bg-ink-0/15" />
          <div className="flex flex-col gap-0.5 px-8">
            <span className="font-mono text-[20px] font-semibold text-ink-0">1,400+</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-0/40">Prompts</span>
          </div>
          <div className="w-px h-8 bg-ink-0/15" />
          <div className="flex flex-col gap-0.5 pl-8">
            <span className="font-mono text-[20px] font-semibold text-ink-0">∞</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-0/40">Every Run Recorded</span>
          </div>
        </div>
      </div>

      {/* ── Right panel (light, ~45%) ──────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-16 bg-background overflow-y-auto">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
