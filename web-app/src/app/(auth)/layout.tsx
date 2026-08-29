'use client'

import { motion } from 'framer-motion'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex flex-col bg-[var(--paper)] overflow-hidden">
      {/* Animated gradient orb */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: '60vw',
          height: '60vw',
          maxWidth: 700,
          maxHeight: 700,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 40% 40%, rgba(194,65,12,0.18) 0%, rgba(194,65,12,0.06) 50%, transparent 70%)',
          animation: 'orb-drift 12s ease-in-out infinite alternate',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-15%',
          left: '-5%',
          width: '45vw',
          height: '45vw',
          maxWidth: 500,
          maxHeight: 500,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 60% 60%, rgba(194,65,12,0.10) 0%, transparent 65%)',
          animation: 'orb-drift 16s ease-in-out infinite alternate-reverse',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <style>{`
        @keyframes orb-drift {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(30px, 20px) scale(1.08); }
        }
      `}</style>

      {/* Brand mark */}
      <header className="relative z-10 p-6">
        <span
          className="font-display text-[var(--ember)] font-semibold"
          style={{ fontSize: 24 }}
        >
          BeBest
        </span>
      </header>

      {/* Page content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <motion.div
          className="w-full"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  )
}
