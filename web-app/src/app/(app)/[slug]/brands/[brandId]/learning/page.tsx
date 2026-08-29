'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BrainCircuit, Radio, Lightbulb, Plus, ChevronDown,
  CheckCircle2, TrendingUp, AlertTriangle, Zap, Shield,
  Loader2, RotateCcw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { cn, relativeTime } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type SignalType = 'mention' | 'ranking' | 'sentiment' | 'citation' | 'experiment'
type InsightCategory = 'trend' | 'anomaly' | 'opportunity' | 'risk'
type InsightFilter = 'all' | 'unactioned' | 'opportunities' | 'risks'

interface Signal {
  id: string
  signal_type: SignalType
  value: number
  source: string
  notes?: string
  created_at: string
}

interface Insight {
  id: string
  text: string
  confidence: number
  supporting_signals_count: number
  category: InsightCategory
  actioned: boolean
  actioned_at?: string
  created_at: string
}

const SPRING = { type: 'spring', stiffness: 320, damping: 28 } as const
const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

// ─── Signal type helpers ──────────────────────────────────────────────────────

function signalTypeVariant(t: SignalType): 'info' | 'success' | 'warning' | 'ember' | 'default' {
  const map: Record<SignalType, 'info' | 'success' | 'warning' | 'ember' | 'default'> = {
    mention: 'info',
    ranking: 'success',
    sentiment: 'warning',
    citation: 'ember',
    experiment: 'default',
  }
  return map[t]
}

function signalTypeLabel(t: SignalType) {
  const map: Record<SignalType, string> = {
    mention: 'Mention',
    ranking: 'Ranking',
    sentiment: 'Sentiment',
    citation: 'Citation',
    experiment: 'Experiment',
  }
  return map[t]
}

// ─── Insight category helpers ─────────────────────────────────────────────────

function CategoryIcon({ cat, className }: { cat: InsightCategory; className?: string }) {
  const cls = cn('h-4 w-4', className)
  switch (cat) {
    case 'trend': return <TrendingUp className={cls} />
    case 'anomaly': return <AlertTriangle className={cls} />
    case 'opportunity': return <Zap className={cls} />
    case 'risk': return <Shield className={cls} />
  }
}

function categoryBadgeVariant(cat: InsightCategory): 'info' | 'warning' | 'ember' | 'danger' {
  const map: Record<InsightCategory, 'info' | 'warning' | 'ember' | 'danger'> = {
    trend: 'info',
    anomaly: 'warning',
    opportunity: 'ember',
    risk: 'danger',
  }
  return map[cat]
}

function confidenceColor(c: number) {
  if (c >= 0.75) return 'text-success bg-success-muted'
  if (c >= 0.5) return 'text-warning bg-warning-muted'
  return 'text-danger bg-danger-muted'
}

// ─── Signal feed item ─────────────────────────────────────────────────────────

function SignalItem({ signal, index }: { signal: Signal; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...SPRING, delay: index * 0.04 }}
      className="flex items-start gap-3 py-3"
    >
      <Badge variant={signalTypeVariant(signal.signal_type)} size="sm" className="shrink-0 mt-0.5">
        {signalTypeLabel(signal.signal_type)}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-ink">{signal.value}</span>
          <span className="text-xs text-dim px-1.5 py-0.5 bg-surface rounded border border-border font-mono truncate max-w-[120px]">
            {signal.source}
          </span>
        </div>
        {signal.notes && (
          <p className="text-xs text-dim mt-0.5 leading-relaxed line-clamp-1">{signal.notes}</p>
        )}
        <p className="text-[10px] text-dim mt-0.5">{relativeTime(signal.created_at)}</p>
      </div>
    </motion.div>
  )
}

// ─── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({
  insight, slug, brandId, index,
}: {
  insight: Insight; slug: string; brandId: string; index: number
}) {
  const queryClient = useQueryClient()

  const actionMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/orgs/${slug}/brands/${brandId}/learning/insights/${insight.id}`, { actioned: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-insights', slug, brandId] })
    },
  })

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: insight.actioned ? 0.4 : 1, y: 0 }}
      transition={{ ...SPRING, delay: index * 0.05 }}
      className={cn(
        'relative rounded-xl border bg-paper p-5 overflow-hidden transition-opacity',
        insight.actioned ? 'border-border' : 'border-border hover:border-ember/30',
      )}
    >
      {/* Actioned overlay */}
      <AnimatePresence>
        {insight.actioned && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          >
            <div className="flex items-center gap-2 px-3 py-1.5 bg-success-muted border border-success/20 rounded-full">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-xs font-medium text-success">Actioned</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category + confidence */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
            categoryBadgeVariant(insight.category) === 'info' && 'bg-info-muted text-info',
            categoryBadgeVariant(insight.category) === 'warning' && 'bg-warning-muted text-warning',
            categoryBadgeVariant(insight.category) === 'ember' && 'bg-ember/10 text-ember',
            categoryBadgeVariant(insight.category) === 'danger' && 'bg-danger-muted text-danger',
          )}>
            <CategoryIcon cat={insight.category} className="h-3 w-3" />
            <span className="capitalize">{insight.category}</span>
          </span>
          <span className="text-xs text-dim">{insight.supporting_signals_count} signals</span>
        </div>
        <span className={cn(
          'text-xs font-mono font-semibold px-2 py-0.5 rounded-full',
          confidenceColor(insight.confidence),
        )}>
          {Math.round(insight.confidence * 100)}%
        </span>
      </div>

      {/* Insight text */}
      <p className={cn(
        'text-sm text-ink leading-relaxed mb-4',
        insight.actioned && 'line-through text-dim',
      )}>
        {insight.text}
      </p>

      {/* Progress bar for confidence */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-[10px] text-dim mb-1">
          <span>Confidence</span>
          <span className="font-mono">{Math.round(insight.confidence * 100)}%</span>
        </div>
        <Progress value={insight.confidence * 100} className="h-1.5" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-dim">{relativeTime(insight.created_at)}</span>
        {!insight.actioned && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => actionMutation.mutate()}
            loading={actionMutation.isPending}
            className="gap-1.5 text-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Action This
          </Button>
        )}
      </div>
    </motion.div>
  )
}

// ─── Record signal inline form ────────────────────────────────────────────────

function RecordSignalForm({
  open, onClose, slug, brandId,
}: {
  open: boolean; onClose: () => void; slug: string; brandId: string
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    signal_type: 'mention' as SignalType,
    value: '',
    source: '',
    notes: '',
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/api/orgs/${slug}/brands/${brandId}/learning/signals`, {
        ...form,
        value: Number(form.value),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-signals', slug, brandId] })
      onClose()
      setForm({ signal_type: 'mention', value: '', source: '', notes: '' })
    },
  })

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="overflow-hidden"
        >
          <div className="border border-ember/30 rounded-xl bg-ember/5 p-4 mb-4 space-y-3">
            <p className="text-xs font-semibold text-ember uppercase tracking-wide">Record Signal</p>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink">Type</label>
              <Select
                value={form.signal_type}
                onValueChange={(v) => setForm((f) => ({ ...f, signal_type: v as SignalType }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mention">Mention</SelectItem>
                  <SelectItem value="ranking">Ranking</SelectItem>
                  <SelectItem value="sentiment">Sentiment</SelectItem>
                  <SelectItem value="citation">Citation</SelectItem>
                  <SelectItem value="experiment">Experiment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Value"
                type="number"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                className="h-9 text-sm"
              />
              <Input
                label="Source"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                className="h-9 text-sm"
                placeholder="e.g. ChatGPT"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Optional context…"
                className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-dim resize-none focus:outline-none focus:ring-2 focus:ring-ember"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.value || !form.source}>
                Save Signal
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Process progress animation ───────────────────────────────────────────────

function ProcessingOverlay({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-paper/90 backdrop-blur-sm rounded-xl z-10"
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
      >
        <BrainCircuit className="h-10 w-10 text-ember" />
      </motion.div>
      <p className="text-sm font-medium text-ink">Processing signals…</p>
      <motion.div
        className="w-48 h-1.5 bg-surface rounded-full overflow-hidden"
      >
        <motion.div
          className="h-full bg-ember rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 2.5, ease: 'easeInOut' }}
          onAnimationComplete={onDone}
        />
      </motion.div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LearningPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const queryClient = useQueryClient()

  const [showRecord, setShowRecord] = useState(false)
  const [signalPage, setSignalPage] = useState(1)
  const [processing, setProcessing] = useState(false)
  const [insightFilter, setInsightFilter] = useState<InsightFilter>('all')

  const { data: signalsData, isLoading: signalsLoading } = useQuery({
    queryKey: ['learning-signals', slug, brandId],
    queryFn: () => api.get<{ signals: Signal[] }>(`/api/orgs/${slug}/brands/${brandId}/learning/signals`),
  })

  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ['learning-insights', slug, brandId],
    queryFn: () => api.get<{ insights: Insight[] }>(`/api/orgs/${slug}/brands/${brandId}/learning/insights`),
  })

  const processMutation = useMutation({
    mutationFn: () => api.post(`/api/orgs/${slug}/brands/${brandId}/learning/process`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-insights', slug, brandId] })
    },
  })

  const handleProcess = () => {
    setProcessing(true)
    processMutation.mutate()
  }

  const allSignals = signalsData?.signals ?? []
  const displayedSignals = allSignals.slice(0, signalPage * 20)

  const allInsights = insightsData?.insights ?? []
  const filteredInsights = allInsights.filter((ins) => {
    if (insightFilter === 'unactioned') return !ins.actioned
    if (insightFilter === 'opportunities') return ins.category === 'opportunity'
    if (insightFilter === 'risks') return ins.category === 'risk'
    return true
  })

  const FILTER_OPTIONS: Array<{ value: InsightFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'unactioned', label: 'Unactioned' },
    { value: 'opportunities', label: 'Opportunities' },
    { value: 'risks', label: 'Risks' },
  ]

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="mb-6"
      >
        <h1 className="font-display text-3xl font-semibold text-ink flex items-center gap-2.5">
          <BrainCircuit className="h-7 w-7 text-ember" />
          Learning Loop
        </h1>
        <p className="text-sm text-dim mt-1">Signal capture &amp; insight engine</p>
      </motion.div>

      {/* Two-panel layout */}
      <div className="flex gap-5 items-start">

        {/* Left panel — Signals (35%) */}
        <div className="w-[35%] shrink-0">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SPRING, delay: 0.08 }}
            className="rounded-xl border border-border bg-paper overflow-hidden"
          >
            {/* Panel header */}
            <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-ember" />
                <span className="text-sm font-semibold text-ink">Signals</span>
                <span className="text-xs text-dim font-mono">({allSignals.length})</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRecord(!showRecord)}
                className="gap-1.5 h-7 text-xs"
              >
                <Plus className="h-3 w-3" />
                Record
              </Button>
            </div>

            <div className="p-4">
              {/* Inline record form */}
              <RecordSignalForm
                open={showRecord}
                onClose={() => setShowRecord(false)}
                slug={slug}
                brandId={brandId}
              />

              {/* Signal feed */}
              {signalsLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-2 py-3">
                      <div className="skeleton h-5 w-16 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <div className="skeleton h-4 w-3/4" />
                        <div className="skeleton h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : allSignals.length === 0 ? (
                <div className="py-10 text-center">
                  <Radio className="h-8 w-8 text-dim mx-auto mb-2" />
                  <p className="text-sm text-dim">No signals recorded yet.</p>
                </div>
              ) : (
                <div>
                  <div className="divide-y divide-border">
                    <AnimatePresence mode="popLayout">
                      {displayedSignals.map((s, i) => (
                        <SignalItem key={s.id} signal={s} index={i} />
                      ))}
                    </AnimatePresence>
                  </div>
                  {allSignals.length > signalPage * 20 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-3 text-center"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSignalPage((p) => p + 1)}
                        className="gap-1.5 text-xs"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                        Load more ({allSignals.length - signalPage * 20} remaining)
                      </Button>
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Right panel — Insights (65%) */}
        <div className="flex-1 min-w-0">
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SPRING, delay: 0.12 }}
            className="rounded-xl border border-border bg-paper overflow-hidden relative"
          >
            {/* Panel header */}
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-ember" />
                <span className="text-sm font-semibold text-ink">Insights</span>
                <span className="text-xs text-dim font-mono">({filteredInsights.length})</span>
              </div>

              {/* Filter pills */}
              <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-border">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setInsightFilter(opt.value)}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                      insightFilter === opt.value
                        ? 'bg-ember text-white shadow-sm'
                        : 'text-dim hover:text-ink',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <Button
                size="sm"
                onClick={handleProcess}
                loading={processMutation.isPending}
                disabled={processing}
                className="gap-1.5 h-8 text-xs"
              >
                {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Process Signals
              </Button>
            </div>

            {/* Processing overlay */}
            <AnimatePresence>
              {processing && (
                <ProcessingOverlay onDone={() => setProcessing(false)} />
              )}
            </AnimatePresence>

            <div className="p-5">
              {insightsLoading ? (
                <div className="space-y-4">
                  {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
                </div>
              ) : filteredInsights.length === 0 ? (
                <EmptyState
                  title="No insights yet"
                  description={insightFilter !== 'all' ? 'Try changing the filter.' : 'Record signals and run processing to surface insights.'}
                  action={
                    insightFilter === 'all'
                      ? <Button size="sm" onClick={handleProcess} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" />Process Signals</Button>
                      : <Button size="sm" variant="ghost" onClick={() => setInsightFilter('all')}>Clear filter</Button>
                  }
                />
              ) : (
                <div className="space-y-4">
                  <AnimatePresence mode="popLayout">
                    {filteredInsights.map((ins, i) => (
                      <InsightCard
                        key={ins.id}
                        insight={ins}
                        slug={slug}
                        brandId={brandId}
                        index={i}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
