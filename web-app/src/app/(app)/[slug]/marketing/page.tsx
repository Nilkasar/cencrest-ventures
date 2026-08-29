'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell, PieChart, Pie, Legend,
} from 'recharts'
import {
  Plus, Filter, TrendingUp, Target, DollarSign, BarChart2,
  ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Trash2,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, formatNumber, formatPercent, relativeTime } from '@/lib/utils'
import { spring, staggerContainer, staggerItem, fadeUp } from '@/design-system/motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter, ModalClose } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = 'email' | 'social' | 'content' | 'paid' | 'seo'
type CampaignStatus = 'active' | 'paused' | 'completed'
type LeverCategory = 'content' | 'distribution' | 'authority' | 'technical'
type Effort = 'low' | 'medium' | 'high'
type LeverStatus = 'active' | 'inactive'

interface Campaign {
  id: string
  name: string
  channel: Channel
  status: CampaignStatus
  budget: number
  start_date: string
  end_date: string
  target_metric: string
  key_metric_value?: number
}

interface CampaignMetric {
  label: string
  value: number
  date?: string
}

interface Lever {
  id: string
  name: string
  category: LeverCategory
  description: string
  impact_score: number
  effort: Effort
  status: LeverStatus
}

interface MarketingSummary {
  active_campaigns: number
  total_budget: number
  top_channel: string
  levers_in_progress: number
  budget_by_channel: { channel: string; budget: number }[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<Channel, string> = {
  email: '#2563EB',
  social: '#7C3AED',
  content: '#16A34A',
  paid: '#C2410C',
  seo: '#0891B2',
}

const CHANNEL_BADGE: Record<Channel, 'info' | 'default' | 'success' | 'ember' | 'warning'> = {
  email: 'info',
  social: 'default',
  content: 'success',
  paid: 'ember',
  seo: 'warning',
}

const STATUS_BADGE: Record<CampaignStatus, 'success' | 'warning' | 'default'> = {
  active: 'success',
  paused: 'warning',
  completed: 'default',
}

const EFFORT_NUM: Record<Effort, number> = { low: 1, medium: 2, high: 3 }
const PIE_COLORS = ['#C2410C', '#2563EB', '#16A34A', '#7C3AED', '#0891B2']

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useMarketing(slug: string) {
  const base = routes.marketing(slug)
  return {
    campaigns: useQuery<Campaign[]>({
      queryKey: ['marketing', slug, 'campaigns'],
      queryFn: () => api.get(`${base}/campaigns`),
    }),
    levers: useQuery<Lever[]>({
      queryKey: ['marketing', slug, 'levers'],
      queryFn: () => api.get(`${base}/levers`),
    }),
    summary: useQuery<MarketingSummary>({
      queryKey: ['marketing', slug, 'summary'],
      queryFn: () => api.get(`${base}/summary`),
    }),
  }
}

// ─── Campaign Metrics Inline ──────────────────────────────────────────────────

function CampaignMetricsInline({ slug, campaignId }: { slug: string; campaignId: string }) {
  const base = routes.marketing(slug)
  const { data, isLoading } = useQuery<CampaignMetric[]>({
    queryKey: ['marketing', slug, 'campaign-metrics', campaignId],
    queryFn: () => api.get(`${base}/campaigns/${campaignId}/metrics`),
  })

  if (isLoading) return <div className="h-32 flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-ember border-t-transparent animate-spin" /></div>
  if (!data?.length) return <p className="text-sm text-dim py-4 text-center">No metrics yet.</p>

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#DDD9D1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B6760', fontFamily: 'Inter, sans-serif' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6B6760', fontFamily: 'Inter, sans-serif' }} axisLine={false} tickLine={false} width={32} />
        <Tooltip contentStyle={{ background: '#F7F3EC', border: '1px solid #DDD9D1', borderRadius: 8, fontSize: 12, fontFamily: 'Inter, sans-serif' }} />
        <Bar dataKey="value" fill="#C2410C" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Campaign Card ────────────────────────────────────────────────────────────

function CampaignCard({ campaign, slug, onDelete }: { campaign: Campaign; slug: string; onDelete: () => void }) {
  const [expanded, setExpanded] = React.useState(false)
  const qc = useQueryClient()
  const base = routes.marketing(slug)

  const patchMutation = useMutation({
    mutationFn: (data: Partial<Campaign>) => api.patch(`${base}/campaigns/${campaign.id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing', slug, 'campaigns'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`${base}/campaigns/${campaign.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketing', slug, 'campaigns'] })
      onDelete()
    },
  })

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      whileHover={{ y: -2 }}
      transition={spring}
      className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-ink text-base leading-tight truncate">{campaign.name}</h3>
            <p className="text-xs text-dim font-mono mt-0.5">{campaign.start_date} → {campaign.end_date}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge variant={CHANNEL_BADGE[campaign.channel]} size="sm">{campaign.channel}</Badge>
            <Badge variant={STATUS_BADGE[campaign.status]} size="sm" dot>{campaign.status}</Badge>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm mb-4">
          <div className="flex items-center gap-1.5 text-dim">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="font-sans font-medium text-ink">${formatNumber(campaign.budget)}</span>
          </div>
          {campaign.key_metric_value !== undefined && (
            <div className="flex items-center gap-1.5 text-dim">
              <Target className="h-3.5 w-3.5" />
              <span className="font-mono text-xs text-ink">{campaign.target_metric}: {formatNumber(campaign.key_metric_value)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded(!expanded)}
            className="flex-1 gap-1.5"
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Metrics
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
            className="text-dim hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="metrics"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden border-t border-border"
          >
            <div className="px-5 py-4">
              <CampaignMetricsInline slug={slug} campaignId={campaign.id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── New Campaign Modal ───────────────────────────────────────────────────────

function NewCampaignModal({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const base = routes.marketing(slug)
  const [form, setForm] = React.useState({
    name: '', channel: '' as Channel, start_date: '', end_date: '',
    budget: '', target_metric: '',
  })

  const mutation = useMutation({
    mutationFn: () => api.post(`${base}/campaigns`, { ...form, budget: Number(form.budget) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketing', slug, 'campaigns'] })
      onClose()
      setForm({ name: '', channel: '' as Channel, start_date: '', end_date: '', budget: '', target_metric: '' })
    },
  })

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }))

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-md">
        <ModalHeader>
          <ModalTitle>New Campaign</ModalTitle>
        </ModalHeader>
        <ModalBody className="flex flex-col gap-4">
          <Input label="Campaign name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Q4 Email Blast" />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Channel</label>
            <Select value={form.channel} onValueChange={(v) => set('channel', v)}>
              <SelectTrigger><SelectValue placeholder="Select channel" /></SelectTrigger>
              <SelectContent>
                {(['email', 'social', 'content', 'paid', 'seo'] as Channel[]).map((c) => (
                  <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start date" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            <Input label="End date" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </div>
          <Input label="Budget ($)" type="number" value={form.budget} onChange={(e) => set('budget', e.target.value)} placeholder="5000" />
          <Input label="Target metric" value={form.target_metric} onChange={(e) => set('target_metric', e.target.value)} placeholder="Conversions, Clicks..." />
        </ModalBody>
        <ModalFooter>
          <ModalClose asChild><Button variant="outline" size="sm">Cancel</Button></ModalClose>
          <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()} disabled={!form.name || !form.channel}>
            Create Campaign
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── New Lever Modal ──────────────────────────────────────────────────────────

function NewLeverModal({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const base = routes.marketing(slug)
  const [form, setForm] = React.useState({
    name: '', category: '' as LeverCategory, description: '',
    impact_score: 5, effort: '' as Effort, status: 'active' as LeverStatus,
  })

  const mutation = useMutation({
    mutationFn: () => api.post(`${base}/levers`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketing', slug, 'levers'] })
      onClose()
      setForm({ name: '', category: '' as LeverCategory, description: '', impact_score: 5, effort: '' as Effort, status: 'active' })
    },
  })

  const set = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }))

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-md">
        <ModalHeader>
          <ModalTitle>New Growth Lever</ModalTitle>
        </ModalHeader>
        <ModalBody className="flex flex-col gap-4">
          <Input label="Lever name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Guest posting campaign" />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Category</label>
              <Select value={form.category} onValueChange={(v) => set('category', v)}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {(['content', 'distribution', 'authority', 'technical'] as LeverCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Effort</label>
              <Select value={form.effort} onValueChange={(v) => set('effort', v)}>
                <SelectTrigger><SelectValue placeholder="Effort" /></SelectTrigger>
                <SelectContent>
                  {(['low', 'medium', 'high'] as Effort[]).map((e) => (
                    <SelectItem key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="What does this lever do?"
              className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm font-sans text-ink placeholder:text-dim resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:border-ember transition-[border-color,box-shadow] duration-150"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-ink font-sans">Impact score</label>
              <span className="text-sm font-mono font-semibold text-ember">{form.impact_score}/10</span>
            </div>
            <input
              type="range" min={1} max={10} value={form.impact_score}
              onChange={(e) => set('impact_score', Number(e.target.value))}
              className="w-full accent-ember h-2 rounded-full cursor-pointer"
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalClose asChild><Button variant="outline" size="sm">Cancel</Button></ModalClose>
          <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()} disabled={!form.name || !form.category || !form.effort}>
            Create Lever
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────

function CampaignsTab({ slug }: { slug: string }) {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState<CampaignStatus | 'all'>('all')
  const { campaigns } = useMarketing(slug)

  const filtered = React.useMemo(() => {
    const all = campaigns.data ?? []
    return statusFilter === 'all' ? all : all.filter((c) => c.status === statusFilter)
  }, [campaigns.data, statusFilter])

  const statusOptions: Array<{ value: CampaignStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
    { value: 'completed', label: 'Completed' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-sans font-medium transition-colors duration-150',
                statusFilter === opt.value
                  ? 'bg-ink text-paper'
                  : 'bg-surface border border-border text-dim hover:text-ink hover:border-border-strong'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New Campaign
        </Button>
      </div>

      {campaigns.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center text-dim">
            <BarChart2 className="h-5 w-5" />
          </div>
          <p className="text-sm text-dim font-sans">No campaigns yet. Create your first one.</p>
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((c) => (
              <CampaignCard key={c.id} campaign={c} slug={slug} onDelete={() => {}} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <NewCampaignModal slug={slug} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}

// ─── Levers Tab ───────────────────────────────────────────────────────────────

const CATEGORY_BADGE: Record<LeverCategory, 'info' | 'success' | 'ember' | 'warning'> = {
  content: 'info',
  distribution: 'success',
  authority: 'ember',
  technical: 'warning',
}

const EFFORT_BADGE: Record<Effort, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
}

function LeversTab({ slug }: { slug: string }) {
  const qc = useQueryClient()
  const base = routes.marketing(slug)
  const [modalOpen, setModalOpen] = React.useState(false)
  const { levers } = useMarketing(slug)

  const sorted = React.useMemo(() => {
    return [...(levers.data ?? [])].sort((a, b) => {
      const ratioA = a.impact_score / EFFORT_NUM[a.effort]
      const ratioB = b.impact_score / EFFORT_NUM[b.effort]
      return ratioB - ratioA
    })
  }, [levers.data])

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeverStatus }) =>
      api.patch(`${base}/levers/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing', slug, 'levers'] }),
  })

  const scatterData = sorted.map((l) => ({
    x: EFFORT_NUM[l.effort],
    y: l.impact_score,
    name: l.name,
    id: l.id,
  }))

  return (
    <>
      <div className="flex items-center justify-end mb-5">
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New Lever
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Lever list */}
        <div className="xl:col-span-2 flex flex-col gap-3">
          {levers.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-20" />)
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <TrendingUp className="h-8 w-8 text-dim" />
              <p className="text-sm text-dim">No levers yet.</p>
            </div>
          ) : (
            <motion.div variants={staggerContainer} initial="initial" animate="animate" className="flex flex-col gap-3">
              <AnimatePresence>
                {sorted.map((lever) => (
                  <motion.div
                    key={lever.id}
                    variants={staggerItem}
                    layout
                    exit={{ opacity: 0, x: -16 }}
                    className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-sans font-medium text-ink text-sm">{lever.name}</span>
                        <Badge variant={CATEGORY_BADGE[lever.category]} size="sm">{lever.category}</Badge>
                        <Badge variant={EFFORT_BADGE[lever.effort]} size="sm">{lever.effort}</Badge>
                      </div>
                      <p className="text-xs text-dim font-sans truncate mb-2">{lever.description}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${lever.impact_score * 10}%` }}
                            transition={spring}
                            className="h-full bg-ember rounded-full"
                          />
                        </div>
                        <span className="text-xs font-mono text-ember font-semibold w-8 text-right">{lever.impact_score}/10</span>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleMutation.mutate({ id: lever.id, status: lever.status === 'active' ? 'inactive' : 'active' })}
                      className="flex-shrink-0 transition-colors"
                      aria-label="Toggle status"
                    >
                      {lever.status === 'active'
                        ? <ToggleRight className="h-6 w-6 text-success" />
                        : <ToggleLeft className="h-6 w-6 text-dim" />}
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        {/* Scatter chart */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h3 className="font-display font-semibold text-ink text-sm mb-1">Effort vs Impact</h3>
          <p className="text-xs text-dim font-sans mb-4">Each dot is a lever. Upper-left = quick wins.</p>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDD9D1" />
              <XAxis
                dataKey="x" type="number" domain={[0.5, 3.5]} ticks={[1, 2, 3]}
                tickFormatter={(v) => (['', 'Low', 'Med', 'High'][v] ?? '')}
                tick={{ fontSize: 10, fill: '#6B6760', fontFamily: 'Inter' }} axisLine={false} tickLine={false}
                label={{ value: 'Effort', position: 'insideBottom', offset: -4, fill: '#6B6760', fontSize: 10 }}
              />
              <YAxis
                dataKey="y" type="number" domain={[0, 10]}
                tick={{ fontSize: 10, fill: '#6B6760', fontFamily: 'Inter' }} axisLine={false} tickLine={false}
                label={{ value: 'Impact', angle: -90, position: 'insideLeft', fill: '#6B6760', fontSize: 10 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload
                  return (
                    <div className="bg-paper border border-border rounded-lg px-3 py-2 shadow-md text-xs font-sans">
                      <p className="font-medium text-ink">{d?.name}</p>
                      <p className="text-dim">Impact: {d?.y} · Effort: {(['', 'Low', 'Med', 'High'][d?.x] ?? '')}</p>
                    </div>
                  )
                }}
              />
              <Scatter data={scatterData} fill="#C2410C" opacity={0.85} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      <NewLeverModal slug={slug} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({ slug }: { slug: string }) {
  const { summary } = useMarketing(slug)
  const data = summary.data

  return (
    <div className="flex flex-col gap-8">
      {summary.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Active campaigns" value={data?.active_campaigns ?? 0} />
            <StatCard label="Total budget" value={data?.total_budget ?? 0} prefix="$" />
            <StatCard label="Levers in progress" value={data?.levers_in_progress ?? 0} />
            <div className="bg-surface border border-border border-l-2 border-l-ember rounded-lg shadow-sm p-6">
              <p className="text-sm font-sans text-dim mb-2">Top channel</p>
              <p className="font-display text-2xl font-semibold text-ink capitalize">{data?.top_channel ?? '—'}</p>
            </div>
          </div>

          {data?.budget_by_channel?.length ? (
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="font-display font-semibold text-ink mb-6">Budget by Channel</h3>
              <div className="flex items-center gap-8">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={data.budget_by_channel}
                      dataKey="budget"
                      nameKey="channel"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {data.budget_by_channel.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [`$${formatNumber(Number(v))}`, 'Budget']}
                      contentStyle={{ background: '#F7F3EC', border: '1px solid #DDD9D1', borderRadius: 8, fontSize: 12, fontFamily: 'Inter' }}
                    />
                    <Legend
                      formatter={(v) => <span className="text-xs font-sans text-ink capitalize">{v}</span>}
                      iconType="circle"
                      iconSize={8}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const { slug } = useParams<{ slug: string }>()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="flex flex-col gap-6 p-6 max-w-7xl mx-auto"
    >
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink leading-tight">Marketing</h1>
        <p className="text-sm text-dim font-sans mt-1">Campaign tracking &amp; growth levers</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="levers">Levers</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns">
          <CampaignsTab slug={slug} />
        </TabsContent>

        <TabsContent value="levers">
          <LeversTab slug={slug} />
        </TabsContent>

        <TabsContent value="summary">
          <SummaryTab slug={slug} />
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}
