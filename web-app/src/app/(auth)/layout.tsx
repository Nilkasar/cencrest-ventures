'use client'

import { motion } from 'framer-motion'

const INSIGHT_PILLS = [
  'ChatGPT mentions Competitor A 4×',
  'Gemini skips your brand in 67% of queries',
  '12 citation gaps found this week',
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Left column — dark brand panel */}
      <div
        className="hidden md:flex flex-col justify-between relative overflow-hidden"
        style={{ width: '55%', background: 'var(--ink)' }}
      >
        {/* Dot grid */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle, rgba(247,243,236,0.12) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            pointerEvents: 'none',
          }}
        />

        {/* Subtle ember glow */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: '-10%',
            left: '-5%',
            width: '55%',
            paddingBottom: '55%',
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(194,65,12,0.18) 0%, transparent 65%)',
            pointerEvents: 'none',
          }}
        />

        {/* Logo */}
        <div className="relative z-10 p-10">
          <motion.div
            className="flex items-center gap-2.5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <span
              className="font-display font-bold"
              style={{ fontSize: 28, color: 'var(--paper)', letterSpacing: '-0.02em' }}
            >
              BeBest
            </span>
            {/* Pulsing ember dot */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--ember)',
                display: 'inline-block',
                flexShrink: 0,
                animation: 'pulse-dot 2s ease-in-out infinite',
              }}
            />
          </motion.div>
        </div>

        {/* Center copy */}
        <div className="relative z-10 px-10 pb-0 flex-1 flex flex-col justify-center">
          <motion.h1
            className="font-display font-semibold leading-tight"
            style={{
              fontSize: 'clamp(2rem, 3.2vw, 3rem)',
              color: 'var(--paper)',
              letterSpacing: '-0.025em',
              maxWidth: 420,
            }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            See why AI recommends your competitors.
          </motion.h1>
          <motion.p
            className="mt-4 font-sans"
            style={{ fontSize: 15, color: 'var(--dim)', maxWidth: 380, lineHeight: 1.65 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            Recommendation intelligence for B2B brands that take evidence seriously.
          </motion.p>
        </div>

        {/* Floating insight pills — staggered float animation */}
        <div className="relative z-10 p-10 flex flex-col gap-3">
          {INSIGHT_PILLS.map((pill, i) => (
            <motion.div
              key={pill}
              className="inline-flex items-center gap-2.5 self-start"
              style={{
                background: 'rgba(247,243,236,0.06)',
                border: '1px solid rgba(247,243,236,0.12)',
                borderRadius: 999,
                padding: '7px 14px',
                animation: `pill-float 3.2s ease-in-out ${i * 0.55}s infinite`,
              }}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.5,
                delay: 0.55 + i * 0.12,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--ember)',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span className="font-sans" style={{ fontSize: 13, color: 'rgba(247,243,236,0.7)' }}>
                {pill}
              </span>
            </motion.div>
          ))}
        </div>

        <style>{`
          @keyframes pill-float {
            0%, 100% { transform: translateY(0); }
            50%       { transform: translateY(-4px); }
          }
        `}</style>
      </div>

      {/* Right column — form area */}
      <div
        role="main"
        className="flex-1 flex items-center justify-center px-6 py-10 min-h-screen"
        style={{ background: 'var(--paper)' }}
      >
        <div className="w-full" style={{ maxWidth: 420 }}>
          {/* Mobile logo — centered */}
          <div className="md:hidden mb-8 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className="font-display font-bold"
                style={{ fontSize: 26, color: 'var(--ember)', letterSpacing: '-0.02em' }}
              >
                BeBest
              </span>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--ember)',
                  display: 'inline-block',
                  flexShrink: 0,
                  animation: 'pulse-dot 2s ease-in-out infinite',
                }}
              />
            </div>
            <p
              className="font-sans text-center"
              style={{ fontSize: 12, color: 'var(--dim)', maxWidth: 260 }}
            >
              Recommendation intelligence for B2B brands.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
