'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  LayoutDashboard,
  Play,
  Eye,
  Hash,
  Globe,
  Users,
  Lightbulb,
  FileText,
  Sparkles,
  Send,
  Bot,
  TrendingUp,
  Zap,
  FlaskConical,
  BarChart2,
  Bell,
  CreditCard,
  Settings,
  CornerDownLeft,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'

interface PaletteItem {
  id: string
  label: string
  section: string
  href?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const allItems: PaletteItem[] = [
  { id: 'dashboard',    label: 'Dashboard',      section: 'Navigate', href: '/dashboard',    icon: LayoutDashboard },
  { id: 'runs',         label: 'AI Runs',        section: 'Navigate', href: '/runs',         icon: Play },
  { id: 'visibility',  label: 'Visibility',     section: 'Navigate', href: '/visibility',   icon: Eye },
  { id: 'keywords',    label: 'Keywords',       section: 'Navigate', href: '/keywords',     icon: Hash },
  { id: 'geo-gaps',    label: 'GEO Gaps',       section: 'Navigate', href: '/geo-gaps',     icon: Globe },
  { id: 'competitive', label: 'Competitive',    section: 'Navigate', href: '/competitive',  icon: Users },
  { id: 'opps',        label: 'Opportunities',  section: 'Navigate', href: '/opportunities',icon: Lightbulb },
  { id: 'content',     label: 'Content Intel',  section: 'Navigate', href: '/content-intel',icon: FileText },
  { id: 'generate',    label: 'Generate',       section: 'Navigate', href: '/generate',     icon: Sparkles },
  { id: 'publishing',  label: 'Publishing',     section: 'Navigate', href: '/publishing',   icon: Send },
  { id: 'geo-agent',   label: 'GEO Agent',      section: 'Agents',   href: '/geo-agent',    icon: Bot },
  { id: 'seo-agent',   label: 'SEO Agent',      section: 'Agents',   href: '/seo-agent',    icon: Search },
  { id: 'growth-agent',label: 'Growth Agent',   section: 'Agents',   href: '/growth-agent', icon: TrendingUp },
  { id: 'actions',     label: 'Actions',        section: 'Manage',   href: '/actions',      icon: Zap },
  { id: 'experiments', label: 'Experiments',    section: 'Manage',   href: '/experiments',  icon: FlaskConical },
  { id: 'reports',     label: 'Reports',        section: 'Manage',   href: '/reports',      icon: BarChart2 },
  { id: 'notifications',label: 'Notifications', section: 'Org',      href: '/notifications',icon: Bell },
  { id: 'billing',     label: 'Billing',        section: 'Org',      href: '/billing',      icon: CreditCard },
  { id: 'settings',    label: 'Settings',       section: 'Org',      href: '/settings',     icon: Settings },
]

const recentItems = allItems.slice(0, 4)

export function CommandPalette() {
  const router = useRouter()
  const open  = useAppStore((s) => s.commandPaletteOpen)
  const close = useAppStore((s) => s.closeCommandPalette)

  const [query, setQuery]       = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? allItems.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()) ||
        i.section.toLowerCase().includes(query.toLowerCase())
      )
    : recentItems

  const grouped = filtered.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    const section = query.trim() ? item.section : 'Recent'
    if (!acc[section]) acc[section] = []
    acc[section].push(item)
    return acc
  }, {})

  const flat = Object.values(grouped).flat()

  const navigate = useCallback(
    (item: PaletteItem) => {
      if (item.href) router.push(item.href)
      close()
      setQuery('')
    },
    [router, close]
  )

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  useEffect(() => { setActiveIdx(0) }, [query])

  /* Scroll active item into view */
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-active="true"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') { close(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flat.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter') { e.preventDefault(); if (flat[activeIdx]) navigate(flat[activeIdx]) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, flat, activeIdx, navigate, close])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[500] bg-ink/35 backdrop-blur-[4px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={close}
          />

          {/* Panel */}
          <motion.div
            className="fixed z-[501] left-1/2 top-[18%] w-full max-w-[560px] -translate-x-1/2 px-4"
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: 'spring', stiffness: 440, damping: 34 }}
          >
            <div className="rounded-2xl border border-border bg-surface-raised overflow-hidden shadow-[0_24px_64px_rgba(22,20,15,0.18),0_8px_24px_rgba(22,20,15,0.10)]">

              {/* Search row */}
              <div className="relative flex items-center border-b border-border">
                <Search size={15} className="absolute left-5 text-dim shrink-0 pointer-events-none" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search pages, actions, agents…"
                  className={cn(
                    'w-full pl-11 pr-5 py-4 bg-transparent',
                    'text-[15px] text-ink placeholder:text-dim/60 font-sans',
                    'outline-none border-0'
                  )}
                />
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-[380px] overflow-y-auto py-2">
                {flat.length === 0 && (
                  <p className="text-center text-[13px] text-dim py-10">
                    No results for &ldquo;{query}&rdquo;
                  </p>
                )}

                {Object.entries(grouped).map(([section, items]) => (
                  <div key={section}>
                    <p className="px-5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.09em] text-dim/80 font-sans">
                      {section}
                    </p>
                    {items.map((item) => {
                      const globalIdx = flat.indexOf(item)
                      const Icon = item.icon
                      const isActive = globalIdx === activeIdx
                      return (
                        <button
                          key={item.id}
                          data-active={isActive}
                          onClick={() => navigate(item)}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                          className={cn(
                            'w-full flex items-center gap-3 mx-2 px-3 py-2.5 text-[13px] text-left rounded-lg transition-colors cursor-pointer',
                            'w-[calc(100%-16px)]',
                            isActive
                              ? 'bg-ember/10 text-ember'
                              : 'text-ink hover:bg-surface'
                          )}
                        >
                          <Icon
                            size={14}
                            className={cn('shrink-0', isActive ? 'text-ember' : 'text-dim')}
                          />
                          <span className="flex-1 font-medium">{item.label}</span>
                          {isActive && (
                            <CornerDownLeft size={12} className="text-ember shrink-0 opacity-70" />
                          )}
                          {!isActive && (
                            <kbd className="hidden sm:inline-flex items-center text-[10px] bg-surface border border-border rounded px-1.5 py-0.5 font-mono text-dim leading-none">
                              ↵
                            </kbd>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              <div className="px-5 py-2 border-t border-border bg-surface/40 flex items-center gap-5 text-[11px] text-dim font-sans">
                <span className="flex items-center gap-1.5">
                  <kbd className="font-mono bg-surface border border-border rounded px-1 py-0.5 text-[10px]">↑</kbd>
                  <kbd className="font-mono bg-surface border border-border rounded px-1 py-0.5 text-[10px]">↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="font-mono bg-surface border border-border rounded px-1 py-0.5 text-[10px]">↵</kbd>
                  open
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="font-mono bg-surface border border-border rounded px-1 py-0.5 text-[10px]">esc</kbd>
                  close
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
