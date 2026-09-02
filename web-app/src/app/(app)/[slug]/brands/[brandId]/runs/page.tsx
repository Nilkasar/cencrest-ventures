'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, ExternalLink } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils'

interface Run {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  provider?: string
  provider_count?: number
  queries_total?: number
  queries_done?: number
}

function relativeTime(iso?: string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function durationLabel(run: Run): string {
  if (!run.completed_at || !run.created_at) return '—'
  const ms = new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

// ─── Active Run Banner ────────────────────────────────────────────────────────

function ActiveRunBanner({ run }: { run: Run }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
      className="rounded-xl bg-warning/10 border border-[var(--warning)]/30 px-4 py-3 flex items-center gap-3 mb-4"
    >
      {/* Pulsing amber dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-60" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning" />
      </span>
      <span className="text-sm font-medium text-ink flex-1">Analysis in progress…</span>
      {/* Indeterminate progress */}
      <div className="w-40 relative h-1.5 overflow-hidden rounded-full bg-warning/20">
        <motion.div
          className="absolute inset-y-0 rounded-full bg-warning"
          animate={{ x: ['-100%', '400%'] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          style={{ width: '40%', left: 0 }}
        />
      </div>
      {run.queries_total && run.queries_done != null && (
        <span className="text-xs font-mono text-dim shrink-0">
          {run.queries_done}/{run.queries_total}
        </span>
      )}
    </motion.div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: Run['status'] }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-sans bg-info/10 text-info">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-60" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-info" />
        </span>
        Running
      </span>
    )
  }
  const map = {
    completed: { variant: 'success' as const, label: 'Completed' },
    failed: { variant: 'danger' as const, label: 'Failed' },
    pending: { variant: 'outline' as const, label: 'Pending' },
  }
  const meta = map[status]
  return <Badge variant={meta.variant} size="sm" dot>{meta.label}</Badge>
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['runs', slug, brandId],
    queryFn: () => api.get<{ runs: Run[] }>(routes.runs(slug, brandId)),
    refetchInterval: (query) => {
      const runs = (query.state.data as { runs?: Run[] } | undefined)?.runs ?? []
      const hasActive = runs.some((r) => r.status === 'running' || r.status === 'pending')
      return hasActive ? 3000 : false
    },
  })

  const newRunMutation = useMutation({
    mutationFn: () => api.post<Run>(routes.runs(slug, brandId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs', slug, brandId] }),
  })

  const runs = (data as { runs?: Run[] } | undefined)?.runs ?? []
  const hasActive = runs.some((r) => r.status === 'running' || r.status === 'pending')
  const activeRun = runs.find((r) => r.status === 'running' || r.status === 'pending') ?? null

  useEffect(() => {
    if (!hasActive) return
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['runs', slug, brandId] })
    }, 3000)
    return () => clearInterval(id)
  }, [hasActive, qc, slug, brandId])

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <PageHeader
          title="AI Analysis Runs"
          subtitle="Each run queries all AI providers"
          actions={
            <Button
              onClick={() => newRunMutation.mutate()}
              loading={newRunMutation.isPending}
              disabled={hasActive}
            >
              <Play className="h-4 w-4" />
              Run Now
            </Button>
          }
        />
      </div>

      {/* Active run banner */}
      <AnimatePresence>
        {activeRun && <ActiveRunBanner run={activeRun} />}
      </AnimatePresence>

      {/* Runs table */}
      {isLoading ? (
        <SkeletonCard />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Play className="h-6 w-6" />}
          title="No runs yet"
          description="Start a run to query AI providers and measure your brand's visibility."
          action={
            <Button onClick={() => newRunMutation.mutate()} loading={newRunMutation.isPending}>
              <Play className="h-4 w-4" /> Run Now
            </Button>
          }
        />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Run History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Table head */}
              <div className="grid grid-cols-[160px_120px_80px_100px_100px_80px] gap-3 px-4 py-2.5 bg-surface border-b border-border">
                {['Date', 'Status', 'Queries', 'Duration', 'Providers', ''].map((h, i) => (
                  <span key={i} className="text-xs font-semibold text-dim uppercase tracking-wide">{h}</span>
                ))}
              </div>
              <div className="divide-y divide-[var(--border)]">
                <AnimatePresence initial={false}>
                  {runs.map((run, i) => (
                    <motion.div
                      key={run.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.25, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
                      className="grid grid-cols-[160px_120px_80px_100px_100px_80px] gap-3 px-4 py-3 items-center hover:bg-surface/50 transition-colors"
                    >
                      {/* Date */}
                      <span className="font-mono text-sm text-dim">{relativeTime(run.created_at)}</span>
                      {/* Status */}
                      <RunStatusBadge status={run.status} />
                      {/* Queries */}
                      <span className="text-sm font-mono text-ink">
                        {run.queries_done != null && run.queries_total
                          ? `${run.queries_done}/${run.queries_total}`
                          : run.queries_total ?? '—'}
                      </span>
                      {/* Duration */}
                      <span className="text-sm font-mono text-dim">{durationLabel(run)}</span>
                      {/* Provider Count */}
                      <span className="text-sm font-mono text-dim">
                        {run.provider_count ?? (run.provider ? 1 : '—')}
                      </span>
                      {/* View */}
                      <button
                        className="inline-flex items-center gap-1 text-xs text-ember hover:underline font-medium"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  )
}
