'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bell, Menu, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store/app-store'
import { getStoredUser } from '@/lib/auth-storage'
import { cn } from '@/lib/utils'

function getInitials(name: string | undefined, email: string | undefined): string {
  const source = name ?? email ?? ''
  return source
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function Breadcrumb() {
  const pathname = usePathname()
  const currentOrg = useAppStore((s) => s.currentOrg)
  const currentBrand = useAppStore((s) => s.currentBrand)

  const segments = pathname.split('/').filter(Boolean)
  // Last meaningful segment as the page label
  const pageSeg = segments[segments.length - 1] ?? 'dashboard'
  const pageLabel = pageSeg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <nav className="flex items-center gap-1.5 font-sans text-sm min-w-0">
      {currentOrg && (
        <>
          <span
            className="truncate max-w-[100px] text-[var(--dim)]"
            style={{ fontSize: 13 }}
          >
            {currentOrg.name}
          </span>
          <ChevronRight size={12} className="text-[var(--border-strong)] flex-shrink-0" />
        </>
      )}
      {currentBrand && (
        <>
          <span
            className="truncate max-w-[100px] text-[var(--dim)]"
            style={{ fontSize: 13 }}
          >
            {currentBrand.name}
          </span>
          <ChevronRight size={12} className="text-[var(--border-strong)] flex-shrink-0" />
        </>
      )}
      <span
        className="font-medium text-[var(--ink)] truncate"
        style={{ fontSize: 13 }}
      >
        {pageLabel}
      </span>
    </nav>
  )
}

export function Topbar() {
  const togglePalette = useAppStore((s) => s.toggleCommandPalette)
  const toggleMobileSidebar = useAppStore((s) => s.toggleMobileSidebar)
  const [notifOpen, setNotifOpen] = useState(false)

  const user = getStoredUser()
  const initials = getInitials(user?.name, user?.email)
  const unreadCount = 3 // placeholder

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex items-center justify-between px-4 bg-[var(--paper)] border-b border-[var(--border)]'
      )}
      style={{ height: 52 }}
    >
      {/* Left: hamburger + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile hamburger */}
        <button
          onClick={toggleMobileSidebar}
          className={cn(
            'lg:hidden flex items-center justify-center rounded-md p-1.5',
            'text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer'
          )}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        <Breadcrumb />
      </div>

      {/* Right: ⌘K + bell + avatar */}
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-4">
        {/* ⌘K pill */}
        <button
          onClick={togglePalette}
          className={cn(
            'hidden sm:flex items-center gap-1.5 rounded-lg transition-colors cursor-pointer font-mono',
            'border border-[var(--border)] hover:border-[var(--ember)]',
            'text-[var(--dim)]'
          )}
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          <span>⌘K</span>
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative flex items-center justify-center w-9 h-9 rounded-md text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
            aria-label="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--ember)]"
                aria-hidden
              />
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <>
                {/* backdrop to close */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setNotifOpen(false)}
                />
                <motion.div
                  className="absolute right-0 top-11 z-50 w-72 bg-[var(--paper)] border border-[var(--border)] rounded-xl shadow-lg overflow-hidden"
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                    <span className="font-sans text-sm font-medium text-[var(--ink)]">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="font-sans text-xs font-medium text-[var(--ember)]">
                        {unreadCount} unread
                      </span>
                    )}
                  </div>
                  <div className="py-8 text-center font-sans text-sm text-[var(--dim)]">
                    No new notifications
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Avatar */}
        <div
          className="flex items-center justify-center rounded-full bg-[var(--ember)] text-white font-sans font-semibold select-none flex-shrink-0"
          style={{ width: 32, height: 32, fontSize: 12 }}
          title={user?.name ?? user?.email ?? 'Account'}
        >
          {initials || '?'}
        </div>
      </div>
    </header>
  )
}
