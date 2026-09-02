'use client'

import { motion } from 'framer-motion'

const INSIGHT_PILLS = [
  'ChatGPT mentions Competitor A 4×',
  'Gemini skips your brand in 67% of queries',
  '12 citation gaps found this week',
]

const SPRING = [0.16, 1, 0.3, 1] as const

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-paper">
      {/* ── Left · dark brand panel (50%) ────────────────────────────── */}
      <aside
        className="hidden md:flex relative overflow-hidden md:w-1/2 min-h-screen"
        style={{ background: 'var(--ink)' }}
      >
        {/* Dot grid texture */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(247,243,236,0.08) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Ember glow bottom-left */}
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            bottom: '-25%',
            left: '-15%',
            width: '80%',
            paddingBottom: '80%',
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(194,65,12,0.18) 0%, transparent 65%)',
          }}
        />

        {/* Vertically-centered single content column */}
        <div
          className="relative z-10 flex flex-col justify-center h-full w-full"
          style={{ padding: '4rem 4.5rem' }}
        >
          <div className="max-w-[420px]">
            {/* Logo */}
            <motion.div
              className="flex items-center gap-2.5 mb-14"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: SPRING }}
            >
              <span
                className="font-display font-bold text-[24px] tracking-[-0.02em]"
                style={{ color: 'var(--paper)' }}
              >
                BeBest
              </span>
              <span
                aria-hidden
                className="w-2 h-2 rounded-full"
                style={{
                  background: 'var(--ember)',
                  animation: 'pulse-ring 2s ease-in-out infinite',
                }}
              />
            </motion.div>

            {/* Eyebrow */}
            <motion.p
              className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-4"
              style={{ color: 'rgba(194,65,12,0.85)' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05, ease: SPRING }}
            >
              Recommendation Intelligence
            </motion.p>

            {/* Headline */}
            <motion.h1
              className="font-display font-semibold text-[32px] leading-[1.12] tracking-[-0.02em]"
              style={{ color: 'var(--paper)' }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: SPRING }}
            >
              See why AI recommends
              <br />
              your competitors.
            </motion.h1>

            {/* Description */}
            <motion.p
              className="mt-5 text-[14px] leading-[1.65] max-w-[340px]"
              style={{ color: 'rgba(247,243,236,0.60)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.25 }}
            >
              Measure how AI models describe your market, and rebuild the
              evidence they read.
            </motion.p>

            {/* Insight pills */}
            <div className="mt-10 flex flex-col gap-2.5 items-start">
              {INSIGHT_PILLS.map((pill, i) => (
                <motion.div
                  key={pill}
                  className="inline-flex items-center gap-2.5 rounded-full py-1.5 pl-3 pr-3.5"
                  style={{
                    background: 'rgba(247,243,236,0.04)',
                    border: '1px solid rgba(247,243,236,0.08)',
                  }}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.35,
                    delay: 0.4 + i * 0.07,
                    ease: SPRING,
                  }}
                >
                  <span
                    aria-hidden
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: 'var(--ember)' }}
                  />
                  <span
                    className="text-[12.5px] font-medium"
                    style={{ color: 'rgba(247,243,236,0.75)' }}
                  >
                    {pill}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom trust line (absolute) */}
        <motion.p
          className="absolute z-10 text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{
            color: 'rgba(247,243,236,0.30)',
            bottom: '2rem',
            left: '4.5rem',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          SOC 2 · SSO · GDPR Compliant
        </motion.p>
      </aside>

      {/* ── Right · form panel (50%) ─────────────────────────────────── */}
      <main
        role="main"
        className="flex-1 flex flex-col items-center justify-center px-6 py-10 md:px-10 md:py-12 min-h-screen"
      >
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="md:hidden mb-10 flex items-center justify-center gap-2">
            <span
              className="font-display font-bold text-[22px] tracking-[-0.02em]"
              style={{ color: 'var(--ember)' }}
            >
              BeBest
            </span>
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: 'var(--ember)',
                animation: 'pulse-ring 2s ease-in-out infinite',
              }}
            />
          </div>

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: SPRING }}
            className="w-full bg-white rounded-2xl border border-border shadow-[0_16px_48px_rgba(22,20,15,0.10),0_4px_16px_rgba(22,20,15,0.06)] p-8 md:p-9"
          >
            {children}
          </motion.div>

          {/* Footer */}
          <p className="text-[12px] text-dim text-center mt-8 font-medium">
            © 2026 BeBest ·{' '}
            <a
              href="#"
              className="hover:text-ink transition-colors underline-offset-2 hover:underline"
            >
              Privacy
            </a>
            {' · '}
            <a
              href="#"
              className="hover:text-ink transition-colors underline-offset-2 hover:underline"
            >
              Terms
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
