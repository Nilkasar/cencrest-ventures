'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Eye,
  Globe,
  Users,
  Lightbulb,
  FileText,
  Sparkles,
  Send,
  Bot,
  Zap,
  FlaskConical,
  BarChart2,
  Bell,
  Settings,
  ChevronDown,
  X,
  Tag,
  Search,
  BookOpen,
  Camera,
  GraduationCap,
  Megaphone,
  RadioTower,
  Cpu,
  Layers,
  Play,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { clearToken, getStoredUser } from '@/lib/auth-storage'

/* ── Types ────────────────────────────────────────────────────────────── */
interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
}
interface NavGroup {
  label: string
  items: NavItem[]
}

/* ── Nav structure ────────────────────────────────────────────────────── */
function buildNavGroups(slug: string, brandId: string | null): NavGroup[] {
  const b = brandId ? `/${slug}/brands/${brandId}` : null
  return [
    {
      label: 'Overview',
      items: [
        { href: `/${slug}/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
        { href: `/${slug}/brands`,    label: 'Brands',    icon: Tag },
      ],
    },
    {
      label: 'Visibility',
      items: [
        { href: b ? `${b}/visibility/runs` : '#', label: 'AI Runs',     icon: Play },
        { href: b ? `${b}/visibility`      : '#', label: 'Visibility',  icon: Eye },
        { href: b ? `${b}/competitive`     : '#', label: 'Competitive', icon: Users },
      ],
    },
    {
      label: 'SEO & GEO',
      items: [
        { href: b ? `${b}/seo` : '#', label: 'SEO',      icon: Search },
        { href: b ? `${b}/geo` : '#', label: 'GEO Gaps', icon: Globe },
      ],
    },
    {
      label: 'Content',
      items: [
        { href: b ? `${b}/content`            : '#', label: 'Content Intel',      icon: FileText },
        { href: b ? `${b}/content-generation` : '#', label: 'Content Generation', icon: Sparkles },
        { href: b ? `${b}/publishing`         : '#', label: 'Publishing',         icon: Send },
      ],
    },
    {
      label: 'AI Agents',
      items: [
        { href: b ? `${b}/agents`     : '#', label: 'Agents',     icon: Bot },
        { href: b ? `${b}/autonomous` : '#', label: 'Autonomous', icon: Cpu },
      ],
    },
    {
      label: 'Growth',
      items: [
        { href: b ? `${b}/opportunities` : '#', label: 'Opportunities', icon: Lightbulb },
        { href: b ? `${b}/actions`       : '#', label: 'Actions',       icon: Zap },
        { href: b ? `${b}/experiments`   : '#', label: 'Experiments',   icon: FlaskConical },
        { href: b ? `${b}/marketing`     : '#', label: 'Marketing',     icon: Megaphone },
      ],
    },
    {
      label: 'Intelligence',
      items: [
        { href: b ? `${b}/reports`   : '#', label: 'Reports',   icon: BarChart2 },
        { href: b ? `${b}/snapshots` : '#', label: 'Snapshots', icon: Camera },
        { href: b ? `${b}/learning`  : '#', label: 'Learning',  icon: GraduationCap },
      ],
    },
    {
      label: 'Organization',
      items: [
        { href: `/${slug}/notifications`, label: 'Notifications', icon: Bell },
        { href: `/${slug}/stories`,       label: 'Stories',       icon: BookOpen },
        { href: `/${slug}/agency`,        label: 'Agency',        icon: Layers },
        { href: `/${slug}/white-label`,   label: 'White Label',   icon: RadioTower },
        { href: `/${slug}/settings`,      label: 'Settings',      icon: Settings },
      ],
    },
  ]
}

/* ── NavItemLink ──────────────────────────────────────────────────────── */
function NavItemLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={cn(
        'group relative flex items-center gap-2.5 text-[13px] font-medium font-sans rounded-md no-underline',
        'transition-colors duration-[120ms]',
        'h-8 px-3',
        isActive
          ? 'bg-[rgba(194,65,12,0.14)] text-[#F7F3EC]'
          : 'text-[rgba(247,243,236,0.48)] hover:bg-[rgba(247,243,236,0.06)] hover:text-[rgba(247,243,236,0.9)]'
      )}
    >
      {/* Left accent bar for active state */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-ember"
        />
      )}
      <Icon
        size={14}
        className={cn(
          'shrink-0 transition-opacity duration-[120ms]',
          isActive
            ? 'opacity-90 text-ember'
            : 'opacity-45 group-hover:opacity-80'
        )}
      />
      <span className="truncate leading-none">{item.label}</span>
    </Link>
  )
}

/* ── Live indicator dot ───────────────────────────────────────────────── */
function LiveDot() {
  return (
    <span className="relative inline-flex w-2 h-2 shrink-0">
      <span className="absolute inset-0 rounded-full bg-ember animate-[pulse-ring_2s_ease-in-out_infinite]" />
      <span className="relative inline-block w-2 h-2 rounded-full bg-ember" />
    </span>
  )
}

/* ── Sidebar content (shared between desktop + mobile) ────────────────── */
function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const currentOrg   = useAppStore((s) => s.currentOrg)
  const currentBrand = useAppStore((s) => s.currentBrand)
  const [orgOpen, setOrgOpen] = useState(false)

  const slug    = currentOrg?.slug ?? ''
  const brandId = currentBrand?.id ?? null
  const navGroups = buildNavGroups(slug, brandId)

  const user      = getStoredUser()
  const userEmail = user?.email ?? ''
  const initials  = (user?.name ?? userEmail)
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()

  function handleLogout() {
    clearToken()
    window.location.href = '/login'
  }

  return (
    <div className="flex flex-col h-full bg-ink overflow-hidden">

      {/* ── Header: logo + org selector ─────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-5 pb-4 border-b border-[rgba(247,243,236,0.07)] shrink-0">
        <div className="flex flex-col gap-1.5 min-w-0">
          {/* Wordmark */}
          <div className="flex items-center gap-2">
            <span
              className="font-display font-bold text-paper tracking-tight"
              style={{ fontSize: 20, letterSpacing: '-0.025em' }}
            >
              BeBest
            </span>
            <LiveDot />
          </div>

          {/* Org selector */}
          <button
            onClick={() => setOrgOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-[rgba(247,243,236,0.40)] hover:text-[rgba(247,243,236,0.75)] transition-colors bg-none border-none p-0 cursor-pointer font-sans"
          >
            <span className="truncate max-w-[140px]">
              {currentOrg?.name ?? 'Select org'}
            </span>
            <ChevronDown
              size={11}
              className="shrink-0 transition-transform duration-200"
              style={{ transform: orgOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden flex items-center justify-center w-7 h-7 rounded-md text-[rgba(247,243,236,0.30)] hover:text-[rgba(247,243,236,0.70)] hover:bg-[rgba(247,243,236,0.06)] transition-colors cursor-pointer border-none bg-none"
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* ── Navigation ──────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.09em] text-[rgba(247,243,236,0.28)] font-sans select-none">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavItemLink
                  key={item.href}
                  item={item}
                  isActive={
                    pathname === item.href ||
                    (item.href !== '#' && pathname.startsWith(item.href + '/'))
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer: user ────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-t border-[rgba(247,243,236,0.07)] flex items-center gap-2.5">
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-ember flex items-center justify-center shrink-0">
          <span className="font-sans text-[10px] font-semibold text-paper leading-none">
            {initials || '?'}
          </span>
        </div>

        <p className="font-sans text-xs text-[rgba(247,243,236,0.45)] flex-1 min-w-0 truncate">
          {userEmail || 'Account'}
        </p>

        <button
          onClick={handleLogout}
          title="Sign out"
          className="flex items-center justify-center w-6 h-6 rounded text-[rgba(247,243,236,0.28)] hover:text-danger hover:bg-[rgba(247,243,236,0.06)] transition-colors shrink-0 cursor-pointer border-none bg-none"
          aria-label="Sign out"
        >
          <LogOut size={13} />
        </button>
      </div>
    </div>
  )
}

/* ── Exported Sidebar ─────────────────────────────────────────────────── */
export function Sidebar() {
  const mobileOpen         = useAppStore((s) => s.mobileSidebarOpen)
  const closeMobileSidebar = useAppStore((s) => s.closeMobileSidebar)

  const SIDEBAR_W = 260

  return (
    <>
      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ background: 'rgba(22,20,15,0.55)', backdropFilter: 'blur(3px)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeMobileSidebar}
            />
            <motion.aside
              className="fixed left-0 top-0 bottom-0 z-50 lg:hidden"
              style={{ width: SIDEBAR_W, boxShadow: '6px 0 48px rgba(0,0,0,0.45)' }}
              initial={{ x: -SIDEBAR_W }}
              animate={{ x: 0 }}
              exit={{ x: -SIDEBAR_W }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            >
              <SidebarContent onClose={closeMobileSidebar} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop fixed */}
      <aside
        className="hidden lg:block fixed left-0 top-0 bottom-0 z-40"
        style={{ width: SIDEBAR_W }}
      >
        <SidebarContent />
      </aside>
    </>
  )
}
