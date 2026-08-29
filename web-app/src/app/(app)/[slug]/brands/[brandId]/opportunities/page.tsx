'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, Zap, ArrowUpRight } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ScoreRing } from '@/components/ui/score-ring'
import { Spinner } from '@/components/ui/spinner'

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

function tierBadgeVariant(tier: Tier) {
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

function typeBadgeVariant(type: OppType) {
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

function tierBg(tier: Tier) {
  switch (tier) {
    case 'P1': return 'bg-red-50/60 border-red-200/60'
    case 'P2': return 'bg-amber-50/40 border-amber-200/40'
    case 'P3': return 'bg-surface border-border'
  }
}

// ─── Opportunity Row ──────────────────────────────────────────────────────────

function OppRow({
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
    >
      <button
        onClick={onClick}
        className={`w-full text-left rounded-lg border p-4 transition-all hover:shadow-sm ${tierBg(opp.tier)} ${
          selected ? 'ring-2 ring-ember ring-offset-1' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <ScoreRing score={opp.unified_score} size={40} strokeWidth={4} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap mb-1">
              <span className="text-sm font-semibold text-ink leading-snug">{opp.title}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={typeBadgeVariant(opp.type)} size="sm">{typeLabel(opp.type)}</Badge>
              {opp.volume != null && (
                <span className="text-xs text-dim font-mono">{opp.volume.toLocaleString()} vol</span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-dim shrink-0" />
        </div>
      </button>
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
        className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md border transition-all hover:bg-surface/80 ${
          selected ? 'ring-2 ring-ember border-ember/30' : 'border-border bg-paper'
        }`}
      >
        <span
          className="text-xs font-mono font-semibold w-8 text-right shrink-0"
          style={{ color: opp.unified_score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)' }}
        >
          {opp.unified_score}
        </span>
        <span className="text-sm text-ink flex-1 truncate">{opp.title}</span>
        <Badge variant={typeBadgeVariant(opp.type)} size="sm">{typeLabel(opp.type)}</Badge>
        <ChevronRight className="h-3 w-3 text-dim shrink-0" />
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
            <h2 className="font-display text-2xl font-semibold text-ink leading-tight">{opp.title}</h2>
            {opp.description && (
              <p className="text-sm text-dim mt-2 leading-relaxed">{opp.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface transition-colors text-dim hover:text-ink shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Score breakdown */}
        <div className="space-y-3">
          <p className="text-xs text-dim uppercase tracking-wide font-semibold">Score Breakdown</p>
          <div className="flex items-center justify-around py-4 bg-surface rounded-lg border border-border">
            <div className="text-center">
              <ScoreRing score={opp.seo_score} size={64} strokeWidth={5} label="SEO" />
            </div>
            <div className="text-dim text-2xl font-light">+</div>
            <div className="text-center">
              <ScoreRing score={opp.geo_score} size={64} strokeWidth={5} label="GEO" />
            </div>
            <div className="text-dim text-2xl font-light">=</div>
            <div className="text-center">
              <ScoreRing score={opp.unified_score} size={72} strokeWidth={6} label="Unified" />
            </div>
          </div>
        </div>

        {/* Metrics */}
        {(opp.volume != null || opp.effort != null) && (
          <div className="grid grid-cols-2 gap-3">
            {opp.volume != null && (
              <div className="bg-surface border border-border rounded-lg p-3">
                <p className="text-xs text-dim mb-1">Search Volume</p>
                <p className="font-display text-xl font-semibold text-ink">{opp.volume.toLocaleString()}</p>
              </div>
            )}
            {opp.effort != null && (
              <div className="bg-surface border border-border rounded-lg p-3">
                <p className="text-xs text-dim mb-1">Effort Score</p>
                <p className="font-display text-xl font-semibold text-ink">{opp.effort}</p>
              </div>
            )}
          </div>
        )}

        {/* Recommended actions */}
        {opp.recommended_actions && opp.recommended_actions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-dim uppercase tracking-wide font-semibold">Recommended Actions</p>
            <ul className="space-y-1.5">
              {opp.recommended_actions.map((action, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink">
                  <Zap className="h-3.5 w-3.5 text-ember shrink-0 mt-0.5" />
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
                className="text-xs text-center text-green-600"
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
                className="text-xs text-center text-green-600"
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
      <div className="max-w-7xl mx-auto space-y-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
        className="mb-6"
      >
        <h1 className="font-display text-3xl font-semibold text-ink">Opportunity Engine</h1>
        <p className="text-sm text-dim mt-1">{allOpps.length} opportunities detected</p>
      </motion.div>

      <div className="flex gap-6 items-start">
        {/* Left: Grid */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Filter bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex flex-wrap items-center gap-3"
          >
            {/* Tier pills */}
            <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-border">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTierFilter(t)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    tierFilter === t
                      ? 'bg-ember text-white shadow-sm'
                      : 'text-dim hover:text-ink'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Type select */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | OppType)}
              className="h-8 px-2 rounded-md border border-border bg-paper text-xs font-sans text-ink focus:outline-none focus:ring-2 focus:ring-ember"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {/* Sort select */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 px-2 rounded-md border border-border bg-paper text-xs font-sans text-ink focus:outline-none focus:ring-2 focus:ring-ember"
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
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="danger" size="sm">P1 — Critical</Badge>
                <span className="text-xs text-dim">{p1.length} items</span>
              </div>
              <div className="space-y-2">
                {p1.map((opp, i) => (
                  <OppRow
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

          {/* P2 Section */}
          {p2.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="warning" size="sm">P2 — High</Badge>
                <span className="text-xs text-dim">{p2.length} items</span>
              </div>
              <div className="space-y-2">
                {p2.map((opp, i) => (
                  <OppRow
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

          {/* P3 Section */}
          {p3.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="info" size="sm">P3 — Medium</Badge>
                <span className="text-xs text-dim">{p3.length} items</span>
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
              className="shrink-0 overflow-hidden rounded-xl border border-border bg-paper shadow-md sticky top-4"
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
