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
          <div className="w-full">
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
              <rect x="0" y="10" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeOpacity="0.25" strokeWidth="1" />
              <circle cx="22" cy="32" r="9" fill="#10a37f" />
              <text x="22" y="36" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">G</text>
              <text x="38" y="28" fill="#f4f2ec" fontSize="11" fontWeight="600">ChatGPT</text>
              <text x="38" y="42" fill="#a89c81" fontSize="9">OpenAI</text>

              {/* Claude */}
              <rect x="0" y="66" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeOpacity="0.25" strokeWidth="1" />
              <circle cx="22" cy="88" r="9" fill="#cc785c" />
              <text x="22" y="92" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">✳</text>
              <text x="38" y="84" fill="#f4f2ec" fontSize="11" fontWeight="600">Claude</text>
              <text x="38" y="98" fill="#a89c81" fontSize="9">Anthropic</text>

              {/* Gemini */}
              <rect x="0" y="122" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeOpacity="0.25" strokeWidth="1" />
              <circle cx="22" cy="144" r="9" fill="#4285f4" />
              <polygon points="22,137 26,144 22,151 18,144" fill="white" />
              <text x="38" y="140" fill="#f4f2ec" fontSize="11" fontWeight="600">Gemini</text>
              <text x="38" y="154" fill="#a89c81" fontSize="9">Google</text>

              {/* Perplexity */}
              <rect x="0" y="178" width="130" height="44" rx="8" fill="#1a1f17" stroke="#5c9c78" strokeOpacity="0.25" strokeWidth="1" />
              <circle cx="22" cy="200" r="9" fill="#20b2aa" />
              <text x="22" y="204" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">❄</text>
              <text x="38" y="196" fill="#f4f2ec" fontSize="11" fontWeight="600">Perplexity</text>
              <text x="38" y="210" fill="#a89c81" fontSize="9">AI</text>

              {/* Bezier curves — model outputs to brand */}
              <path d="M130 32 C260 32 260 130 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)" />
              <path d="M130 88 C255 88 255 128 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)" />
              <path d="M130 144 C255 144 260 132 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)" />
              <path d="M130 200 C260 200 260 132 390 130" stroke="url(#line-fade)" strokeWidth="1.5" filter="url(#glow-green)" />

              {/* Small circles on the paths */}
              <circle cx="200" cy="50" r="2.5" fill="#5c9c78" fillOpacity="0.6" />
              <circle cx="240" cy="95" r="2.5" fill="#5c9c78" fillOpacity="0.6" />
              <circle cx="250" cy="138" r="2.5" fill="#5c9c78" fillOpacity="0.6" />
              <circle cx="210" cy="178" r="2.5" fill="#5c9c78" fillOpacity="0.6" />

              {/* Label annotations floating near lines */}
              <text x="155" y="26" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">QUESTIONS</text>
              <text x="155" y="82" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">CITATIONS</text>
              <text x="148" y="138" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">BRAND MENTIONS</text>
              <text x="155" y="192" fill="#5c9c78" fillOpacity="0.55" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">SENTIMENT</text>

              {/* Your Brand box — right */}
              <rect x="390" y="98" width="130" height="64" rx="10" fill="#1e2b22" stroke="#5c9c78" strokeOpacity="0.45" strokeWidth="1.5" />
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
