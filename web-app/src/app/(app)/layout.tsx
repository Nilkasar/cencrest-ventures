'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Providers } from '@/components/providers'
import { Sidebar } from '@/components/shell/sidebar'
import { Topbar } from '@/components/shell/topbar'
import { CommandPalette } from '@/components/shell/command-palette'
import { useAppStore } from '@/store/app-store'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import { getToken, getStoredUser } from '@/lib/auth-storage'
import { api, routes } from '@/lib/api'

function AppShellInner({ children }: { children: React.ReactNode }) {
  const togglePalette = useAppStore((s) => s.toggleCommandPalette)
  const setOrg        = useAppStore((s) => s.setOrg)
  const setBrand      = useAppStore((s) => s.setBrand)
  const router        = useRouter()
  const params        = useParams()
  const slug          = params?.slug as string | undefined
  const brandId       = params?.brandId as string | undefined

  useKeyboardShortcut('k', togglePalette, { meta: true })

  /* ── Auth guard + org hydration ────────────────────────────────────── */
  useEffect(() => {
    const token = getToken()
    if (!token) {
      router.replace('/login')
      return
    }
    if (slug) {
      api
        .get<{ id: string; name: string; slug: string }>(routes.org(slug))
        .then((org) => setOrg({ id: org.id, name: org.name, slug: org.slug }))
        .catch(() => router.replace('/login'))
    }
  }, [slug, setOrg, router])

  /* ── Brand hydration ────────────────────────────────────────────────── */
  useEffect(() => {
    if (slug && brandId) {
      api
        .get<{ id: string; name: string }>(routes.brand(slug, brandId))
        .then((brand) => setBrand({ id: brand.id, name: brand.name }))
        .catch(() => {})
    } else if (!brandId) {
      setBrand(null)
    }
  }, [slug, brandId, setBrand])

  return (
    <div className="min-h-screen bg-paper flex">
      <Sidebar />

      {/* Content column — pushed right of the fixed sidebar on desktop */}
      <div className="app-main flex flex-col min-h-screen flex-1 min-w-0">
        <Topbar />
        <motion.main
          className="flex-1 px-6 py-7 lg:px-8 lg:py-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
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
