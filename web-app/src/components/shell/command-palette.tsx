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
  ArrowRight,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'

interface PaletteItem {
  id: string
  label: string
  section: string
  href?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  hint?: string
}

const allItems: PaletteItem[] = [
  { id: 'dashboard', label: 'Dashboard', section: 'Navigation', href: '/dashboard', icon: LayoutDashboard, hint: '↵' },
  { id: 'runs', label: 'Runs', section: 'Navigation', href: '/runs', icon: Play, hint: '↵' },
  { id: 'visibility', label: 'Visibility', section: 'Navigation', href: '/visibility', icon: Eye, hint: '↵' },
  { id: 'keywords', label: 'Keywords', section: 'Navigation', href: '/keywords', icon: Hash, hint: '↵' },
  { id: 'geo-gaps', label: 'GEO Gaps', section: 'Navigation', href: '/geo-gaps', icon: Globe, hint: '↵' },
  { id: 'competitive', label: 'Competitive', section: 'Navigation', href: '/competitive', icon: Users, hint: '↵' },
  { id: 'opportunities', label: 'Opportunities', section: 'Navigation', href: '/opportunities', icon: Lightbulb, hint: '↵' },
  { id: 'content-intel', label: 'Content Intel', section: 'Navigation', href: '/content-intel', icon: FileText, hint: '↵' },
  { id: 'generate', label: 'Generate', section: 'Navigation', href: '/generate', icon: Sparkles, hint: '↵' },
  { id: 'publishing', label: 'Publishing', section: 'Navigation', href: '/publishing', icon: Send, hint: '↵' },
  { id: 'geo-agent', label: 'GEO Agent', section: 'Agents', href: '/geo-agent', icon: Bot, hint: '↵' },
  { id: 'seo-agent', label: 'SEO Agent', section: 'Agents', href: '/seo-agent', icon: Search, hint: '↵' },
  { id: 'growth-agent', label: 'Growth Agent', section: 'Agents', href: '/growth-agent', icon: TrendingUp, hint: '↵' },
  { id: 'actions', label: 'Actions', section: 'Manage', href: '/actions', icon: Zap, hint: '↵' },
  { id: 'experiments', label: 'Experiments', section: 'Manage', href: '/experiments', icon: FlaskConical, hint: '↵' },
  { id: 'reports', label: 'Reports', section: 'Manage', href: '/reports', icon: BarChart2, hint: '↵' },
  { id: 'notifications', label: 'Notifications', section: 'Org', href: '/notifications', icon: Bell, hint: '↵' },
  { id: 'billing', label: 'Billing', section: 'Org', href: '/billing', icon: CreditCard, hint: '↵' },
  { id: 'settings', label: 'Settings', section: 'Org', href: '/settings', icon: Settings, hint: '↵' },
]

const recentItems = allItems.slice(0, 3)

export function CommandPalette() {
  const router = useRouter()
  const open = useAppStore((s) => s.commandPaletteOpen)
  const close = useAppStore((s) => s.closeCommandPalette)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query.trim()
    ? allItems.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
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
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') { close(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flat.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
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
            className="fixed inset-0 z-50 bg-[var(--ink)]/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />

          {/* Panel */}
          <motion.div
            className="fixed z-50 left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2 bg-[var(--paper)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.94, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
              <Search size={16} className="text-[var(--dim)] shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages, actions…"
                className="flex-1 bg-transparent text-[var(--ink)] placeholder:text-[var(--dim)] text-sm outline-none"
              />
              <kbd className="text-[10px] text-[var(--dim)] bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 font-mono">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto py-2">
              {flat.length === 0 && (
                <p className="text-center text-sm text-[var(--dim)] py-8">No results found.</p>
              )}

              {Object.entries(grouped).map(([section, items]) => (
                <div key={section}>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)]">
                    {section}
                  </p>
                  {items.map((item) => {
                    const globalIdx = flat.indexOf(item)
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item)}
                        onMouseEnter={() => setActiveIdx(globalIdx)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors cursor-pointer',
                          globalIdx === activeIdx
                            ? 'bg-[var(--surface)] text-[var(--ink)]'
                            : 'text-[var(--dim)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'
                        )}
                      >
                        <Icon size={15} className="shrink-0" />
                        <span className="flex-1">{item.label}</span>
                        {globalIdx === activeIdx && (
                          <ArrowRight size={13} className="text-[var(--ember)]" />
                        )}
                        {item.hint && globalIdx !== activeIdx && (
                          <kbd className="text-[10px] bg-[var(--surface)] border border-[var(--border)] rounded px-1 py-0.5 font-mono">
                            {item.hint}
                          </kbd>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
