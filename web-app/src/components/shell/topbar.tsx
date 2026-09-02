'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bell, Menu, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store/app-store'
import { getStoredUser } from '@/lib/auth-storage'
import { cn } from '@/lib/utils'

/* ── Breadcrumb ────────────────────────────────────────────────────────── */
function Breadcrumb() {
  const pathname    = usePathname()
  const currentOrg  = useAppStore((s) => s.currentOrg)
  const currentBrand = useAppStore((s) => s.currentBrand)

  const segments = pathname.split('/').filter(Boolean)
  const pageSeg  = segments[segments.length - 1] ?? 'dashboard'
  const pageLabel = pageSeg
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <nav className="flex items-center gap-1.5 font-sans min-w-0" aria-label="Breadcrumb">
      {currentOrg && (
        <>
          <span className="text-[13px] text-dim font-medium truncate max-w-[100px]">
            {currentOrg.name}
          </span>
          <ChevronRight size={12} className="text-border-strong shrink-0" />
        </>
      )}
      {currentBrand && (
        <>
          <span className="text-[13px] text-dim font-medium truncate max-w-[100px]">
            {currentBrand.name}
          </span>
          <ChevronRight size={12} className="text-border-strong shrink-0" />
        </>
      )}
      <span className="text-[13px] text-ink font-semibold truncate">
        {pageLabel}
      </span>
    </nav>
  )
}

/* ── Avatar initials helper ────────────────────────────────────────────── */
function getInitials(name?: string, email?: string): string {
  const src = name ?? email ?? ''
  return src
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/* ── Topbar ────────────────────────────────────────────────────────────── */
export function Topbar() {
  const togglePalette       = useAppStore((s) => s.toggleCommandPalette)
  const toggleMobileSidebar = useAppStore((s) => s.toggleMobileSidebar)
  const [notifOpen, setNotifOpen] = useState(false)

  const user       = getStoredUser()
  const initials   = getInitials(user?.name, user?.email)
  const unreadCount = 0

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex items-center justify-between bg-paper',
        'border-b border-border',
        'px-5 lg:px-7'
      )}
      style={{ height: 56 }}
    >
      {/* Left: hamburger (mobile) + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggleMobileSidebar}
          className="lg:hidden flex items-center justify-center w-8 h-8 rounded-md text-dim hover:text-ink hover:bg-surface transition-colors cursor-pointer"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <Breadcrumb />
      </div>

      {/* Right: ⌘K + bell + avatar */}
      <div className="flex items-center gap-1 shrink-0 ml-4">

        {/* ⌘K pill */}
        <button
          onClick={togglePalette}
          className={cn(
            'hidden sm:flex items-center gap-1.5 rounded-md font-mono',
            'bg-surface border border-border hover:border-border-strong hover:bg-surface-raised',
            'text-dim hover:text-ink text-[11px] transition-all duration-150 cursor-pointer'
          )}
          style={{ padding: '3px 9px', letterSpacing: '0.02em' }}
          aria-label="Open command palette (⌘K)"
        >
          <span className="text-[10px] opacity-70">⌘K</span>
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative flex items-center justify-center w-8 h-8 rounded-md text-dim hover:text-ink hover:bg-surface transition-colors cursor-pointer"
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-ember ring-[1.5px] ring-paper"
                aria-hidden="true"
              />
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setNotifOpen(false)}
                />
                <motion.div
                  className="absolute right-0 top-10 z-50 w-72 bg-surface-raised border border-border rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(22,20,15,0.12),0_2px_8px_rgba(22,20,15,0.06)]"
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                >
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-ink">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="text-xs font-semibold text-ember">
                        {unreadCount} unread
                      </span>
                    )}
                  </div>
                  <div className="py-8 text-center text-[13px] text-dim font-sans">
                    No new notifications
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Avatar */}
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-ember text-paper',
            'font-sans font-semibold text-[11px] select-none shrink-0 cursor-pointer',
            'transition-all hover:ring-2 hover:ring-ember/30 hover:ring-offset-1 hover:ring-offset-paper'
          )}
          style={{ width: 30, height: 30 }}
          role="button"
          title={user?.name ?? user?.email ?? 'Account'}
          tabIndex={0}
        >
          {initials || '?'}
        </div>
      </div>
    </header>
  )
}
