'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  AtSign,
  AlertTriangle,
  FileText,
  Settings,
  X,
  Trash2,
  CheckCheck,
  BellOff,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, relativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { spring, fastTransition } from '@/design-system/motion'

// ─── Types ─────────────────────────────────────────────────────────────────
type NotifType = 'mention' | 'alert' | 'report' | 'system'
type FilterKey = 'all' | 'unread' | 'mentions' | 'alerts' | 'reports'

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
  { key: 'mentions', label: 'Mentions' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'reports', label: 'Reports' },
]

function typeIcon(type: NotifType) {
  switch (type) {
    case 'mention': return <AtSign className="h-3.5 w-3.5" />
    case 'alert':   return <AlertTriangle className="h-3.5 w-3.5" />
    case 'report':  return <FileText className="h-3.5 w-3.5" />
    case 'system':  return <Settings className="h-3.5 w-3.5" />
  }
}

function typeDotClass(type: NotifType) {
  switch (type) {
    case 'mention': return 'bg-ember text-paper'
    case 'alert':   return 'bg-danger text-white'
    case 'report':  return 'bg-info text-white'
    case 'system':  return 'bg-dim text-paper'
  }
}

function filterNotifs(notifs: Notification[], filter: FilterKey): Notification[] {
  switch (filter) {
    case 'unread':   return notifs.filter((n) => !n.read)
    case 'mentions': return notifs.filter((n) => n.type === 'mention')
    case 'alerts':   return notifs.filter((n) => n.type === 'alert')
    case 'reports':  return notifs.filter((n) => n.type === 'report')
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
        'relative flex gap-3 px-4 py-3.5 rounded-lg border cursor-pointer select-none group',
        'transition-colors duration-200',
        notif.read
          ? 'bg-paper border-border'
          : 'bg-surface border-border'
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

      {/* Icon dot */}
      <div
        className={cn(
          'shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5',
          typeDotClass(notif.type)
        )}
      >
        {typeIcon(notif.type)}
      </div>

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

  const notifications: Notification[] = (data as NotifResponse | undefined)?.notifications ?? []
  const unreadCount: number = (data as NotifResponse | undefined)?.unread_count ?? 0

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
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="flex items-center justify-between gap-4 mb-6"
      >
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-ink">Notifications</h1>
          {unreadCount > 0 && (
            <Badge variant="ember" size="sm">{unreadCount}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              loading={markAllReadMutation.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          )}
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
        </div>
      </motion.div>

      {/* Filter pills */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.05 }}
        className="relative flex items-center gap-1 mb-6 p-1 bg-surface border border-border rounded-lg w-fit"
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
        <EmptyState
          icon={<BellOff className="h-6 w-6" />}
          title={filter === 'all' ? 'No notifications' : `No ${filter} notifications`}
          description={filter === 'unread' ? 'You\'re all caught up.' : 'Nothing here yet.'}
        />
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
