'use client'

import { useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import {
  Check,
  X,
  RefreshCw,
  AlertCircle,
  Clock,
  CheckCircle2,
  MinusCircle,
  Inbox,
  Zap,
  MapPin,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, priorityColor } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { tokens } from '@/design-system/tokens'

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = 'P1' | 'P2' | 'P3'
type ActionStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed'
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
  { value: 'dismissed', label: 'Dismissed' },
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

function statusBadgeVariant(s: ActionStatus): 'warning' | 'info' | 'success' | 'default' {
  switch (s) {
    case 'pending': return 'warning'
    case 'in_progress': return 'info'
    case 'completed': return 'success'
    case 'dismissed': return 'default'
  }
}

function statusLabel(s: ActionStatus) {
  switch (s) {
    case 'pending': return 'Pending'
    case 'in_progress': return 'In Progress'
    case 'completed': return 'Completed'
    case 'dismissed': return 'Dismissed'
  }
}

function StatusDot({ status }: { status: ActionStatus }) {
  const colors: Record<ActionStatus, string> = {
    pending: tokens.colors.warning,
    in_progress: tokens.colors.info,
    completed: tokens.colors.success,
    dismissed: tokens.colors.dim,
  }

  return (
    <motion.span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: colors[status] }}
      animate={status === 'pending' ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
      transition={status === 'pending' ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : {}}
    />
  )
}

function SourceTag({ source }: { source: ActionSource }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-mono text-dim">
      {source === 'geo_gap' ? (
        <MapPin className="h-3 w-3" />
      ) : (
        <Zap className="h-3 w-3" />
      )}
      {source === 'geo_gap' ? 'geo_gap' : 'recommendation'}
    </span>
  )
}

// ─── Action Card ──────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: Action
  onComplete: (id: string) => void
  onDismiss: (id: string) => void
  isCompleting: boolean
  isDismissing: boolean
  index: number
}

function ActionCard({
  action,
  onComplete,
  onDismiss,
  isCompleting,
  isDismissing,
  index,
}: ActionCardProps) {
  return (
    <motion.div
      layout
      key={action.id}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -32, scale: 0.97 }}
      transition={{ duration: 0.35, ease: SPRING, delay: index * 0.05 }}
      whileHover={{ scale: 1.008 }}
      style={{ originX: 0.5 }}
      className={cn(
        'group relative bg-surface border border-border rounded-lg p-4',
        'transition-[border-color,box-shadow] duration-200',
        'hover:border-ember/40 hover:shadow-sm',
        action.status === 'completed' && 'opacity-60',
        action.status === 'dismissed' && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Priority indicator */}
        <div className={cn('mt-0.5 font-mono text-xs font-bold leading-none px-1.5 py-1 rounded', priorityColor(action.priority))}>
          {action.priority}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className={cn(
              'text-sm font-semibold text-ink leading-snug',
              action.status === 'completed' && 'line-through text-dim',
            )}>
              {action.title}
            </p>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Badge variant={priorityBadgeVariant(action.priority)} size="sm">
                {priorityLabel(action.priority)}
              </Badge>
            </div>
          </div>

          {action.description && (
            <p className="text-xs text-dim leading-relaxed line-clamp-2">{action.description}</p>
          )}

          <div className="flex items-center gap-3 pt-0.5 flex-wrap">
            <SourceTag source={action.source} />
            <div className="flex items-center gap-1.5">
              <StatusDot status={action.status} />
              <Badge variant={statusBadgeVariant(action.status)} size="sm" dot={false}>
                {statusLabel(action.status)}
              </Badge>
            </div>
          </div>
        </div>

        {/* Actions */}
        {action.status !== 'completed' && action.status !== 'dismissed' && (
          <div className="flex items-center gap-1.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0">
            <motion.button
              whileHover={{ scale: 1.1, backgroundColor: tokens.colors.successMuted }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'tween', ease: SPRING, duration: 0.15 }}
              onClick={() => onComplete(action.id)}
              disabled={isCompleting || isDismissing}
              className={cn(
                'h-8 w-8 rounded-md flex items-center justify-center border border-border',
                'text-dim hover:text-success hover:border-success/40 transition-colors',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
              title="Mark complete"
            >
              {isCompleting ? (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.1, backgroundColor: tokens.colors.dangerMuted }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'tween', ease: SPRING, duration: 0.15 }}
              onClick={() => onDismiss(action.id)}
              disabled={isCompleting || isDismissing}
              className={cn(
                'h-8 w-8 rounded-md flex items-center justify-center border border-border',
                'text-dim hover:text-danger hover:border-danger/40 transition-colors',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
              title="Dismiss"
            >
              {isDismissing ? (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </motion.button>
          </div>
        )}

        {action.status === 'completed' && (
          <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 ml-2" />
        )}

        {action.status === 'dismissed' && (
          <MinusCircle className="h-5 w-5 text-dim flex-shrink-0 ml-2" />
        )}
      </div>
    </motion.div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-10 w-24 rounded-md" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-4 flex gap-3">
            <Skeleton className="h-6 w-8 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
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
        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-ember text-paper text-xs font-mono font-bold leading-none"
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2',
                isActive ? 'text-paper' : 'text-dim hover:text-ink',
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="action-filter-pill"
                  className="absolute inset-0 bg-ember rounded-full"
                  transition={{ type: 'tween', ease: SPRING, duration: 0.25 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {tab.label}
                {counts[tab.value] > 0 && (
                  <span
                    className={cn(
                      'text-xs rounded-full px-1.5 py-px font-mono font-semibold leading-none',
                      isActive ? 'bg-white/20 text-paper' : 'bg-border text-dim',
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

// ─── Summary Bar ──────────────────────────────────────────────────────────────

function SummaryBar({ summary }: { summary: ActionsSummary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: SPRING, delay: 0.15 }}
      className="flex items-center gap-6 py-3 px-4 bg-surface border border-border rounded-lg text-sm font-sans"
    >
      <div className="flex items-center gap-2 text-warning">
        <Clock className="h-4 w-4" />
        <span className="font-semibold text-ink">{summary.pending}</span>
        <span className="text-dim">pending</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-success" />
        <span className="font-semibold text-ink">{summary.completed_this_week}</span>
        <span className="text-dim">completed this week</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-2">
        <MinusCircle className="h-4 w-4 text-dim" />
        <span className="font-semibold text-ink">{summary.dismissed}</span>
        <span className="text-dim">dismissed</span>
      </div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActionsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterTab>('all')
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
    dismissed: allActions.filter((a) => a.status === 'dismissed').length,
  }

  const pendingCount = counts.pending

  const summary: ActionsSummary = summaryData ?? {
    pending: pendingCount,
    completed_this_week: counts.completed,
    dismissed: counts.dismissed,
  }

  if (isLoading) return <PageSkeleton />

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold text-ink">Action Center</h1>
            {pendingCount > 0 && <CounterBadge count={pendingCount} />}
          </div>
          <p className="text-sm text-dim mt-1">Prioritized actions derived from AI recommendation gaps</p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="flex-shrink-0"
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
      <div className="space-y-2.5">
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
                isCompleting={mutatingIds.current.get(action.id) === 'completing'}
                isDismissing={mutatingIds.current.get(action.id) === 'dismissing'}
                index={i}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Summary Bar */}
      <SummaryBar summary={summary} />
    </div>
  )
}
