'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FlaskConical, Trophy, BarChart2, Play, StopCircle,
  Plus, ChevronDown, Activity,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { Spinner } from '@/components/ui/spinner'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter,
} from '@/components/ui/modal'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageHeader } from '@/components/layout/page-header'
import { cn, relativeTime } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type ExperimentStatus = 'draft' | 'running' | 'completed' | 'paused'
type Winner = 'A' | 'B' | null

interface Experiment {
  id: string
  name: string
  hypothesis: string
  status: ExperimentStatus
  variant_a: { description: string; label?: string }
  variant_b: { description: string; label?: string }
  winner: Winner
  started_at: string | null
  ended_at: string | null
  measurements_count: number
  progress_pct?: number
  stat_sig?: boolean
}

interface Measurement {
  variant: 'A' | 'B'
  metric_name: string
  metric_value: number
  source: string
  recorded_at: string
}

interface ExperimentAnalysis extends Experiment {
  measurements: Measurement[]
  metrics: Array<{
    name: string
    a_value: number
    b_value: number
    lift_pct: number
  }>
}

const SPRING = { type: 'spring', stiffness: 320, damping: 28 } as const

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ExperimentStatus }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-sans bg-info/10 text-info">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-info" />
        </span>
        Running
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-sans bg-success/10 text-success">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
        Completed
      </span>
    )
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-sans bg-warning/10 text-warning">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning" />
        Paused
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-sans bg-surface text-dim border border-border">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--dim)]" />
      Draft
    </span>
  )
}

// ─── Experiment card ──────────────────────────────────────────────────────────

function ExperimentCard({
  exp, slug, brandId, index,
}: {
  exp: Experiment; slug: string; brandId: string; index: number
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [showMeasure, setShowMeasure] = useState(false)

  const { data: analysis, isFetching: analysisLoading } = useQuery({
    queryKey: ['experiment-analysis', exp.id],
    queryFn: () => api.get<ExperimentAnalysis>(`${routes.experiments(slug, brandId)}/${exp.id}`),
    enabled: expanded,
  })

  const startMutation = useMutation({
    mutationFn: () => api.post(`${routes.experiments(slug, brandId)}/${exp.id}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['experiments', slug, brandId] }),
  })

  const endMutation = useMutation({
    mutationFn: () => api.post(`${routes.experiments(slug, brandId)}/${exp.id}/end`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['experiments', slug, brandId] }),
  })

  const [measureForm, setMeasureForm] = useState({ variant: 'A', metric_name: '', metric_value: '', source: '' })

  const recordMutation = useMutation({
    mutationFn: () => api.post(`${routes.experiments(slug, brandId)}/${exp.id}/measurements`, {
      ...measureForm,
      metric_value: Number(measureForm.metric_value),
    }),
    onSuccess: () => {
      setShowMeasure(false)
      queryClient.invalidateQueries({ queryKey: ['experiment-analysis', exp.id] })
      queryClient.invalidateQueries({ queryKey: ['experiments', slug, brandId] })
      setMeasureForm({ variant: 'A', metric_name: '', metric_value: '', source: '' })
    },
  })

  const chartData = analysis?.metrics?.map((m) => ({
    metric: m.name,
    'Variant A': m.a_value,
    'Variant B': m.b_value,
  })) ?? []

  const progress = exp.progress_pct ?? (exp.status === 'running' ? 42 : exp.status === 'completed' ? 100 : 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: index * 0.06 }}
      className="rounded-xl border border-border bg-surface-raised p-5 mb-3 overflow-hidden"
    >
      {/* Status badge + hypothesis */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={exp.status} />
          {exp.winner && (
            <Badge variant="success" size="sm">
              <Trophy className="h-3 w-3" />
              Winner: Variant {exp.winner}
            </Badge>
          )}
          {exp.stat_sig && exp.status === 'completed' && (
            <Badge variant="info" size="sm">Stat Sig</Badge>
          )}
        </div>
        <span className="text-xs font-mono text-dim shrink-0 mt-0.5">
          {exp.measurements_count} measurements
        </span>
      </div>

      {/* Hypothesis */}
      <h3 className="font-display text-lg text-ink leading-snug mb-1">{exp.hypothesis}</h3>
      <p className="text-sm text-dim leading-relaxed line-clamp-2 mb-3">{exp.name}</p>

      {/* Variants chips */}
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface border border-border text-xs font-sans text-dim">
          Control: {exp.variant_a?.label ?? 'Variant A'}
        </span>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface border border-border text-xs font-sans text-dim">
          {exp.variant_b?.label ?? 'Variant A'}
        </span>
      </div>

      {/* Running: progress bar */}
      {exp.status === 'running' && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-dim">Progress elapsed</span>
            <span className="text-xs font-mono text-dim">{progress}%</span>
          </div>
          <Progress value={progress} variant="default" className="h-1.5" />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="gap-1.5"
        >
          <BarChart2 className="h-3.5 w-3.5" />
          View Results
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.div>
        </Button>

        {exp.status === 'running' && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => endMutation.mutate()}
              loading={endMutation.isPending}
              className="gap-1.5 text-danger border-[var(--danger)]/30 hover:bg-danger/5"
            >
              <StopCircle className="h-3.5 w-3.5" />
              End
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowMeasure(!showMeasure)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Record
            </Button>
          </>
        )}

        {exp.status === 'draft' && (
          <Button size="sm" onClick={() => startMutation.mutate()} loading={startMutation.isPending} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Start
          </Button>
        )}

        {exp.started_at && (
          <span className="text-xs text-dim ml-auto">Started {relativeTime(exp.started_at)}</span>
        )}
      </div>

      {/* Record measurement inline form */}
      <AnimatePresence>
        {showMeasure && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-border mt-3"
          >
            <div className="pt-4 space-y-3">
              <p className="text-xs font-medium text-dim uppercase tracking-wide">Record Measurement</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink mb-1 block">Variant</label>
                  <select
                    value={measureForm.variant}
                    onChange={(e) => setMeasureForm((f) => ({ ...f, variant: e.target.value as 'A' | 'B' }))}
                    className="h-9 w-full px-2 rounded-md border border-border bg-paper text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
                  >
                    <option value="A">Variant A</option>
                    <option value="B">Variant B</option>
                  </select>
                </div>
                <Input
                  label="Metric name"
                  value={measureForm.metric_name}
                  onChange={(e) => setMeasureForm((f) => ({ ...f, metric_name: e.target.value }))}
                  className="h-9 text-sm"
                />
                <Input
                  label="Value"
                  type="number"
                  value={measureForm.metric_value}
                  onChange={(e) => setMeasureForm((f) => ({ ...f, metric_value: e.target.value }))}
                  className="h-9 text-sm"
                />
                <Input
                  label="Source"
                  value={measureForm.source}
                  onChange={(e) => setMeasureForm((f) => ({ ...f, source: e.target.value }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => recordMutation.mutate()} loading={recordMutation.isPending}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowMeasure(false)}>Cancel</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded analysis */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-border mt-3"
          >
            <div className="pt-4">
              {analysisLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                </div>
              ) : chartData.length === 0 ? (
                <p className="text-sm text-dim text-center py-6">No measurements recorded yet.</p>
              ) : (
                <>
                  <p className="text-xs font-medium text-dim uppercase tracking-wide mb-4">Variant comparison</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="metric" tick={{ fontSize: 11, fill: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--color-dim)' }} />
                      <RechartsTooltip
                        contentStyle={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: '12px', fontSize: '12px', boxShadow: '0 4px 16px rgba(22,20,15,0.08)' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px', fontFamily: 'var(--font-sans)' }} />
                      <Bar dataKey="Variant A" fill="#C2410C" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Variant B" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  {analysis?.metrics && (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {analysis.metrics.map((m) => (
                        <div key={m.name} className="bg-surface-raised border border-border rounded-lg p-3">
                          <p className="text-[10px] font-mono text-dim truncate">{m.name}</p>
                          <p className={cn(
                            'text-sm font-semibold mt-0.5',
                            m.lift_pct > 0 ? 'text-success' : m.lift_pct < 0 ? 'text-danger' : 'text-dim',
                          )}>
                            {m.lift_pct > 0 ? '+' : ''}{m.lift_pct.toFixed(1)}% lift
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── New Experiment Modal ─────────────────────────────────────────────────────

function NewExperimentModal({
  open, onClose, slug, brandId,
}: {
  open: boolean; onClose: () => void; slug: string; brandId: string
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: '', hypothesis: '',
    variant_a_description: '', variant_b_description: '',
    primary_metric: 'conversion_rate',
  })

  const mutation = useMutation({
    mutationFn: () => api.post(routes.experiments(slug, brandId), form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments', slug, brandId] })
      onClose()
      setForm({ name: '', hypothesis: '', variant_a_description: '', variant_b_description: '', primary_metric: 'conversion_rate' })
    },
  })

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent className="max-w-xl">
        <ModalHeader>
          <ModalTitle>New Experiment</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Homepage CTA copy test"
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Hypothesis</label>
            <textarea
              value={form.hypothesis}
              onChange={(e) => setForm((f) => ({ ...f, hypothesis: e.target.value }))}
              rows={3}
              placeholder="We believe that… because…"
              className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-dim resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Variant A (Control)</label>
              <textarea
                value={form.variant_a_description}
                onChange={(e) => setForm((f) => ({ ...f, variant_a_description: e.target.value }))}
                rows={2}
                placeholder="Control / baseline"
                className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-dim resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Variant B</label>
              <textarea
                value={form.variant_b_description}
                onChange={(e) => setForm((f) => ({ ...f, variant_b_description: e.target.value }))}
                rows={2}
                placeholder="Treatment / challenger"
                className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-dim resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Primary metric</label>
            <Select value={form.primary_metric} onValueChange={(v) => setForm((f) => ({ ...f, primary_metric: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conversion_rate">Conversion rate</SelectItem>
                <SelectItem value="click_through_rate">Click-through rate</SelectItem>
                <SelectItem value="avg_session_duration">Avg session duration</SelectItem>
                <SelectItem value="bounce_rate">Bounce rate</SelectItem>
                <SelectItem value="revenue_per_user">Revenue per user</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.name || !form.hypothesis}>
            Create Experiment
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabFilter = 'all' | ExperimentStatus

export default function ExperimentsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const [showNew, setShowNew] = useState(false)
  const [tab, setTab] = useState<TabFilter>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['experiments', slug, brandId],
    queryFn: () => api.get<{ experiments: Experiment[] }>(routes.experiments(slug, brandId)),
  })

  const experiments = data?.experiments ?? []
  const filtered = tab === 'all' ? experiments : experiments.filter((e) => e.status === tab)

  const active = experiments.filter((e) => e.status === 'running').length
  const completed = experiments.filter((e) => e.status === 'completed').length
  const totalMeasurements = experiments.reduce((acc, e) => acc + e.measurements_count, 0)

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <PageHeader
          title="Experiments"
          subtitle="A/B test your recommendation signals"
          actions={
            <Button onClick={() => setShowNew(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Experiment
            </Button>
          }
        />
      </div>

      {/* Stat cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING, delay: 0.07 }}
        className="grid grid-cols-3 gap-4 mb-8"
      >
        <StatCard label="Active" value={active} />
        <StatCard label="Completed" value={completed} />
        <StatCard label="Measurements" value={totalMeasurements} />
      </motion.div>

      {/* Status tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All <span className="ml-1 text-xs font-mono text-dim">({experiments.length})</span></TabsTrigger>
          <TabsTrigger value="running">Running <span className="ml-1 text-xs font-mono text-dim">({experiments.filter(e => e.status === 'running').length})</span></TabsTrigger>
          <TabsTrigger value="completed">Completed <span className="ml-1 text-xs font-mono text-dim">({experiments.filter(e => e.status === 'completed').length})</span></TabsTrigger>
          <TabsTrigger value="draft">Draft <span className="ml-1 text-xs font-mono text-dim">({experiments.filter(e => e.status === 'draft').length})</span></TabsTrigger>
        </TabsList>

        {(['all', 'running', 'completed', 'draft'] as TabFilter[]).map((t) => (
          <TabsContent key={t} value={t}>
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Activity className="h-6 w-6" />}
                title={t === 'all' ? 'No experiments yet' : `No ${t} experiments`}
                description={t === 'all' ? 'Create your first A/B experiment to start measuring variant performance.' : `No experiments with status "${t}".`}
                action={t === 'all' ? <Button onClick={() => setShowNew(true)} className="gap-2"><Plus className="h-4 w-4" />New Experiment</Button> : undefined}
              />
            ) : (
              <AnimatePresence mode="popLayout">
                {filtered.map((exp, i) => (
                  <ExperimentCard key={exp.id} exp={exp} slug={slug} brandId={brandId} index={i} />
                ))}
              </AnimatePresence>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <NewExperimentModal open={showNew} onClose={() => setShowNew(false)} slug={slug} brandId={brandId} />
    </div>
  )
}
