'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, Zap, ArrowUpRight } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ScoreRing } from '@/components/ui/score-ring'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tier = 'P1' | 'P2' | 'P3'
type OppType = 'keyword_gap' | 'geo_gap' | 'content_gap'
type SortKey = 'unified_score' | 'volume' | 'effort'

interface Opportunity {
  id: string
  title: string
  tier: Tier
  type: OppType
  unified_score: number
  seo_score: number
  geo_score: number
  volume?: number
  effort?: number
  recommended_actions?: string[]
  description?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SPRING = [0.16, 1, 0.3, 1] as [number, number, number, number]

function tierBadgeVariant(tier: Tier): 'danger' | 'warning' | 'info' {
  switch (tier) {
    case 'P1': return 'danger'
    case 'P2': return 'warning'
    case 'P3': return 'info'
  }
}

function tierLabel(tier: Tier) {
  switch (tier) {
    case 'P1': return 'Critical'
    case 'P2': return 'High'
    case 'P3': return 'Medium'
  }
}

function typeBadgeVariant(type: OppType): 'outline' | 'info' | 'warning' {
  switch (type) {
    case 'keyword_gap': return 'outline'
    case 'geo_gap': return 'info'
    case 'content_gap': return 'warning'
  }
}

function typeLabel(type: OppType) {
  switch (type) {
    case 'keyword_gap': return 'Keyword Gap'
    case 'geo_gap': return 'GEO Gap'
    case 'content_gap': return 'Content Gap'
  }
}

function priorityBgClass(tier: Tier) {
  switch (tier) {
    case 'P1': return 'bg-[var(--danger)] text-white'
    case 'P2': return 'bg-[var(--warning)] text-white'
    case 'P3': return 'border border-[var(--border)] text-[var(--ink)] bg-transparent'
  }
}

// ─── Opportunity Card ─────────────────────────────────────────────────────────

function OppCard({
  opp,
  selected,
  onClick,
  index,
}: {
  opp: Opportunity
  selected: boolean
  onClick: () => void
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: SPRING, delay: index * 0.05 }}
      className={cn(
        'rounded-xl border border-[var(--border)] bg-white/70 p-5 mb-3',
        'hover:border-[var(--ember)]/50 transition-colors cursor-pointer',
        selected && 'ring-2 ring-[var(--ember)] ring-offset-1',
      )}
      onClick={onClick}
    >
      {/* Top row */}
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold font-sans', priorityBgClass(opp.tier))}>
          {opp.tier}
        </span>
        <Badge variant={typeBadgeVariant(opp.type)} size="sm">{typeLabel(opp.type)}</Badge>
        <span className="ml-auto font-display text-2xl font-bold text-[var(--ember)]">{opp.unified_score}</span>
      </div>

      {/* Title */}
      <p className="font-display text-lg font-semibold text-[var(--ink)] mt-2 leading-snug">{opp.title}</p>

      {/* Description */}
      {opp.description && (
        <p className="text-sm text-[var(--dim)] mt-1 line-clamp-2">{opp.description}</p>
      )}

      {/* Score bar */}
      <div className="w-full h-1.5 bg-[var(--border)] rounded-full mt-3 overflow-hidden">
        <motion.div
          className="h-1.5 rounded-full bg-[var(--ember)]"
          initial={{ width: 0 }}
          animate={{ width: `${opp.unified_score}%` }}
          transition={{ duration: 0.6, ease: 'easeOut', delay: index * 0.05 + 0.15 }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 mt-3">
        {opp.volume != null && (
          <span className="text-xs text-[var(--dim)] font-mono">{opp.volume.toLocaleString()} vol</span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={(e) => e.stopPropagation()}
        >
          Create Action →
        </Button>
      </div>
    </motion.div>
  )
}

// ─── P3 Compact Row ───────────────────────────────────────────────────────────

function P3Row({
  opp,
  selected,
  onClick,
  index,
}: {
  opp: Opportunity
  selected: boolean
  onClick: () => void
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: SPRING, delay: index * 0.04 }}
    >
      <button
        onClick={onClick}
        className={cn(
          'w-full text-left flex items-center gap-3 px-3 py-2 rounded-md border transition-all hover:bg-[var(--surface)]/80',
          selected ? 'ring-2 ring-[var(--ember)] border-[var(--ember)]/30' : 'border-[var(--border)] bg-[var(--paper)]',
        )}
      >
        <span
          className="text-xs font-mono font-semibold w-8 text-right shrink-0"
          style={{ color: opp.unified_score >= 50 ? 'var(--warning)' : 'var(--danger)' }}
        >
          {opp.unified_score}
        </span>
        <span className="text-sm text-[var(--ink)] flex-1 truncate">{opp.title}</span>
        <Badge variant={typeBadgeVariant(opp.type)} size="sm">{typeLabel(opp.type)}</Badge>
        <ChevronRight className="h-3 w-3 text-[var(--dim)] shrink-0" />
      </button>
    </motion.div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  opp,
  slug,
  brandId,
  onClose,
}: {
  opp: Opportunity
  slug: string
  brandId: string
  onClose: () => void
}) {
  const [briefSuccess, setBriefSuccess] = useState(false)
  const [actionSuccess, setActionSuccess] = useState(false)

  const briefMutation = useMutation({
    mutationFn: () =>
      api.post(routes.contentGen(slug, brandId), { opportunity_id: opp.id }),
    onSuccess: () => {
      setBriefSuccess(true)
      setTimeout(() => setBriefSuccess(false), 3000)
    },
  })

  const addActionMutation = useMutation({
    mutationFn: () =>
      api.post(routes.actions(slug, brandId), {
        title: opp.title,
        source: opp.type === 'geo_gap' ? 'geo_gap' : 'recommendation',
        priority: opp.tier === 'P1' ? 'critical' : opp.tier === 'P2' ? 'high' : 'medium',
        opportunity_id: opp.id,
      }),
    onSuccess: () => {
      setActionSuccess(true)
      setTimeout(() => setActionSuccess(false), 3000)
    },
  })

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.35, ease: SPRING }}
      className="h-full overflow-y-auto"
    >
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={tierBadgeVariant(opp.tier)} size="sm">{tierLabel(opp.tier)}</Badge>
              <Badge variant={typeBadgeVariant(opp.type)} size="sm">{typeLabel(opp.type)}</Badge>
            </div>
            <h2 className="font-display text-2xl font-semibold text-[var(--ink)] leading-tight">{opp.title}</h2>
            {opp.description && (
              <p className="text-sm text-[var(--dim)] mt-2 leading-relaxed">{opp.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[var(--surface)] transition-colors text-[var(--dim)] hover:text-[var(--ink)] shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Score breakdown */}
        <div className="space-y-3">
          <p className="text-xs text-[var(--dim)] uppercase tracking-wide font-semibold">Score Breakdown</p>
          <div className="flex items-center justify-around py-4 bg-[var(--surface)] rounded-lg border border-[var(--border)]">
            <div className="text-center">
              <ScoreRing score={opp.seo_score} size={64} strokeWidth={5} label="SEO" />
            </div>
            <div className="text-[var(--dim)] text-2xl font-light">+</div>
            <div className="text-center">
              <ScoreRing score={opp.geo_score} size={64} strokeWidth={5} label="GEO" />
            </div>
            <div className="text-[var(--dim)] text-2xl font-light">=</div>
            <div className="text-center">
              <ScoreRing score={opp.unified_score} size={72} strokeWidth={6} label="Unified" />
            </div>
          </div>
        </div>

        {/* Metrics */}
        {(opp.volume != null || opp.effort != null) && (
          <div className="grid grid-cols-2 gap-3">
            {opp.volume != null && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3">
                <p className="text-xs text-[var(--dim)] mb-1">Search Volume</p>
                <p className="font-display text-xl font-semibold text-[var(--ink)]">{opp.volume.toLocaleString()}</p>
              </div>
            )}
            {opp.effort != null && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3">
                <p className="text-xs text-[var(--dim)] mb-1">Effort Score</p>
                <p className="font-display text-xl font-semibold text-[var(--ink)]">{opp.effort}</p>
              </div>
            )}
          </div>
        )}

        {/* Recommended actions */}
        {opp.recommended_actions && opp.recommended_actions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--dim)] uppercase tracking-wide font-semibold">Recommended Actions</p>
            <ul className="space-y-1.5">
              {opp.recommended_actions.map((action, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[var(--ink)]">
                  <Zap className="h-3.5 w-3.5 text-[var(--ember)] shrink-0 mt-0.5" />
                  {action}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTAs */}
        <div className="space-y-2 pt-2">
          <Button
            className="w-full"
            onClick={() => briefMutation.mutate()}
            loading={briefMutation.isPending}
          >
            <ArrowUpRight className="h-4 w-4" />
            Generate Content Brief
          </Button>
          <AnimatePresence>
            {briefSuccess && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-center text-[var(--success)]"
              >
                Brief generated
              </motion.p>
            )}
          </AnimatePresence>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => addActionMutation.mutate()}
            loading={addActionMutation.isPending}
          >
            Add to Actions
          </Button>
          <AnimatePresence>
            {actionSuccess && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-center text-[var(--success)]"
              >
                Added to action center
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const [tierFilter, setTierFilter] = useState<'ALL' | Tier>('ALL')
  const [typeFilter, setTypeFilter] = useState<'all' | OppType>('all')
  const [sort, setSort] = useState<SortKey>('unified_score')
  const [selected, setSelected] = useState<Opportunity | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['opportunities', slug, brandId],
    queryFn: () =>
      api.get<{ opportunities: Opportunity[] }>(
        `${routes.opportunities(slug, brandId)}?tier=P1`
      ),
  })

  const allOpps = (data as { opportunities?: Opportunity[] } | undefined)?.opportunities ?? []

  const filtered = allOpps
    .filter((o) => tierFilter === 'ALL' || o.tier === tierFilter)
    .filter((o) => typeFilter === 'all' || o.type === typeFilter)
    .sort((a, b) => {
      if (sort === 'unified_score') return b.unified_score - a.unified_score
      if (sort === 'volume') return (b.volume ?? 0) - (a.volume ?? 0)
      return (a.effort ?? 0) - (b.effort ?? 0)
    })

  const p1 = filtered.filter((o) => o.tier === 'P1')
  const p2 = filtered.filter((o) => o.tier === 'P2')
  const p3 = filtered.filter((o) => o.tier === 'P3')

  const TIERS: Array<'ALL' | Tier> = ['ALL', 'P1', 'P2', 'P3']
  const tierLabels: Record<string, string> = { ALL: 'All', P1: 'P1 Critical', P2: 'P2 High', P3: 'P3 Medium' }

  const TYPES: Array<{ value: 'all' | OppType; label: string }> = [
    { value: 'all', label: 'All Types' },
    { value: 'keyword_gap', label: 'Keyword Gap' },
    { value: 'geo_gap', label: 'GEO Gap' },
    { value: 'content_gap', label: 'Content Gap' },
  ]
  const SORTS: Array<{ value: SortKey; label: string }> = [
    { value: 'unified_score', label: 'Score' },
    { value: 'volume', label: 'Volume' },
    { value: 'effort', label: 'Effort' },
  ]

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 p-6">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto pb-12 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
        className="flex items-start justify-between gap-4 mb-6"
      >
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Growth Opportunities</h1>
          <p className="text-sm text-[var(--dim)] mt-1">{allOpps.length} opportunities detected</p>
        </div>
      </motion.div>

      <div className="flex gap-6 items-start">
        {/* Left: List */}
        <div className="flex-1 min-w-0">
          {/* Filter bar — tier tabs + selects */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex flex-wrap items-center gap-3 mb-5"
          >
            {/* Tier pills */}
            <div className="flex items-center gap-1 bg-[var(--surface)] rounded-lg p-1 border border-[var(--border)]">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTierFilter(t)}
                  className={cn(
                    'px-3 py-1 text-xs font-semibold rounded-md transition-all',
                    tierFilter === t ? 'bg-[var(--ember)] text-white shadow-sm' : 'text-[var(--dim)] hover:text-[var(--ink)]',
                  )}
                >
                  {tierLabels[t]}
                </button>
              ))}
            </div>

            {/* Type select */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | OppType)}
              className="h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--paper)] text-xs font-sans text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {/* Sort select */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--paper)] text-xs font-sans text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>Sort: {s.label}</option>
              ))}
            </select>
          </motion.div>

          {filtered.length === 0 && (
            <EmptyState
              title="No opportunities"
              description="Adjust your filters or run an analysis to surface opportunities."
            />
          )}

          {/* P1 Section */}
          {p1.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="danger" size="sm">P1 — Critical</Badge>
                <span className="text-xs text-[var(--dim)]">{p1.length} items</span>
              </div>
              {p1.map((opp, i) => (
                <OppCard
                  key={opp.id}
                  opp={opp}
                  selected={selected?.id === opp.id}
                  onClick={() => setSelected(selected?.id === opp.id ? null : opp)}
                  index={i}
                />
              ))}
            </div>
          )}

          {/* P2 Section */}
          {p2.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="warning" size="sm">P2 — High</Badge>
                <span className="text-xs text-[var(--dim)]">{p2.length} items</span>
              </div>
              {p2.map((opp, i) => (
                <OppCard
                  key={opp.id}
                  opp={opp}
                  selected={selected?.id === opp.id}
                  onClick={() => setSelected(selected?.id === opp.id ? null : opp)}
                  index={i}
                />
              ))}
            </div>
          )}

          {/* P3 Section */}
          {p3.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="info" size="sm">P3 — Medium</Badge>
                <span className="text-xs text-[var(--dim)]">{p3.length} items</span>
              </div>
              <div className="space-y-1.5">
                {p3.map((opp, i) => (
                  <P3Row
                    key={opp.id}
                    opp={opp}
                    selected={selected?.id === opp.id}
                    onClick={() => setSelected(selected?.id === opp.id ? null : opp)}
                    index={i}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Detail panel */}
        <AnimatePresence mode="wait">
          {selected && (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: '40%' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.35, ease: SPRING }}
              className="shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--paper)] shadow-md sticky top-4"
              style={{ maxHeight: 'calc(100vh - 120px)' }}
            >
              <DetailPanel
                opp={selected}
                slug={slug}
                brandId={brandId}
                onClose={() => setSelected(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
