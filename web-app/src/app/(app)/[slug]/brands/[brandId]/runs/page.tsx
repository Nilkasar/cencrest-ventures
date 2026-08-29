'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

interface Run {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  provider?: string
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

const statusMeta: Record<
  Run['status'],
  { variant: 'success' | 'danger' | 'info' | 'outline'; dot: boolean; pulse: boolean }
> = {
  pending: { variant: 'outline', dot: true, pulse: false },
  running: { variant: 'info', dot: false, pulse: true },
  completed: { variant: 'success', dot: true, pulse: false },
  failed: { variant: 'danger', dot: true, pulse: false },
}

function RunCard({ run, index }: { run: Run; index: number }) {
  const meta = statusMeta[run.status]
  const progress =
    run.queries_total && run.queries_done != null
      ? Math.round((run.queries_done / run.queries_total) * 100)
      : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
    >
      <div className="flex items-center gap-4 py-4 border-b border-border last:border-0">
        {/* Status dot */}
        <div className="shrink-0">
          {meta.pulse ? (
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ember opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-ember" />
            </span>
          ) : (
            <Badge variant={meta.variant} size="sm" dot>
              {run.status}
            </Badge>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-xs text-dim">#{run.id.slice(0, 8)}</span>
            {run.provider && (
              <Badge variant="outline" size="sm">{run.provider}</Badge>
            )}
            {meta.pulse && <Badge variant="info" size="sm">Running</Badge>}
          </div>
          {progress != null && (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden max-w-48">
                <motion.div
                  className="h-full bg-ember rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
              <span className="text-xs text-dim font-mono">{run.queries_done}/{run.queries_total}</span>
            </div>
          )}
        </div>

        {/* Time */}
        <div className="text-right shrink-0">
          <p className="text-xs text-dim">{relativeTime(run.created_at)}</p>
          {run.completed_at && (
            <p className="text-xs text-dim">done {relativeTime(run.completed_at)}</p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

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

  // Keep polling while active
  useEffect(() => {
    if (!hasActive) return
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['runs', slug, brandId] })
    }, 3000)
    return () => clearInterval(id)
  }, [hasActive, qc, slug, brandId])

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">AI Runs</h1>
          <p className="text-sm text-dim mt-1">Each run queries all AI providers</p>
        </div>
        <Button
          onClick={() => newRunMutation.mutate()}
          loading={newRunMutation.isPending}
          disabled={hasActive}
        >
          <Play className="h-4 w-4" />
          New Run
        </Button>
      </motion.div>

      {isLoading ? (
        <SkeletonCard />
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Start a run to query AI providers and measure your brand's visibility."
          action={
            <Button onClick={() => newRunMutation.mutate()} loading={newRunMutation.isPending}>
              <Play className="h-4 w-4" /> New Run
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
            <CardContent>
              {runs.map((run, i) => (
                <RunCard key={run.id} run={run} index={i} />
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  )
}
