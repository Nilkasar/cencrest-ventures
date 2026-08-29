'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Users, ThumbsDown, Link2Off, ExternalLink,
  ChevronDown, ChevronUp, Zap, MessageSquareOff,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, formatNumber } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

// ── Types ──────────────────────────────────────────────────────────────────

type GapType = 'no_mention' | 'competitor_only' | 'low_sentiment' | 'no_citation' | 'ok'
type Severity = 'critical' | 'high' | 'medium' | 'low'

interface GeoGapSummary {
  total_gaps: number
  high_severity: number
  no_mention_queries: number
  avg_gap_score: number
  no_mention: number
  low_sentiment: number
  competitor_only: number
}

interface GeoGapTypeSummary {
  no_mention: number
  competitor_only: number
  low_sentiment: number
  no_citation: number
}

interface HeatmapCell {
  query_id: string
  provider: string
  gap_type: GapType
  details?: string
}

interface HeatmapRow {
  query_id: string
  query: string
  cells: Record<string, HeatmapCell>
}

interface GeoGap extends Record<string, unknown> {
  id: string
  query: string
  stage: string
  provider: string
  gap_type: GapType
  severity: Severity
  business_impact: string
}

interface RootCause {
  url: string
  gap_count: number
}

// ── Gap type config ────────────────────────────────────────────────────────

const GAP_TYPE_CONFIG: Record<GapType, {
  label: string
  icon: React.ReactNode
  description: string
  bgClass: string
  textClass: string
  borderColor: string
  iconBg: string
}> = {
  no_mention: {
    label: 'No Mention',
    icon: <Brain className="h-5 w-5" />,
    description: 'Brand not mentioned at all in AI response',
    bgClass: 'bg-danger-muted',
    textClass: 'text-danger',
    borderColor: 'border-l-[var(--color-danger)]',
    iconBg: 'bg-danger-muted',
  },
  competitor_only: {
    label: 'Competitor Only',
    icon: <Users className="h-5 w-5" />,
    description: 'Competitors mentioned, brand absent',
    bgClass: 'bg-warning-muted',
    textClass: 'text-warning',
    borderColor: 'border-l-[var(--color-warning)]',
    iconBg: 'bg-warning-muted',
  },
  low_sentiment: {
    label: 'Low Sentiment',
    icon: <ThumbsDown className="h-5 w-5" />,
    description: 'Mentioned but negative or neutral framing',
    bgClass: 'bg-[#FFF3CD]',
    textClass: 'text-[#B45309]',
    borderColor: 'border-l-[#D97706]',
    iconBg: 'bg-[#FFF3CD]',
  },
  no_citation: {
    label: 'No Citation',
    icon: <Link2Off className="h-5 w-5" />,
    description: 'Mentioned but no source URL linked',
    bgClass: 'bg-[var(--surface)]',
    textClass: 'text-[var(--slate)]',
    borderColor: 'border-l-[var(--slate)]',
    iconBg: 'bg-[var(--surface)]',
  },
  ok: {
    label: 'OK',
    icon: <Zap className="h-5 w-5" />,
    description: 'Brand mentioned with citation',
    bgClass: 'bg-success-muted',
    textClass: 'text-success',
    borderColor: 'border-l-success',
    iconBg: 'bg-success-muted',
  },
}

// ── Heatmap cell color ─────────────────────────────────────────────────────

const CELL_COLOR: Record<GapType, string> = {
  no_mention: '#EF4444',
  competitor_only: '#F97316',
  low_sentiment: '#EAB308',
  no_citation: '#3B82F6',
  ok: '#22C55E',
}

const PROVIDERS = ['ChatGPT', 'Gemini', 'Claude', 'Perplexity']

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
}

const cardUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
}

// ── Summary Stat Row ───────────────────────────────────────────────────────

function SummaryStatRow({ summary, loading }: { summary?: GeoGapSummary; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    )
  }

  const cards = [
    {
      label: 'Total Gaps',
      value: summary?.total_gaps ?? 0,
      icon: <MessageSquareOff className="h-4 w-4 text-dim" />,
      cardClass: 'border-[var(--border)]',
      valClass: 'text-ink',
    },
    {
      label: 'No Mention',
      value: summary?.no_mention ?? 0,
      icon: <Brain className="h-4 w-4 text-[var(--danger)]" />,
      cardClass: 'border-[var(--danger)]/40 bg-[var(--danger)]/5',
      valClass: 'text-[var(--danger)]',
    },
    {
      label: 'Low Sentiment',
      value: summary?.low_sentiment ?? 0,
      icon: <ThumbsDown className="h-4 w-4 text-[#D97706]" />,
      cardClass: 'border-[#D97706]/40 bg-[#D97706]/5',
      valClass: 'text-[#D97706]',
    },
    {
      label: 'Competitor Only',
      value: summary?.competitor_only ?? 0,
      icon: <Users className="h-4 w-4 text-[var(--ember)]" />,
      cardClass: 'border-[var(--ember)]/40 bg-[var(--ember)]/5',
      valClass: 'text-[var(--ember)]',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn('rounded-xl border px-5 py-4 bg-white/60', c.cardClass)}
        >
          <div className="flex items-center gap-1.5 mb-2">{c.icon}</div>
          <p className={cn('font-display text-3xl font-bold', c.valClass)}>
            {formatNumber(c.value)}
          </p>
          <p className="text-xs text-[var(--dim)] uppercase tracking-wide mt-0.5">{c.label}</p>
        </div>
      ))}
    </div>
  )
}

// ── Gap Type Cards 2x2 ─────────────────────────────────────────────────────

function GapTypeCards({ slug, brandId, totalGaps }: { slug: string; brandId: string; totalGaps: number }) {
  const { data, isLoading } = useQuery<GeoGapTypeSummary>({
    queryKey: ['geo-gaps-types', slug, brandId],
    queryFn: () => api.get(`${routes.geoGaps(slug, brandId)}/types`),
  })

  const types: Array<{ key: keyof GeoGapTypeSummary; gapType: Exclude<GapType, 'ok'> }> = [
    { key: 'no_mention', gapType: 'no_mention' },
    { key: 'competitor_only', gapType: 'competitor_only' },
    { key: 'low_sentiment', gapType: 'low_sentiment' },
    { key: 'no_citation', gapType: 'no_citation' },
  ]

  const iconBgMap: Record<string, string> = {
    no_mention: 'bg-[var(--danger)]/10',
    competitor_only: 'bg-[var(--warning)]/10',
    low_sentiment: 'bg-[#D97706]/10',
    no_citation: 'bg-[var(--surface)]',
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <motion.div
      className="grid grid-cols-2 gap-4 mb-6"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {types.map(({ key, gapType }) => {
        const cfg = GAP_TYPE_CONFIG[gapType]
        const count = data?.[key] ?? 0
        const pct = totalGaps > 0 ? Math.round((count / totalGaps) * 100) : 0
        return (
          <motion.div key={key} variants={cardUp}>
            <div className="rounded-xl border p-5 bg-white/60 flex gap-4">
              <div className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                iconBgMap[gapType],
                cfg.textClass,
              )}>
                {cfg.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-base font-semibold text-[var(--ink)]">{cfg.label}</p>
                <p className={cn('text-2xl font-bold', cfg.textClass)}>{formatNumber(count)}</p>
                <p className="text-xs text-[var(--dim)] mt-0.5">{cfg.description} · {pct}%</p>
              </div>
            </div>
          </motion.div>
        )
      })}
    </motion.div>
  )
}

// ── Heatmap ────────────────────────────────────────────────────────────────

function GapHeatmap({ slug, brandId }: { slug: string; brandId: string }) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number; gap?: GapType; details?: string } | null>(null)

  const { data: heatmapData = [], isLoading } = useQuery<HeatmapRow[]>({
    queryKey: ['geo-gaps-heatmap', slug, brandId],
    queryFn: () => api.get(`${routes.geoGaps(slug, brandId)}`),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded" />
        ))}
      </div>
    )
  }

  if (heatmapData.length === 0) {
    return (
      <EmptyState
        icon={<Brain className="h-6 w-6" />}
        title="No gap data"
        description="Run a GEO analysis to see the heatmap."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        <div className="flex items-center mb-2">
          <div className="w-48 shrink-0" />
          {PROVIDERS.map((p) => (
            <div key={p} className="flex-1 text-center">
              <span className="text-xs font-sans font-medium text-[var(--dim)] uppercase tracking-wide">{p}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {heatmapData.map((row, ri) => (
            <div key={row.query_id} className="flex items-center gap-2">
              <div className="w-48 shrink-0">
                <p className="text-xs text-[var(--dim)] font-sans truncate pr-3" title={row.query}>{row.query}</p>
              </div>
              {PROVIDERS.map((provider, ci) => {
                const cell = row.cells[provider]
                const gapType: GapType = cell?.gap_type ?? 'ok'
                const isHovered = hoveredCell?.row === ri && hoveredCell?.col === ci
                const idx = ri * PROVIDERS.length + ci
                return (
                  <motion.div
                    key={provider}
                    className="flex-1 relative"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.008, duration: 0.2 }}
                  >
                    <div
                      className={cn('h-8 rounded cursor-pointer transition-all duration-150 relative', isHovered && 'ring-2 ring-ink ring-offset-1 z-10')}
                      style={{ backgroundColor: CELL_COLOR[gapType] }}
                      onMouseEnter={() => setHoveredCell({ row: ri, col: ci, gap: gapType, details: cell?.details })}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                    <AnimatePresence>
                      {isHovered && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute z-20 bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-[var(--ink)] text-[var(--paper)] rounded-lg p-3 shadow-xl text-xs font-sans pointer-events-none"
                        >
                          <p className="font-semibold mb-1">{GAP_TYPE_CONFIG[gapType].label}</p>
                          <p className="text-[var(--paper)]/70">{GAP_TYPE_CONFIG[gapType].description}</p>
                          {hoveredCell?.details && <p className="text-[var(--paper)]/60 mt-1 italic">{hoveredCell.details}</p>}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[var(--ink)]" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-5 flex-wrap">
          {(Object.entries(GAP_TYPE_CONFIG) as [GapType, typeof GAP_TYPE_CONFIG[GapType]][]).map(([key, cfg]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CELL_COLOR[key] }} />
              <span className="text-xs text-[var(--dim)] font-sans">{cfg.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Root Causes ────────────────────────────────────────────────────────────

function RootCauses({ slug, brandId }: { slug: string; brandId: string }) {
  const { data: causes = [], isLoading } = useQuery<RootCause[]>({
    queryKey: ['geo-root-causes', slug, brandId],
    queryFn: () => api.get(`${routes.geoGaps(slug, brandId)}/root-causes`),
  })

  if (isLoading) return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
    </div>
  )

  if (causes.length === 0) return null

  return (
    <div className="space-y-2">
      {causes.slice(0, 5).map((c, i) => (
        <motion.div
          key={c.url}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.07 }}
          className="flex items-center justify-between bg-[var(--paper)] border border-[var(--border)] rounded-lg px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-md bg-danger-muted flex items-center justify-center shrink-0">
              <span className="text-xs font-mono font-bold text-danger">{i + 1}</span>
            </div>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-sans text-[var(--ink)] hover:text-[var(--ember)] transition-colors truncate max-w-[380px] flex items-center gap-1"
            >
              {c.url}
              <ExternalLink className="h-3 w-3 shrink-0 text-[var(--dim)]" />
            </a>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-4">
            <Badge variant="danger" size="sm">{c.gap_count} gaps</Badge>
            <Button variant="outline" size="sm">Analyze Content</Button>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ── Gap Detail Table ───────────────────────────────────────────────────────

function GapDetailTable({ slug, brandId }: { slug: string; brandId: string }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [gapTypeFilter, setGapTypeFilter] = useState<GapType | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all')
  const [sortFilter, setSortFilter] = useState<'severity' | 'gap_type'>('severity')
  const qc = useQueryClient()

  const { data: gaps = [], isLoading } = useQuery<GeoGap[]>({
    queryKey: ['geo-gaps-detail', slug, brandId],
    queryFn: () => api.get(`${routes.geoGaps(slug, brandId)}/detail`),
  })

  const dismissMutation = useMutation({
    mutationFn: (gapId: string) => api.delete(`${routes.geoGaps(slug, brandId)}/${gapId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geo-gaps-detail', slug, brandId] }),
  })

  const filtered = gaps
    .filter((g) => gapTypeFilter === 'all' || g.gap_type === gapTypeFilter)
    .filter((g) => severityFilter === 'all' || g.severity === severityFilter)
    .sort((a, b) => {
      if (sortFilter === 'severity') {
        const order: Severity[] = ['critical', 'high', 'medium', 'low']
        return order.indexOf(a.severity) - order.indexOf(b.severity)
      }
      return a.gap_type.localeCompare(b.gap_type)
    })

  const severityVariant = (s: Severity): 'danger' | 'warning' | 'info' | 'outline' => {
    switch (s) {
      case 'critical': return 'danger'
      case 'high': return 'warning'
      case 'medium': return 'info'
      default: return 'outline'
    }
  }

  const gapTypeBadge = (gt: GapType) => {
    const cfg = GAP_TYPE_CONFIG[gt]
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-sans font-medium px-2 py-0.5 rounded-full', cfg.bgClass, cfg.textClass)}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {cfg.label}
      </span>
    )
  }

  const columns: Column<GeoGap>[] = [
    {
      key: 'query',
      header: 'Query',
      render: (_, row) => <span className="font-medium text-[var(--ink)] max-w-[200px] block truncate">{row.query}</span>,
    },
    {
      key: 'stage',
      header: 'Stage',
      render: (_, row) => <span className="text-[var(--dim)] text-sm">{row.stage}</span>,
    },
    {
      key: 'provider',
      header: 'Provider',
      render: (_, row) => <Badge variant="outline" size="sm">{row.provider}</Badge>,
    },
    {
      key: 'gap_type',
      header: 'Gap Type',
      render: (_, row) => gapTypeBadge(row.gap_type),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (_, row) => <Badge variant={severityVariant(row.severity)} size="sm" dot>{row.severity}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === row.id ? null : row.id) }}
            className="text-[var(--dim)] hover:text-[var(--ink)] transition-colors"
          >
            {expandedRow === row.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(row.id) }}
            disabled={dismissMutation.isPending}
          >
            Dismiss
          </Button>
        </div>
      ),
    },
  ]

  if (isLoading) return <SkeletonCard />

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={gapTypeFilter}
          onChange={(e) => setGapTypeFilter(e.target.value as GapType | 'all')}
          className="h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--paper)] text-xs font-sans text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
        >
          <option value="all">All Gap Types</option>
          <option value="no_mention">No Mention</option>
          <option value="competitor_only">Competitor Only</option>
          <option value="low_sentiment">Low Sentiment</option>
          <option value="no_citation">No Citation</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as Severity | 'all')}
          className="h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--paper)] text-xs font-sans text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={sortFilter}
          onChange={(e) => setSortFilter(e.target.value as 'severity' | 'gap_type')}
          className="h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--paper)] text-xs font-sans text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
        >
          <option value="severity">Sort: Severity</option>
          <option value="gap_type">Sort: Gap Type</option>
        </select>
        <span className="text-xs text-[var(--dim)] ml-auto">{filtered.length} gaps</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Brain className="h-6 w-6" />}
          title="No GEO gaps detected"
          description="Your brand has full AI visibility across all queries."
        />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          rowKey={(r) => r.id}
        />
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function GEOPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()

  const { data: summary, isLoading: summaryLoading } = useQuery<GeoGapSummary>({
    queryKey: ['geo-gaps-summary', slug, brandId],
    queryFn: () => api.get(`${routes.geoGaps(slug, brandId)}/summary`),
  })

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">GEO Gaps</h1>
          <p className="text-sm text-[var(--dim)] font-sans mt-1">AI recommendation coverage gaps by query and provider</p>
        </div>
      </div>

      {/* Summary stat row */}
      <SummaryStatRow summary={summary} loading={summaryLoading} />

      {/* Gap Type Distribution 2×2 */}
      <section>
        <h2 className="font-display text-base font-semibold text-[var(--ink)] mb-4">Gap Type Breakdown</h2>
        <GapTypeCards slug={slug} brandId={brandId} totalGaps={summary?.total_gaps ?? 0} />
      </section>

      {/* Gap Detail Table */}
      <section>
        <h2 className="font-display text-base font-semibold text-[var(--ink)] mb-4">Gap Details</h2>
        <GapDetailTable slug={slug} brandId={brandId} />
      </section>

      {/* Heatmap */}
      <section>
        <h2 className="font-display text-base font-semibold text-[var(--ink)] mb-1">Gap Heatmap</h2>
        <p className="text-sm text-[var(--dim)] font-sans mb-5">Each row = query, each column = AI provider. Color = gap type.</p>
        <Card>
          <CardContent className="pt-6">
            <GapHeatmap slug={slug} brandId={brandId} />
          </CardContent>
        </Card>
      </section>

      {/* Root Causes */}
      <section>
        <h2 className="font-display text-base font-semibold text-[var(--ink)] mb-1">Root Cause Pages</h2>
        <p className="text-sm text-[var(--dim)] font-sans mb-4">Pages whose content gaps drive the most AI visibility failures.</p>
        <RootCauses slug={slug} brandId={brandId} />
      </section>
    </div>
  )
}
