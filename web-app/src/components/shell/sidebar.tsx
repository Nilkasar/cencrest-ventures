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

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
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
        'group relative flex items-center gap-2.5 font-sans font-medium text-[13px] rounded-lg transition-all duration-[150ms]',
        'no-underline',
        isActive
          ? 'bg-[rgba(194,65,12,0.15)] text-[var(--ember)]'
          : 'text-[var(--dim)] hover:bg-white/5 hover:text-[var(--paper)]'
      )}
      style={{
        height: 36,
        padding: '0 12px',
        textDecoration: 'none',
      }}
    >
      <Icon
        size={15}
        style={{
          flexShrink: 0,
          color: 'inherit',
          opacity: isActive ? 1 : undefined,
          transition: 'opacity 150ms',
        }}
        className={cn(!isActive && 'opacity-60 group-hover:opacity-100')}
      />
      <span style={{ color: 'inherit' }}>{item.label}</span>
    </Link>
  )
}

function PulseDot() {
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8, flexShrink: 0 }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'var(--ember)',
          opacity: 0.5,
          animation: 'ping 1.6s cubic-bezier(0,0,0.2,1) infinite',
        }}
      />
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--ember)',
          display: 'inline-block',
        }}
      />
      <style>{`@keyframes ping { 75%,100% { transform:scale(2); opacity:0 } }`}</style>
    </span>
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

  const user = getStoredUser()
  const userEmail = user?.email ?? ''
  const initials = (user?.name ?? userEmail)
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0F0E0A',
      }}
    >
      {/* Logo + close */}
      <div
        style={{
          padding: '18px 16px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Logo row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              className="font-display font-bold"
              style={{ fontSize: 22, color: 'var(--paper)', letterSpacing: '-0.02em' }}
            >
              BeBest
            </span>
            <PulseDot />
          </div>

          {/* Brand / org selector */}
          <button
            onClick={() => setOrgOpen(!orgOpen)}
            className="font-sans hover:!text-[var(--paper)] transition-colors"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--dim)',
              fontSize: 13,
            }}
          >
            <span
              style={{
                maxWidth: 148,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentOrg?.name ?? 'Select org'}
            </span>
            <ChevronDown
              size={12}
              style={{
                flexShrink: 0,
                transition: 'transform 200ms',
                transform: orgOpen ? 'rotate(180deg)' : 'none',
              }}
            />
          </button>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden cursor-pointer"
            style={{
              padding: 4,
              background: 'none',
              border: 'none',
              color: 'var(--dim)',
              cursor: 'pointer',
            }}
          >
            <X size={17} />
          </button>
        )}
      </div>

      {/* Nav groups */}
      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {navGroups.map((group) => (
          <div key={group.label}>
            <p
              className="font-sans"
              style={{
                padding: '0 12px',
                marginBottom: 4,
                marginTop: 0,
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'var(--dim)',
              }}
            >
              {group.label}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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

      {/* Bottom: user */}
      <div
        style={{
          padding: '12px 10px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(194,65,12,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span className="font-sans" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ember)' }}>
            {initials || '?'}
          </span>
        </div>

        <p
          className="font-sans"
          style={{
            fontSize: 12,
            color: 'var(--dim)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {userEmail || 'Account'}
        </p>

        <button
          onClick={handleLogout}
          title="Sign out"
          style={{
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--dim)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
            transition: 'color 150ms',
          }}
          className="hover:!text-[var(--danger)]"
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  )
}

export function Sidebar() {
  const mobileOpen = useAppStore((s) => s.mobileSidebarOpen)
  const closeMobileSidebar = useAppStore((s) => s.closeMobileSidebar)

  return (
    <>
      {/* Mobile drawer overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ background: 'rgba(22,20,15,0.6)', backdropFilter: 'blur(2px)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMobileSidebar}
            />
            <motion.aside
              className="fixed left-0 top-0 bottom-0 z-50 lg:hidden"
              style={{ width: 240, boxShadow: '4px 0 32px rgba(0,0,0,0.5)' }}
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <SidebarContent onClose={closeMobileSidebar} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop fixed sidebar */}
      <aside
        className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0"
        style={{ width: 240 }}
      >
        <SidebarContent />
      </aside>
    </>
  )
}
