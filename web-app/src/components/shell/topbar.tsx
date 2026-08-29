'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Search, Bell, ChevronDown, Settings, LogOut, User } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'

function BreadCrumb() {
  const pathname = usePathname()
  const currentBrand = useAppStore((s) => s.currentBrand)
  const segment = pathname.split('/').filter(Boolean)[0] ?? 'dashboard'
  const label = segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="flex items-center gap-2 text-sm">
      {currentBrand && (
        <>
          <span className="text-[var(--dim)]">{currentBrand.name}</span>
          <span className="text-[var(--border-strong)]">/</span>
        </>
      )}
      <span className="font-medium text-[var(--ink)]">{label}</span>
    </div>
  )
}

export function Topbar() {
  const togglePalette = useAppStore((s) => s.toggleCommandPalette)
  const [notifOpen, setNotifOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const unreadCount = 3 // placeholder

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-6 bg-[var(--paper)]/90 backdrop-blur-sm border-b border-[var(--border)]">
      <BreadCrumb />

      <div className="flex items-center gap-2">
        {/* Search / command palette trigger */}
        <button
          onClick={togglePalette}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm',
            'text-[var(--dim)] bg-[var(--surface)] border border-[var(--border)]',
            'hover:border-[var(--border-strong)] transition-colors cursor-pointer'
          )}
        >
          <Search size={14} />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline text-[10px] bg-[var(--paper)] border border-[var(--border)] rounded px-1 py-0.5 font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => { setNotifOpen(!notifOpen); setUserOpen(false) }}
            className="relative p-2 rounded-md text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--ember)]" />
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <motion.div
                className="absolute right-0 top-10 w-72 bg-[var(--paper)] border border-[var(--border)] rounded-xl shadow-lg overflow-hidden"
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--ink)]">Notifications</span>
                  <span className="text-xs text-[var(--ember)] font-medium">{unreadCount} unread</span>
                </div>
                <div className="p-3 text-sm text-[var(--dim)] text-center py-6">
                  No new notifications
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => { setUserOpen(!userOpen); setNotifOpen(false) }}
            className="flex items-center gap-1.5 p-1.5 rounded-md hover:bg-[var(--surface)] transition-colors cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[var(--ember)]/20 flex items-center justify-center">
              <User size={14} className="text-[var(--ember)]" />
            </div>
            <ChevronDown size={13} className={cn('text-[var(--dim)] transition-transform', userOpen && 'rotate-180')} />
          </button>

          <AnimatePresence>
            {userOpen && (
              <motion.div
                className="absolute right-0 top-10 w-48 bg-[var(--paper)] border border-[var(--border)] rounded-xl shadow-lg overflow-hidden"
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="p-1">
                  <a
                    href="/settings/profile"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
                  >
                    <Settings size={14} className="text-[var(--dim)]" />
                    Settings
                  </a>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[var(--danger)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
                    onClick={() => { /* handle logout */ }}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  )
}
