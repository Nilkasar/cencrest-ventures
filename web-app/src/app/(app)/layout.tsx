'use client'

import { motion } from 'framer-motion'
import { Providers } from '@/components/providers'
import { Sidebar } from '@/components/shell/sidebar'
import { Topbar } from '@/components/shell/topbar'
import { CommandPalette } from '@/components/shell/command-palette'
import { useAppStore } from '@/store/app-store'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'

function AppShellInner({ children }: { children: React.ReactNode }) {
  const togglePalette = useAppStore((s) => s.toggleCommandPalette)
  useKeyboardShortcut('k', togglePalette, { meta: true })

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <Sidebar />
      <div className="lg:pl-60 flex flex-col min-h-screen">
        <Topbar />
        <motion.main
          className="flex-1 px-6 py-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.main>
      </div>
      <CommandPalette />
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShellInner>{children}</AppShellInner>
    </Providers>
  )
}
