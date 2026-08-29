'use client'

import { useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import {
  Check,
  X,
  RefreshCw,
  CheckCircle2,
  MinusCircle,
  Inbox,
  Zap,
  MapPin,
  Plus,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, priorityColor } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal'
import { tokens } from '@/design-system/tokens'

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = 'P1' | 'P2' | 'P3'
type ActionStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'dismissed'
type ActionSource = 'geo_gap' | 'recommendation'
type FilterTab = 'all' | ActionStatus

interface Action {
  id: string
  title: string
  description: string
  priority: Priority
  status: ActionStatus
  source: ActionSource
  created_at: string
  updated_at?: string
}

interface ActionsResponse {
  actions: Action[]
}

interface ActionsSummary {
  pending: number
  in_progress: number
  completed: number
  failed: number
  completed_this_week: number
  dismissed: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPRING = tokens.animation.easing.spring as [number, number, number, number]

const FILTER_TABS: Array<{ value: FilterTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function priorityBadgeVariant(p: Priority): 'danger' | 'warning' | 'info' {
  switch (p) {
    case 'P1': return 'danger'
    case 'P2': return 'warning'
    case 'P3': return 'info'
  }
}

function priorityLabel(p: Priority) {
  switch (p) {
    case 'P1': return 'Critical'
    case 'P2': return 'High'
    case 'P3': return 'Medium'
  }
}

function statusBadgeVariant(s: ActionStatus): 'warning' | 'info' | 'success' | 'danger' | 'default' {
  switch (s) {
    case 'pending': return 'warning'
    case 'in_progress': return 'info'
    case 'completed': return 'success'
    case 'failed': return 'danger'
    case 'dismissed': return 'default'
  }
}

function statusLabel(s: ActionStatus) {
  switch (s) {
    case 'pending': return 'Pending'
    case 'in_progress': return 'In Progress'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
    case 'dismissed': return 'Dismissed'
  }
}

function borderColorClass(s: ActionStatus) {
  switch (s) {
    case 'pending': return 'border-l-[var(--warning)]'
    case 'in_progress': return 'border-l-[var(--info)]'
    case 'completed': return 'border-l-[var(--success)]'
    case 'failed': return 'border-l-[var(--danger)]'
    case 'dismissed': return 'border-l-[var(--border)]'
  }
}

function StatusDot({ status }: { status: ActionStatus }) {
  const colors: Record<ActionStatus, string> = {
    pending: 'var(--warning)',
    in_progress: 'var(--info)',
    completed: 'var(--success)',
    failed: 'var(--danger)',
    dismissed: 'var(--dim)',
  }

  return (
    <motion.span
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', status === 'in_progress' && 'animate-pulse')}
      style={{ background: colors[status] }}
      animate={status === 'in_progress' ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
      transition={status === 'in_progress' ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : {}}
    />
  )
}

function SourceTag({ source }: { source: ActionSource }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-mono text-[var(--dim)]">
      {source === 'geo_gap' ? (
        <MapPin className="h-3 w-3" />
      ) : (
        <Zap className="h-3 w-3" />
      )}
      {source === 'geo_gap' ? 'geo_gap' : 'recommendation'}
    </span>
  )
}

// ─── Stats Row ────────────────────────────────────────────────────────────────

function StatsRow({ summary }: { summary: ActionsSummary }) {
  const stats = [
    { label: 'Pending', value: summary.pending, color: 'text-[var(--warning)]', bg: 'bg-[var(--warning)]/5 border-[var(--warning)]/30' },
    { label: 'In Progress', value: summary.in_progress, color: 'text-[var(--info)]', bg: 'bg-[var(--info)]/5 border-[var(--info)]/30' },
    { label: 'Completed', value: summary.completed, color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/5 border-[var(--success)]/30' },
    { label: 'Failed', value: summary.failed, color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/5 border-[var(--danger)]/30' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map((s) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn('rounded-xl border px-4 py-3', s.bg)}
        >
          <p className={cn('text-2xl font-bold font-display', s.color)}>{s.value}</p>
          <p className="text-xs text-[var(--dim)] uppercase tracking-wide mt-0.5">{s.label}</p>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Animated Counter Badge ───────────────────────────────────────────────────

function CounterBadge({ count }: { count: number }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={count}
        initial={{ opacity: 0, scale: 0.6, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 6 }}
        transition={{ type: 'tween', ease: SPRING, duration: 0.2 }}
        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--ember)] text-[var(--paper)] text-xs font-mono font-bold leading-none"
      >
        {count}
      </motion.span>
    </AnimatePresence>
  )
}

// ─── Filter Pills ─────────────────────────────────────────────────────────────

function FilterPills({
  active,
  onChange,
  counts,
}: {
  active: FilterTab
  onChange: (v: FilterTab) => void
  counts: Record<FilterTab, number>
}) {
  return (
    <LayoutGroup id="action-filter">
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTER_TABS.map((tab) => {
          const isActive = active === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => onChange(tab.value)}
              className={cn(
                'relative px-3 py-1.5 rounded-full text-sm font-sans font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember)] focus-visible:ring-offset-2',
                isActive ? 'text-[var(--paper)]' : 'text-[var(--dim)] hover:text-[var(--ink)]',
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="action-filter-pill"
                  className="absolute inset-0 bg-[var(--ember)] rounded-full"
                  transition={{ type: 'tween', ease: SPRING, duration: 0.25 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {tab.label}
                {counts[tab.value] > 0 && (
                  <span
                    className={cn(
                      'text-xs rounded-full px-1.5 py-px font-mono font-semibold leading-none',
                      isActive ? 'bg-white/20 text-[var(--paper)]' : 'bg-[var(--border)] text-[var(--dim)]',
                    )}
                  >
                    {counts[tab.value]}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}

// ─── Action Card ──────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: Action
  onComplete: (id: string) => void
  onDismiss: (id: string) => void
  onRetry: (id: string) => void
  isCompleting: boolean
  isDismissing: boolean
  index: number
}

function ActionCard({
  action,
  onComplete,
  onDismiss,
  onRetry,
  isCompleting,
  isDismissing,
  index,
}: ActionCardProps) {
  const formattedDate = new Date(action.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <motion.div
      layout
      key={action.id}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -32, scale: 0.97 }}
      transition={{ duration: 0.35, ease: SPRING, delay: index * 0.05 }}
      className={cn(
        'group relative border-l-4 bg-white/70 px-5 py-4 mb-2 rounded-r-xl rounded-l-sm',
        'transition-[border-color,box-shadow] duration-200',
        borderColorClass(action.status),
        action.status === 'completed' && 'opacity-60',
        action.status === 'dismissed' && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <div className="mt-1 flex-shrink-0">
          <StatusDot status={action.status} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={cn(
            'font-display text-base font-semibold text-[var(--ink)] leading-snug',
            action.status === 'completed' && 'line-through text-[var(--dim)]',
          )}>
            {action.title}
          </p>

          {action.description && (
            <p className="text-sm text-[var(--dim)] mt-0.5 line-clamp-2">{action.description}</p>
          )}

          {/* Footer row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-[var(--dim)]">{formattedDate}</span>
            <SourceTag source={action.source} />
            <div className="flex items-center gap-1.5">
              <Badge variant={priorityBadgeVariant(action.priority)} size="sm">
                {priorityLabel(action.priority)}
              </Badge>
              <Badge variant={statusBadgeVariant(action.status)} size="sm" dot={false}>
                {statusLabel(action.status)}
              </Badge>
            </div>

            {/* Action buttons */}
            <div className="ml-auto flex items-center gap-1.5">
              {(action.status === 'pending' || action.status === 'in_progress') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onComplete(action.id)}
                  disabled={isCompleting || isDismissing}
                  className="text-[var(--success)] border-[var(--success)]/30 hover:bg-[var(--success)]/5"
                >
                  {isCompleting ? (
                    <svg className="animate-spin h-3.5 w-3.5 mr-1" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <Check className="h-3.5 w-3.5 mr-1" />
                  )}
                  Mark Complete
                </Button>
              )}

              {action.status === 'failed' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRetry(action.id)}
                  disabled={isCompleting || isDismissing}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Retry
                </Button>
              )}

              {action.status !== 'dismissed' && action.status !== 'completed' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDismiss(action.id)}
                  disabled={isCompleting || isDismissing}
                  className="text-[var(--dim)] hover:text-[var(--ink)]"
                >
                  Archive
                </Button>
              )}
            </div>
          </div>
        </div>

        {action.status === 'completed' && (
          <CheckCircle2 className="h-5 w-5 text-[var(--success)] flex-shrink-0" />
        )}
        {action.status === 'failed' && (
          <AlertCircle className="h-5 w-5 text-[var(--danger)] flex-shrink-0" />
        )}
        {action.status === 'dismissed' && (
          <MinusCircle className="h-5 w-5 text-[var(--dim)] flex-shrink-0" />
        )}
      </div>
    </motion.div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-[var(--surface)] border-l-4 border-[var(--border)] rounded-r-xl px-5 py-4 flex gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── New Action Modal ─────────────────────────────────────────────────────────

function NewActionModal({
  open,
  onClose,
  slug,
  brandId,
}: {
  open: boolean
  onClose: () => void
  slug: string
  brandId: string
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const qc = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (payload: { title: string; description: string }) =>
      api.post(routes.actions(slug, brandId), { ...payload, source: 'recommendation', priority: 'P2' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['actions', slug, brandId] })
      qc.invalidateQueries({ queryKey: ['actions-summary', slug, brandId] })
      setTitle('')
      setDescription('')
      onClose()
    },
  })

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader><ModalTitle>New Action</ModalTitle></ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-[var(--dim)] font-sans mb-1 block">Title</label>
              <Input
                placeholder="Action title…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-[var(--dim)] font-sans mb-1 block">Description</label>
              <textarea
                placeholder="What needs to be done…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm font-sans text-[var(--ink)] bg-[var(--paper)] border border-[var(--border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--ember)] resize-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                disabled={!title || createMutation.isPending}
                onClick={() => createMutation.mutate({ title, description })}
              >
                {createMutation.isPending ? 'Creating…' : 'Create Action'}
              </Button>
            </div>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActionsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterTab>('all')
  const [showNewAction, setShowNewAction] = useState(false)
  const mutatingIds = useRef<Map<string, 'completing' | 'dismissing'>>(new Map())
  const [, forceUpdate] = useState(0)

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ['actions', slug, brandId],
    queryFn: () => api.get<ActionsResponse>(routes.actions(slug, brandId)),
  })

  const { data: summaryData } = useQuery({
    queryKey: ['actions-summary', slug, brandId],
    queryFn: () => api.get<ActionsSummary>(`${routes.actions(slug, brandId)}/summary`),
  })

  // ── Sync Mutation ─────────────────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: () => api.post(`${routes.actions(slug, brandId)}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', slug, brandId] })
      queryClient.invalidateQueries({ queryKey: ['actions-summary', slug, brandId] })
    },
  })

  // ── Complete Mutation ─────────────────────────────────────────────────────

  const completeMutation = useMutation({
    mutationFn: (actionId: string) =>
      api.patch(`${routes.actions(slug, brandId)}/${actionId}`, { status: 'completed' }),
    onMutate: async (actionId) => {
      await queryClient.cancelQueries({ queryKey: ['actions', slug, brandId] })
      const previous = queryClient.getQueryData<ActionsResponse>(['actions', slug, brandId])
      queryClient.setQueryData<ActionsResponse>(['actions', slug, brandId], (old) => ({
        actions: (old?.actions ?? []).map((a) =>
          a.id === actionId ? { ...a, status: 'completed' as ActionStatus } : a
        ),
      }))
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['actions', slug, brandId], context.previous)
      }
    },
    onSettled: (_, __, actionId) => {
      mutatingIds.current.delete(actionId)
      forceUpdate((n) => n + 1)
      queryClient.invalidateQueries({ queryKey: ['actions', slug, brandId] })
      queryClient.invalidateQueries({ queryKey: ['actions-summary', slug, brandId] })
    },
  })

  // ── Dismiss Mutation ──────────────────────────────────────────────────────

  const dismissMutation = useMutation({
    mutationFn: (actionId: string) =>
      api.delete(`${routes.actions(slug, brandId)}/${actionId}`),
    onMutate: async (actionId) => {
      await queryClient.cancelQueries({ queryKey: ['actions', slug, brandId] })
      const previous = queryClient.getQueryData<ActionsResponse>(['actions', slug, brandId])
      queryClient.setQueryData<ActionsResponse>(['actions', slug, brandId], (old) => ({
        actions: (old?.actions ?? []).map((a) =>
          a.id === actionId ? { ...a, status: 'dismissed' as ActionStatus } : a
        ),
      }))
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['actions', slug, brandId], context.previous)
      }
    },
    onSettled: (_, __, actionId) => {
      mutatingIds.current.delete(actionId)
      forceUpdate((n) => n + 1)
      queryClient.invalidateQueries({ queryKey: ['actions', slug, brandId] })
      queryClient.invalidateQueries({ queryKey: ['actions-summary', slug, brandId] })
    },
  })

  // ── Retry Mutation ────────────────────────────────────────────────────────

  const retryMutation = useMutation({
    mutationFn: (actionId: string) =>
      api.patch(`${routes.actions(slug, brandId)}/${actionId}`, { status: 'pending' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', slug, brandId] })
    },
  })

  const handleComplete = useCallback(
    (id: string) => {
      mutatingIds.current.set(id, 'completing')
      forceUpdate((n) => n + 1)
      completeMutation.mutate(id)
    },
    [completeMutation]
  )

  const handleDismiss = useCallback(
    (id: string) => {
      mutatingIds.current.set(id, 'dismissing')
      forceUpdate((n) => n + 1)
      dismissMutation.mutate(id)
    },
    [dismissMutation]
  )

  const handleRetry = useCallback(
    (id: string) => {
      retryMutation.mutate(id)
    },
    [retryMutation]
  )

  // ── Derived ───────────────────────────────────────────────────────────────

  const allActions = data?.actions ?? []

  const filtered = allActions.filter((a) => {
    if (filter === 'all') return true
    return a.status === filter
  })

  const counts: Record<FilterTab, number> = {
    all: allActions.length,
    pending: allActions.filter((a) => a.status === 'pending').length,
    in_progress: allActions.filter((a) => a.status === 'in_progress').length,
    completed: allActions.filter((a) => a.status === 'completed').length,
    failed: allActions.filter((a) => a.status === 'failed').length,
    dismissed: allActions.filter((a) => a.status === 'dismissed').length,
  }

  const pendingCount = counts.pending

  const summary: ActionsSummary = summaryData ?? {
    pending: pendingCount,
    in_progress: counts.in_progress,
    completed: counts.completed,
    failed: counts.failed,
    completed_this_week: counts.completed,
    dismissed: counts.dismissed,
  }

  if (isLoading) return <PageSkeleton />

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Action Plan</h1>
            {pendingCount > 0 && <CounterBadge count={pendingCount} />}
          </div>
          <p className="text-sm text-[var(--dim)] mt-1">Prioritized actions derived from AI recommendation gaps</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <motion.span
              animate={syncMutation.isPending ? { rotate: 360 } : { rotate: 0 }}
              transition={syncMutation.isPending ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
              style={{ display: 'inline-flex' }}
            >
              <RefreshCw className="h-4 w-4" />
            </motion.span>
            {syncMutation.isPending ? 'Syncing…' : 'Sync'}
          </Button>
          <Button size="sm" onClick={() => setShowNewAction(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Action
          </Button>
        </div>
      </motion.div>

      {/* Stats row */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <StatsRow summary={summary} />
      </motion.div>

      {/* Filter Pills */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.3 }}
      >
        <FilterPills active={filter} onChange={setFilter} counts={counts} />
      </motion.div>

      {/* Action List */}
      <div>
        <AnimatePresence mode="popLayout" initial={false}>
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.25, ease: SPRING }}
            >
              <EmptyState
                icon={
                  filter === 'completed' ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : filter === 'failed' ? (
                    <AlertCircle className="h-6 w-6" />
                  ) : filter === 'dismissed' ? (
                    <MinusCircle className="h-6 w-6" />
                  ) : (
                    <Inbox className="h-6 w-6" />
                  )
                }
                title={
                  filter === 'all'
                    ? 'No actions yet'
                    : filter === 'completed'
                    ? 'Nothing completed yet'
                    : filter === 'failed'
                    ? 'No failed actions'
                    : filter === 'dismissed'
                    ? 'Nothing dismissed'
                    : `No ${filter.replace('_', ' ')} actions`
                }
                description={
                  filter === 'all'
                    ? 'Sync to pull in the latest recommendations and gaps.'
                    : 'Change the filter to see other actions.'
                }
                action={
                  filter === 'all' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncMutation.mutate()}
                      loading={syncMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Sync Now
                    </Button>
                  ) : undefined
                }
              />
            </motion.div>
          ) : (
            filtered.map((action, i) => (
              <ActionCard
                key={action.id}
                action={action}
                onComplete={handleComplete}
                onDismiss={handleDismiss}
                onRetry={handleRetry}
                isCompleting={mutatingIds.current.get(action.id) === 'completing'}
                isDismissing={mutatingIds.current.get(action.id) === 'dismissing'}
                index={i}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* New Action Modal */}
      <NewActionModal
        open={showNewAction}
        onClose={() => setShowNewAction(false)}
        slug={slug}
        brandId={brandId}
      />
    </div>
  )
}
