'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Trash2,
  CheckCheck,
  BellOff,
  CheckCircle2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, relativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { spring, fastTransition } from '@/design-system/motion'

// ─── Types ─────────────────────────────────────────────────────────────────
type NotifType = 'mention' | 'alert' | 'report' | 'system'
type FilterKey = 'all' | 'unread' | 'analysis' | 'alerts'

interface Notification {
  id: string
  type: NotifType
  title: string
  body: string
  read: boolean
  created_at: string
}

interface NotifResponse {
  notifications: Notification[]
  unread_count: number
}

// ─── Constants ──────────────────────────────────────────────────────────────
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'alerts', label: 'Alerts' },
]

// Sample static notifications shown when no real data
const SAMPLE_NOTIFICATIONS: Notification[] = [
  {
    id: 'sample-1',
    type: 'alert',
    title: 'Visibility drop detected',
    body: 'ChatGPT mentions of your brand dropped 18% this week. Consider refreshing your content corpus.',
    read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: 'sample-2',
    type: 'report',
    title: 'Monthly analysis complete',
    body: 'Your July Recommendation Intelligence report is ready. Overall score: 74/100.',
    read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: 'sample-3',
    type: 'mention',
    title: 'New citation in Perplexity',
    body: 'Perplexity cited your case study "Enterprise AI Adoption" in a recommendation response.',
    read: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
  {
    id: 'sample-4',
    type: 'system',
    title: 'Analysis run scheduled',
    body: 'Your weekly competitive analysis will run tonight at 2:00 AM UTC.',
    read: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
]

function typeDotColor(type: NotifType): string {
  switch (type) {
    case 'mention': return 'bg-ember'
    case 'alert':   return 'bg-danger'
    case 'report':  return 'bg-info'
    case 'system':  return 'bg-dim'
  }
}


function filterNotifs(notifs: Notification[], filter: FilterKey): Notification[] {
  switch (filter) {
    case 'unread':   return notifs.filter((n) => !n.read)
    case 'analysis': return notifs.filter((n) => n.type === 'report')
    case 'alerts':   return notifs.filter((n) => n.type === 'alert')
    default:         return notifs
  }
}

// ─── Notification Card ───────────────────────────────────────────────────────
function NotifCard({
  notif,
  onRead,
  onDismiss,
}: {
  notif: Notification
  onRead: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const [hovered, setHovered] = React.useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24, height: 0, marginBottom: 0 }}
      transition={spring}
      className={cn(
        'relative flex gap-3 px-5 py-4 rounded-lg border cursor-pointer select-none group',
        'transition-colors duration-200',
        notif.read
          ? 'bg-paper border-transparent'
          : 'bg-surface-raised border-border'
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (!notif.read) onRead(notif.id) }}
    >
      {/* Unread left border strip */}
      {!notif.read && (
        <motion.div
          layoutId={`strip-${notif.id}`}
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-ember"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          exit={{ scaleY: 0 }}
          transition={fastTransition}
        />
      )}

      {/* Left dot indicator */}
      <div className={cn('w-2.5 h-2.5 rounded-full mt-1.5 shrink-0', typeDotColor(notif.type))} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-sans leading-snug', notif.read ? 'font-normal text-ink' : 'font-semibold text-ink')}>
          {notif.title}
        </p>
        <p className="text-xs text-dim mt-0.5 leading-relaxed line-clamp-2">{notif.body}</p>
        <p className="text-xs text-dim/70 mt-1 font-mono">{relativeTime(notif.created_at)}</p>
      </div>

      {/* Right: unread dot + dismiss */}
      <div className="shrink-0 flex flex-col items-end gap-2 pt-0.5">
        {!notif.read && (
          <motion.span
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            className="w-2 h-2 rounded-full bg-ember"
          />
        )}
        <motion.button
          animate={{ opacity: hovered ? 1 : 0 }}
          transition={fastTransition}
          onClick={(e) => { e.stopPropagation(); onDismiss(notif.id) }}
          className="p-1 rounded text-dim hover:text-danger hover:bg-danger-muted transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </motion.button>
      </div>
    </motion.div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const { slug } = useParams<{ slug: string }>()
  const qc = useQueryClient()
  const [filter, setFilter] = React.useState<FilterKey>('all')
  const [page, setPage] = React.useState(1)
  const PAGE_SIZE = 10

  const notifKey = ['notifications', slug]

  const { data, isLoading } = useQuery({
    queryKey: notifKey,
    queryFn: () => api.get<NotifResponse>(`/api/orgs/${slug}/notifications`),
  })

  const rawNotifications: Notification[] = (data as NotifResponse | undefined)?.notifications ?? []
  // Show sample data when no real notifications have loaded yet
  const notifications: Notification[] = rawNotifications.length > 0 ? rawNotifications : (!isLoading ? SAMPLE_NOTIFICATIONS : [])
  const unreadCount: number = (data as NotifResponse | undefined)?.unread_count ?? notifications.filter((n) => !n.read).length

  // Optimistic helpers
  function optimisticMarkRead(id: string) {
    qc.setQueryData<NotifResponse>(notifKey, (old) => {
      if (!old) return old
      const notifications = old.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      )
      return { notifications, unread_count: Math.max(0, old.unread_count - 1) }
    })
  }

  function optimisticDismiss(id: string) {
    qc.setQueryData<NotifResponse>(notifKey, (old) => {
      if (!old) return old
      const target = old.notifications.find((n) => n.id === id)
      const notifications = old.notifications.filter((n) => n.id !== id)
      const unread_count = target && !target.read ? Math.max(0, old.unread_count - 1) : old.unread_count
      return { notifications, unread_count }
    })
  }

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/api/orgs/${slug}/notifications/${id}/read`),
    onMutate: (id) => { optimisticMarkRead(id) },
    onError: () => { qc.invalidateQueries({ queryKey: notifKey }) },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/orgs/${slug}/notifications`).then(() => id),
    onMutate: (id) => { optimisticDismiss(id) },
    onError: () => { qc.invalidateQueries({ queryKey: notifKey }) },
  })

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post(`/api/orgs/${slug}/notifications/read-all`),
    onMutate: () => {
      qc.setQueryData<NotifResponse>(notifKey, (old) => {
        if (!old) return old
        return { notifications: old.notifications.map((n) => ({ ...n, read: true })), unread_count: 0 }
      })
    },
    onError: () => { qc.invalidateQueries({ queryKey: notifKey }) },
  })

  const clearAllMutation = useMutation({
    mutationFn: () => api.delete(`/api/orgs/${slug}/notifications`),
    onSuccess: () => {
      qc.setQueryData<NotifResponse>(notifKey, { notifications: [], unread_count: 0 })
    },
  })

  const filtered = filterNotifs(notifications, filter)
  const visible = filtered.slice(0, page * PAGE_SIZE)
  const hasMore = visible.length < filtered.length

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Notifications
            {unreadCount > 0 && (
              <Badge variant="ember" size="sm">{unreadCount}</Badge>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              loading={markAllReadMutation.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger hover:bg-danger-muted"
                onClick={() => clearAllMutation.mutate()}
                loading={clearAllMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </Button>
            )}
          </>
        }
        className="mb-8"
      />

      {/* Filter pills */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.05 }}
        className="relative flex items-center gap-1 mb-8 p-1 bg-surface border border-border rounded-lg w-fit"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => { setFilter(f.key); setPage(1) }}
            className={cn(
              'relative px-3 py-1.5 text-sm font-sans font-medium rounded-md transition-colors duration-150 z-10',
              filter === f.key ? 'text-ink' : 'text-dim hover:text-ink'
            )}
          >
            {filter === f.key && (
              <motion.div
                layoutId="notif-filter-indicator"
                className="absolute inset-0 bg-paper border border-border rounded-md shadow-sm"
                style={{ zIndex: -1 }}
                transition={spring}
              />
            )}
            {f.label}
          </button>
        ))}
      </motion.div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface border border-border animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        filter === 'unread' ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-7 w-7 text-success" />
            </div>
            <h3 className="font-display text-base font-semibold text-ink mb-1">You&apos;re all caught up!</h3>
            <p className="text-sm text-dim">No new notifications</p>
          </div>
        ) : (
          <EmptyState
            icon={<BellOff className="h-6 w-6" />}
            title={filter === 'all' ? 'No notifications' : `No ${filter === 'analysis' ? 'analysis' : filter} notifications`}
            description="Nothing here yet."
          />
        )
      ) : (
        <AnimatePresence mode="popLayout">
          <motion.div className="space-y-2">
            {visible.map((n) => (
              <NotifCard
                key={n.id}
                notif={n}
                onRead={(id) => markReadMutation.mutate(id)}
                onDismiss={(id) => dismissMutation.mutate(id)}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Load more */}
      {hasMore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 flex justify-center"
        >
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
            Load more
          </Button>
        </motion.div>
      )}
    </div>
  )
}
