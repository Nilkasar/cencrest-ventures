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
  Menu,
  User,
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  brandScoped?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

function buildNavGroups(slug: string, brandId: string | null): NavGroup[] {
  const b = brandId ? `/${slug}/brands/${brandId}` : null

  return [
    {
      label: 'Overview',
      items: [
        { href: `/${slug}/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
        { href: `/${slug}/brands`, label: 'Brands', icon: Tag },
      ],
    },
    {
      label: 'Visibility',
      items: [
        { href: b ? `${b}/visibility/runs` : '#', label: 'AI Runs', icon: Play },
        { href: b ? `${b}/visibility` : '#', label: 'Visibility', icon: Eye },
        { href: b ? `${b}/competitive` : '#', label: 'Competitive', icon: Users },
      ],
    },
    {
      label: 'SEO & GEO',
      items: [
        { href: b ? `${b}/seo` : '#', label: 'SEO', icon: Search },
        { href: b ? `${b}/geo` : '#', label: 'GEO Gaps', icon: Globe },
      ],
    },
    {
      label: 'Content',
      items: [
        { href: b ? `${b}/content` : '#', label: 'Content Intelligence', icon: FileText },
        { href: b ? `${b}/content-generation` : '#', label: 'Content Generation', icon: Sparkles },
        { href: b ? `${b}/publishing` : '#', label: 'Publishing', icon: Send },
      ],
    },
    {
      label: 'AI Agents',
      items: [
        { href: b ? `${b}/agents` : '#', label: 'Agents', icon: Bot },
        { href: b ? `${b}/autonomous` : '#', label: 'Autonomous', icon: Cpu },
      ],
    },
    {
      label: 'Growth',
      items: [
        { href: b ? `${b}/opportunities` : '#', label: 'Opportunities', icon: Lightbulb },
        { href: b ? `${b}/actions` : '#', label: 'Actions', icon: Zap },
        { href: b ? `${b}/experiments` : '#', label: 'Experiments', icon: FlaskConical },
        { href: b ? `${b}/marketing` : '#', label: 'Marketing', icon: Megaphone },
      ],
    },
    {
      label: 'Intelligence',
      items: [
        { href: b ? `${b}/reports` : '#', label: 'Reports', icon: BarChart2 },
        { href: b ? `${b}/snapshots` : '#', label: 'Snapshots', icon: Camera },
        { href: b ? `${b}/learning` : '#', label: 'Learning', icon: GraduationCap },
      ],
    },
    {
      label: 'Organization',
      items: [
        { href: `/${slug}/notifications`, label: 'Notifications', icon: Bell },
        { href: `/${slug}/stories`, label: 'Stories', icon: BookOpen },
        { href: `/${slug}/agency`, label: 'Agency', icon: Layers },
        { href: `/${slug}/white-label`, label: 'White Label', icon: RadioTower },
        { href: `/${slug}/settings`, label: 'Settings', icon: Settings },
      ],
    },
  ]
}

function NavItemLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 cursor-pointer',
        isActive
          ? 'text-[var(--ember)] bg-[var(--surface)]'
          : 'text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
      )}
    >
      {isActive && (
        <motion.span
          layoutId="nav-active"
          className="absolute left-0 top-1 bottom-1 w-0.5 bg-[var(--ember)] rounded-full"
        />
      )}
      <Icon size={15} className="shrink-0" />
      <span>{item.label}</span>
    </Link>
  )
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const currentOrg = useAppStore((s) => s.currentOrg)
  const currentBrand = useAppStore((s) => s.currentBrand)
  const [orgOpen, setOrgOpen] = useState(false)

  const slug = currentOrg?.slug ?? ''
  const brandId = currentBrand?.id ?? null
  const navGroups = buildNavGroups(slug, brandId)

  return (
    <div className="flex flex-col h-full">
      {/* Top: brand selector */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setOrgOpen(!orgOpen)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--ink)] hover:text-[var(--ember)] transition-colors cursor-pointer"
          >
            <span className="font-display font-semibold text-[var(--ember)] text-base">BeBest</span>
            <span className="text-[var(--dim)] max-w-[120px] truncate">
              {currentOrg?.name ?? 'Select org'}
            </span>
            <ChevronDown size={14} className={cn('transition-transform', orgOpen && 'rotate-180')} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-[var(--dim)] hover:text-[var(--ink)] cursor-pointer lg:hidden"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)]">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemLink
                  key={item.href}
                  item={item}
                  isActive={pathname === item.href || pathname.startsWith(item.href + '/')}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: user */}
      <div className="p-4 border-t border-[var(--border)]">
        <Link
          href="/settings/profile"
          className="flex items-center gap-2.5 hover:bg-[var(--surface)] rounded-md px-2 py-1.5 transition-colors cursor-pointer group"
        >
          <div className="w-7 h-7 rounded-full bg-[var(--ember)]/20 flex items-center justify-center shrink-0">
            <User size={14} className="text-[var(--ember)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--ink)] truncate">Account</p>
            <p className="text-xs text-[var(--dim)] truncate">Settings</p>
          </div>
          <Settings size={13} className="text-[var(--dim)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      </div>
    </div>
  )
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-40 p-2 rounded-md bg-[var(--paper)] border border-[var(--border)] shadow-sm lg:hidden cursor-pointer"
      >
        <Menu size={18} />
      </button>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-[var(--ink)]/40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed left-0 top-0 bottom-0 z-50 w-60 bg-[var(--paper)] border-r border-[var(--border)] shadow-xl lg:hidden"
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <SidebarContent onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop fixed sidebar */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-60 bg-[var(--paper)] border-r border-[var(--border)]">
        <SidebarContent />
      </aside>
    </>
  )
}
