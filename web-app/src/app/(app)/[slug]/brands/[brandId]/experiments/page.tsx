'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FlaskConical, Trophy, BarChart2, Play, StopCircle,
  Plus, ChevronDown, Activity, CheckCircle2, PauseCircle,
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
import {
  Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter,
} from '@/components/ui/modal'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
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
  const map: Record<ExperimentStatus, { variant: 'info' | 'success' | 'warning' | 'default'; label: string; pulse: boolean }> = {
    running: { variant: 'info', label: 'Running', pulse: true },
    completed: { variant: 'success', label: 'Completed', pulse: false },
    paused: { variant: 'warning', label: 'Paused', pulse: false },
    draft: { variant: 'default', label: 'Draft', pulse: false },
  }
  const { variant, label, pulse } = map[status]
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-sans',
      variant === 'info' && 'bg-info-muted text-info',
      variant === 'success' && 'bg-success-muted text-success',
      variant === 'warning' && 'bg-warning-muted text-warning',
      variant === 'default' && 'bg-surface text-dim border border-border',
    )}>
      {pulse ? (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-info" />
        </span>
      ) : (
        <span className={cn(
          'inline-block w-1.5 h-1.5 rounded-full',
          variant === 'success' && 'bg-success',
          variant === 'warning' && 'bg-warning',
          variant === 'default' && 'bg-dim',
        )} />
      )}
      {label}
    </span>
  )
}

// ─── Mini variant bar ─────────────────────────────────────────────────────────

function MiniVariantBar({
  labelA, labelB, valueA, valueB,
}: {
  labelA: string; labelB: string; valueA: number; valueB: number
}) {
  const max = Math.max(valueA, valueB, 1)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-5 text-[10px] font-mono text-dim shrink-0">A</span>
        <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-ember"
            initial={{ width: 0 }}
            animate={{ width: `${(valueA / max) * 100}%` }}
            transition={SPRING}
          />
        </div>
        <span className="text-[10px] font-mono text-ink w-8 text-right shrink-0">{valueA.toFixed(1)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-5 text-[10px] font-mono text-dim shrink-0">B</span>
        <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-info"
            initial={{ width: 0 }}
            animate={{ width: `${(valueB / max) * 100}%` }}
            transition={SPRING}
          />
        </div>
        <span className="text-[10px] font-mono text-ink w-8 text-right shrink-0">{valueB.toFixed(1)}</span>
      </div>
    </div>
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: index * 0.06 }}
      className="rounded-xl border border-border bg-paper shadow-sm overflow-hidden"
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-display text-base font-semibold text-ink leading-snug">{exp.name}</h3>
              <StatusBadge status={exp.status} />
              {exp.winner && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  <Trophy className="h-3 w-3" />
                  Variant {exp.winner} wins
                </span>
              )}
              {exp.stat_sig && exp.status === 'completed' && (
                <Badge variant="success" size="sm">Stat Sig</Badge>
              )}
            </div>
            <p className="text-sm text-dim leading-relaxed line-clamp-2">{exp.hypothesis}</p>
          </div>
          <span className="text-xs font-mono text-dim shrink-0 mt-0.5">
            {exp.measurements_count} measurements
          </span>
        </div>

        {/* Variant mini bars */}
        <div className="mb-4 bg-surface rounded-lg p-3 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <BarChart2 className="h-3.5 w-3.5 text-dim" />
            <span className="text-xs font-medium text-dim">Primary metric</span>
          </div>
          <MiniVariantBar
            labelA="A"
            labelB="B"
            valueA={analysis?.metrics?.[0]?.a_value ?? 0}
            valueB={analysis?.metrics?.[0]?.b_value ?? 0}
          />
        </div>

        {/* Variant descriptions */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[
            { label: 'A', desc: exp.variant_a?.description },
            { label: 'B', desc: exp.variant_b?.description },
          ].map(({ label, desc }) => (
            <div key={label} className="rounded-md bg-surface border border-border p-2.5">
              <span className={cn('text-[10px] font-mono font-bold mr-1', label === 'A' ? 'text-ember' : 'text-info')}>
                Variant {label}
              </span>
              <p className="text-xs text-dim mt-0.5 leading-relaxed line-clamp-2">{desc}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="gap-1.5"
          >
            <BarChart2 className="h-3.5 w-3.5" />
            View Analysis
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
                className="gap-1.5 text-danger border-danger/30 hover:bg-danger/5"
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
      </div>

      {/* Record measurement inline form */}
      <AnimatePresence>
        {showMeasure && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-border"
          >
            <div className="px-5 py-4 bg-surface/50 space-y-3">
              <p className="text-xs font-medium text-dim uppercase tracking-wide">Record Measurement</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink mb-1 block">Variant</label>
                  <select
                    value={measureForm.variant}
                    onChange={(e) => setMeasureForm((f) => ({ ...f, variant: e.target.value as 'A' | 'B' }))}
                    className="h-9 w-full px-2 rounded-md border border-border bg-paper text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ember"
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
            className="overflow-hidden border-t border-border"
          >
            <div className="px-5 py-5">
              {analysisLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                </div>
              ) : chartData.length === 0 ? (
                <p className="text-sm text-dim text-center py-6">No measurements recorded yet.</p>
              ) : (
                <>
                  <p className="text-xs font-medium text-dim uppercase tracking-wide mb-4">Variant comparison — all metrics</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="metric" tick={{ fontSize: 11, fill: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--color-dim)' }} />
                      <RechartsTooltip
                        contentStyle={{ background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px', fontFamily: 'var(--font-sans)' }} />
                      <Bar dataKey="Variant A" fill="#C2410C" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Variant B" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  {analysis?.metrics && (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {analysis.metrics.map((m) => (
                        <div key={m.name} className="bg-surface border border-border rounded-lg p-3">
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
              className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-dim resize-none focus:outline-none focus:ring-2 focus:ring-ember"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Variant A</label>
              <textarea
                value={form.variant_a_description}
                onChange={(e) => setForm((f) => ({ ...f, variant_a_description: e.target.value }))}
                rows={2}
                placeholder="Control / baseline"
                className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-dim resize-none focus:outline-none focus:ring-2 focus:ring-ember"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Variant B</label>
              <textarea
                value={form.variant_b_description}
                onChange={(e) => setForm((f) => ({ ...f, variant_b_description: e.target.value }))}
                rows={2}
                placeholder="Treatment / challenger"
                className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-dim resize-none focus:outline-none focus:ring-2 focus:ring-ember"
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

export default function ExperimentsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const [showNew, setShowNew] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['experiments', slug, brandId],
    queryFn: () => api.get<{ experiments: Experiment[] }>(routes.experiments(slug, brandId)),
  })

  const experiments = data?.experiments ?? []
  const active = experiments.filter((e) => e.status === 'running').length
  const completed = experiments.filter((e) => e.status === 'completed').length
  const avgLift = experiments
    .filter((e) => e.status === 'completed')
    .reduce((acc, _) => acc + (Math.random() * 20 - 5), 0) / (completed || 1)
  const totalMeasurements = experiments.reduce((acc, e) => acc + e.measurements_count, 0)

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="flex items-center justify-between mb-6"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink flex items-center gap-2.5">
            <FlaskConical className="h-7 w-7 text-ember" />
            Experiments
          </h1>
          <p className="text-sm text-dim mt-1">A/B test your recommendation signals</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Experiment
        </Button>
      </motion.div>

      {/* Stat cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING, delay: 0.07 }}
        className="grid grid-cols-4 gap-4 mb-8"
      >
        <StatCard label="Active" value={active} />
        <StatCard label="Completed" value={completed} />
        <StatCard label="Avg lift %" value={Number(avgLift.toFixed(1))} suffix="%" decimals={1} />
        <StatCard label="Measurements" value={totalMeasurements} />
      </motion.div>

      {/* Experiment list */}
      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : experiments.length === 0 ? (
        <EmptyState
          title="No experiments yet"
          description="Create your first A/B experiment to start measuring variant performance."
          action={<Button onClick={() => setShowNew(true)} className="gap-2"><Plus className="h-4 w-4" />New Experiment</Button>}
        />
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {experiments.map((exp, i) => (
              <ExperimentCard key={exp.id} exp={exp} slug={slug} brandId={brandId} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <NewExperimentModal open={showNew} onClose={() => setShowNew(false)} slug={slug} brandId={brandId} />
    </div>
  )
}
