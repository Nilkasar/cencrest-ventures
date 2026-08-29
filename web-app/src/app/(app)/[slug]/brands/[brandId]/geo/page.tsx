'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, MessageSquareOff, Users, ThumbsDown, Link2Off, ExternalLink,
  ChevronDown, ChevronUp, Zap,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, formatNumber, priorityColor } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { DataTable, type Column } from '@/components/ui/data-table'
import { StatCard } from '@/components/ui/stat-card'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'

// ── Types ──────────────────────────────────────────────────────────────────

type GapType = 'no_mention' | 'competitor_only' | 'low_sentiment' | 'no_citation' | 'ok'
type Severity = 'critical' | 'high' | 'medium' | 'low'

interface GeoGapSummary {
  total_gaps: number
  high_severity: number
  no_mention_queries: number
  avg_gap_score: number
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
  dotClass: string
}> = {
  no_mention: {
    label: 'No Mention',
    icon: <MessageSquareOff className="h-5 w-5" />,
    description: 'Brand not mentioned at all in AI response',
    bgClass: 'bg-danger-muted',
    textClass: 'text-danger',
    dotClass: 'bg-danger',
  },
  competitor_only: {
    label: 'Competitor Only',
    icon: <Users className="h-5 w-5" />,
    description: 'Competitors mentioned, brand absent',
    bgClass: 'bg-warning-muted',
    textClass: 'text-warning',
    dotClass: 'bg-warning',
  },
  low_sentiment: {
    label: 'Low Sentiment',
    icon: <ThumbsDown className="h-5 w-5" />,
    description: 'Mentioned but negative or neutral framing',
    bgClass: 'bg-[#FFF3CD]',
    textClass: 'text-[#B45309]',
    dotClass: 'bg-[#B45309]',
  },
  no_citation: {
    label: 'No Citation',
    icon: <Link2Off className="h-5 w-5" />,
    description: 'Mentioned but no source URL linked',
    bgClass: 'bg-info-muted',
    textClass: 'text-info',
    dotClass: 'bg-info',
  },
  ok: {
    label: 'OK',
    icon: <Zap className="h-5 w-5" />,
    description: 'Brand mentioned with citation',
    bgClass: 'bg-success-muted',
    textClass: 'text-success',
    dotClass: 'bg-success',
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
        {/* Header */}
        <div className="flex items-center mb-2">
          <div className="w-48 shrink-0" />
          {PROVIDERS.map((p) => (
            <div key={p} className="flex-1 text-center">
              <span className="text-xs font-sans font-medium text-dim uppercase tracking-wide">{p}</span>
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="space-y-1.5">
          {heatmapData.map((row, ri) => (
            <div key={row.query_id} className="flex items-center gap-2">
              <div className="w-48 shrink-0">
                <p className="text-xs text-dim font-sans truncate pr-3" title={row.query}>
                  {row.query}
                </p>
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
                      className={cn(
                        'h-8 rounded cursor-pointer transition-all duration-150 relative',
                        isHovered && 'ring-2 ring-ink ring-offset-1 z-10'
                      )}
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
                          className="absolute z-20 bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-ink text-paper rounded-lg p-3 shadow-xl text-xs font-sans pointer-events-none"
                        >
                          <p className="font-semibold mb-1">{GAP_TYPE_CONFIG[gapType].label}</p>
                          <p className="text-paper/70">{GAP_TYPE_CONFIG[gapType].description}</p>
                          {hoveredCell?.details && (
                            <p className="text-paper/60 mt-1 italic">{hoveredCell.details}</p>
                          )}
                          {/* Arrow */}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-ink" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-5 flex-wrap">
          {(Object.entries(GAP_TYPE_CONFIG) as [GapType, typeof GAP_TYPE_CONFIG[GapType]][]).map(([key, cfg]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CELL_COLOR[key] }} />
              <span className="text-xs text-dim font-sans">{cfg.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Gap Type Distribution ──────────────────────────────────────────────────

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
}

const cardUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 260, damping: 20 } },
}

function GapTypeDistribution({ slug, brandId }: { slug: string; brandId: string }) {
  const { data, isLoading } = useQuery<GeoGapTypeSummary>({
    queryKey: ['geo-gaps-types', slug, brandId],
    queryFn: () => api.get(`${routes.geoGaps(slug, brandId)}/types`),
  })

  const types: { key: keyof GeoGapTypeSummary; gapType: GapType }[] = [
    { key: 'no_mention', gapType: 'no_mention' },
    { key: 'competitor_only', gapType: 'competitor_only' },
    { key: 'low_sentiment', gapType: 'low_sentiment' },
    { key: 'no_citation', gapType: 'no_citation' },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <motion.div
      className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {types.map(({ key, gapType }) => {
        const cfg = GAP_TYPE_CONFIG[gapType]
        const count = data?.[key] ?? 0
        return (
          <motion.div key={key} variants={cardUp}>
            <div className={cn('rounded-xl p-5 border', cfg.bgClass, 'border-transparent')}>
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', cfg.bgClass, cfg.textClass)}>
                {cfg.icon}
              </div>
              <p className={cn('font-display text-4xl font-bold mb-1', cfg.textClass)}>
                {formatNumber(count)}
              </p>
              <p className="font-sans font-semibold text-sm text-ink mb-1">{cfg.label}</p>
              <p className="text-xs text-dim font-sans leading-snug">{cfg.description}</p>
            </div>
          </motion.div>
        )
      })}
    </motion.div>
  )
}

// ── Root Cause Section ─────────────────────────────────────────────────────

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
          className="flex items-center justify-between bg-surface border border-border rounded-lg px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-md bg-danger-muted flex items-center justify-center shrink-0">
              <span className="text-xs font-mono font-bold text-danger">{i + 1}</span>
            </div>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-sans text-ink hover:text-ember transition-colors truncate max-w-[380px] flex items-center gap-1"
            >
              {c.url}
              <ExternalLink className="h-3 w-3 shrink-0 text-dim" />
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

  const { data: gaps = [], isLoading } = useQuery<GeoGap[]>({
    queryKey: ['geo-gaps-detail', slug, brandId],
    queryFn: () => api.get(`${routes.geoGaps(slug, brandId)}/detail`),
  })

  const sorted = [...gaps].sort((a, b) => {
    const order: Severity[] = ['critical', 'high', 'medium', 'low']
    return order.indexOf(a.severity) - order.indexOf(b.severity)
  })

  const severityVariant = (s: Severity) => {
    switch (s) {
      case 'critical': return 'danger'
      case 'high': return 'warning'
      case 'medium': return 'info'
      default: return 'default'
    }
  }

  const gapTypeBadge = (gt: GapType) => {
    const cfg = GAP_TYPE_CONFIG[gt]
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-sans font-medium px-2 py-0.5 rounded-full', cfg.bgClass, cfg.textClass)}>
        <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dotClass)} />
        {cfg.label}
      </span>
    )
  }

  const columns: Column<GeoGap>[] = [
    {
      key: 'query',
      header: 'Query',
      render: (_, row) => <span className="font-medium text-ink max-w-[200px] block truncate">{row.query}</span>,
    },
    {
      key: 'stage',
      header: 'Stage',
      render: (_, row) => <span className="text-dim text-sm">{row.stage}</span>,
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
      key: 'business_impact',
      header: 'Business Impact',
      render: (_, row) => (
        <span className="text-sm text-dim max-w-[200px] block truncate">{row.business_impact}</span>
      ),
    },
    {
      key: 'expand',
      header: '',
      render: (_, row) => (
        <button
          onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === row.id ? null : row.id) }}
          className="text-dim hover:text-ink transition-colors"
        >
          {expandedRow === row.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      ),
    },
  ]

  if (isLoading) return <SkeletonCard />

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<Brain className="h-6 w-6" />}
        title="No GEO gaps detected"
        description="Your brand has full AI visibility across all queries."
      />
    )
  }

  return (
    <div>
      <DataTable
        data={sorted}
        columns={columns}
        rowKey={(r) => r.id}
      />
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
    <div className="p-6 max-w-6xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-ember/10 flex items-center justify-center">
          <Brain className="h-5 w-5 text-ember" />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">GEO Intelligence</h1>
          <p className="text-sm text-dim font-sans">AI visibility gaps across providers and buyer journey stages</p>
        </div>
      </div>

      {/* 1. Summary Stats */}
      <section>
        {summaryLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Gaps" value={summary?.total_gaps ?? 0} />
            <StatCard label="High Severity" value={summary?.high_severity ?? 0} />
            <StatCard label="No-Mention Queries" value={summary?.no_mention_queries ?? 0} />
            <StatCard label="Avg Gap Score" value={summary?.avg_gap_score ?? 0} decimals={1} />
          </div>
        )}
      </section>

      {/* 2. Gap Type Distribution */}
      <section>
        <h2 className="font-display text-base font-semibold text-ink mb-4">Gap Type Distribution</h2>
        <GapTypeDistribution slug={slug} brandId={brandId} />
      </section>

      {/* 3. Heatmap */}
      <section>
        <h2 className="font-display text-base font-semibold text-ink mb-2">Gap Heatmap</h2>
        <p className="text-sm text-dim font-sans mb-5">Each row = query, each column = AI provider. Color = gap type.</p>
        <Card>
          <CardContent className="pt-6">
            <GapHeatmap slug={slug} brandId={brandId} />
          </CardContent>
        </Card>
      </section>

      {/* 4. Gap Detail Table */}
      <section>
        <h2 className="font-display text-base font-semibold text-ink mb-4">Gap Details</h2>
        <GapDetailTable slug={slug} brandId={brandId} />
      </section>

      {/* 5. Root Causes */}
      <section>
        <h2 className="font-display text-base font-semibold text-ink mb-1">Root Cause Pages</h2>
        <p className="text-sm text-dim font-sans mb-4">Pages whose content gaps drive the most AI visibility failures.</p>
        <RootCauses slug={slug} brandId={brandId} />
      </section>
    </div>
  )
}
