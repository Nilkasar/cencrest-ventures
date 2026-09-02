'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import Link from 'next/link'
import {
  Zap,
  ArrowRight,
  Clock,
  TrendingUp,
  TrendingDown,
  Search,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ArrowUpRight,
  Activity,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

import { ScoreRing } from '@/components/ui/score-ring'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { SPRING_CURVE, fadeUp } from '@/lib/motion'

/* ── Constants ──────────────────────────────────────────────────────────── */
const PROVIDERS = {
  chatgpt:    { color: '#2563EB', label: 'ChatGPT',    abbr: 'GPT' },
  gemini:     { color: '#16A34A', label: 'Gemini',     abbr: 'GEM' },
  claude:     { color: '#7C3AED', label: 'Claude',     abbr: 'CLD' },
  perplexity: { color: '#EA580C', label: 'Perplexity', abbr: 'PPX' },
} as const

type ProviderKey = keyof typeof PROVIDERS

interface ProviderScores {
  chatgpt?: number
  gemini?: number
  claude?: number
  perplexity?: number
}

interface BrandData {
  id: string
  name: string
  visibility_score?: number
  queries_tracked?: number
  gaps_identified?: number
  actions_pending?: number
  visibility_trend?: Array<Record<string, number | string>>
  provider_scores?: ProviderScores
  last_analyzed_at?: string
  org?: { owner_name?: string }
}

interface Opportunity {
  id: string
  title: string
  priority: string
  unified_score?: number
}

interface Action {
  id: string
  title: string
  status: string
  created_at: string
}

const TIME_RANGES = [
  { label: '7D',  value: '7d'  },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
] as const

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/* ── Chart tooltip ───────────────────────────────────────────────────────── */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-raised border border-border rounded-xl shadow-md px-4 py-3 min-w-[160px]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-dim mb-2">{label}</p>
      <div className="space-y-1.5">
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-xs font-medium text-ink capitalize flex-1">{p.name}</span>
            <span className="font-bold text-xs text-ink tabular-nums">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Action status icon ──────────────────────────────────────────────────── */
function ActionStatusDot({ status }: { status: string }) {
  if (status === 'completed') return <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" aria-hidden />
  if (status === 'in_progress') return <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0 animate-pulse" aria-hidden />
  if (status === 'failed') return <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" aria-hidden />
  return <span className="w-1.5 h-1.5 rounded-full bg-border-strong shrink-0" aria-hidden />
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const { slug } = useParams<{ slug: string }>()
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('90d')

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(new Date()),
    []
  )

  /* ── Data queries (all business logic preserved) ──────────────────── */
  const { data: brands } = useQuery({
    queryKey: ['brands', slug],
    queryFn: () => api.get<{ brands: Array<{ id: string }> }>(routes.brands(slug)),
  })

  const brandId = (brands as { brands?: Array<{ id: string }>; [k: string]: unknown } | undefined)
    ?.brands?.[0]?.id

  const { data: brand, isLoading: brandLoading } = useQuery({
    queryKey: ['brand', slug, brandId],
    queryFn: () => api.get<BrandData>(routes.brand(slug, brandId!)),
    enabled: !!brandId,
  })

  const { data: oppsData, isLoading: oppsLoading } = useQuery({
    queryKey: ['opportunities', slug, brandId],
    queryFn: () =>
      api.get<{ opportunities: Opportunity[] }>(routes.opportunities(slug, brandId!)),
    enabled: !!brandId,
  })

  const { data: actionsData, isLoading: actionsLoading } = useQuery({
    queryKey: ['actions', slug, brandId],
    queryFn: () => api.get<{ actions: Action[] }>(routes.actions(slug, brandId!)),
    enabled: !!brandId,
  })

  /* ── Derived state ────────────────────────────────────────────────── */
  const brandRecord     = brand as BrandData | undefined
  const opportunities   = (oppsData as { opportunities?: Opportunity[] } | undefined)
    ?.opportunities?.filter((o) => o.priority === 'P1').slice(0, 6) ?? []
  const actions         = (actionsData as { actions?: Action[] } | undefined)?.actions?.slice(0, 6) ?? []
  const ownerName       = brandRecord?.org?.owner_name ?? 'there'
  const visibilityScore = brandRecord?.visibility_score ?? 0
  const queriesTracked  = brandRecord?.queries_tracked ?? 0
  const gapsIdentified  = brandRecord?.gaps_identified ?? 0
  const actionsPending  = brandRecord?.actions_pending ?? 0
  const trendData       = brandRecord?.visibility_trend ?? []
  const providerScores  = brandRecord?.provider_scores
  const lastAnalyzed    = brandRecord?.last_analyzed_at

  return (
    <div className="max-w-[1360px] mx-auto space-y-8 pb-16">

      {/* ── Row 1: Page title + primary CTA ─────────────────────────── */}
      <motion.div
        {...fadeUp(0)}
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
      >
        <div>
          <p className="text-[11px] font-mono font-semibold text-dim uppercase tracking-[0.1em] mb-1.5">
            {today}
          </p>
          <h1 className="font-display text-[32px] font-semibold text-ink leading-[1.1] tracking-[-0.02em]">
            {greeting()}, {ownerName}
          </h1>
          <p className="text-sm text-dim mt-1.5 leading-relaxed">
            Here&rsquo;s how your brand is showing up across AI models today.
          </p>
        </div>
        <Button size="lg" className="shrink-0 gap-2 shadow-[0_4px_16px_rgba(194,65,12,0.24)]">
          <Zap className="h-4 w-4" />
          Run AI Analysis
        </Button>
      </motion.div>

      {/* ── Row 2: Command strip — visibility ring + 3 KPI tiles + dark callout ── */}
      <motion.div {...fadeUp(1)} className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Visibility hero: 5/12 */}
        <div className="lg:col-span-5 bg-surface-raised border border-border rounded-xl p-6 shadow-[0_1px_3px_rgba(22,20,15,0.05)]">
          {brandLoading ? (
            <div className="flex items-center gap-6 h-36">
              <div className="w-28 h-28 rounded-full bg-surface animate-pulse shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="h-3 w-24 bg-surface animate-pulse rounded" />
                <div className="h-8 w-40 bg-surface animate-pulse rounded" />
                <div className="h-3 w-32 bg-surface animate-pulse rounded" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="shrink-0">
                <ScoreRing score={visibilityScore} size={128} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold font-sans uppercase tracking-[0.1em] text-dim">
                    AI Visibility Score
                  </span>
                  {visibilityScore > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-success bg-success/10 px-1.5 py-0.5 rounded-full">
                      <TrendingUp className="w-2.5 h-2.5" />
                      +4
                    </span>
                  )}
                </div>
                <h2 className="font-display text-[20px] font-semibold text-ink leading-tight tracking-tight mb-2">
                  {visibilityScore >= 80 ? 'Excellent presence'
                    : visibilityScore >= 60 ? 'Good foundation'
                    : visibilityScore >= 40 ? 'Mixed results'
                    : visibilityScore > 0   ? 'Gaps detected'
                    : 'Analysis pending'}
                </h2>
                <p className="text-[13px] text-dim leading-relaxed">
                  {visibilityScore > 0
                    ? `Recognized ${visibilityScore}% of the time across ${queriesTracked} queries.`
                    : 'Run your first analysis to baseline AI visibility.'}
                </p>
                {lastAnalyzed && (
                  <p className="text-[11px] text-dim mt-3 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    Updated {relativeTime(lastAnalyzed)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3 KPI tiles: 4/12 (each 4/3 = ~ 1.33 cols; use a sub-grid) */}
        <div className="lg:col-span-4 grid grid-rows-3 gap-3">
          {brandLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface-raised border border-border rounded-xl p-4 animate-pulse h-[72px]" />
            ))
          ) : (
            <>
              <KpiTile
                label="Queries Tracked"
                value={queriesTracked}
                icon={<Search className="w-4 h-4" />}
                accent="info"
                trend="+12%"
                trendUp
              />
              <KpiTile
                label="Gaps Identified"
                value={gapsIdentified}
                icon={<AlertTriangle className="w-4 h-4" />}
                accent={gapsIdentified > 0 ? 'warning' : 'default'}
              />
              <KpiTile
                label="Actions Pending"
                value={actionsPending}
                icon={<Zap className="w-4 h-4" />}
                accent="ember"
              />
            </>
          )}
        </div>

        {/* Dark callout: 3/12 */}
        <div className="lg:col-span-3 bg-ink text-paper rounded-xl p-6 flex flex-col relative overflow-hidden">
          {/* Subtle dot-grid texture */}
          <div
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(247,243,236,1) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
            }}
          />
          <div className="relative flex flex-col flex-1">
            <div className="w-8 h-8 rounded-lg bg-ember flex items-center justify-center mb-4">
              <Sparkles className="w-3.5 h-3.5 text-paper" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-paper/50 mb-2">
              Next best action
            </span>
            <h3 className="font-display text-[17px] font-semibold leading-tight tracking-tight mb-2 flex-1">
              {gapsIdentified > 0
                ? `${gapsIdentified} citation gaps need attention`
                : opportunities.length > 0
                ? 'Publish content for high-priority topics'
                : 'Kick off your first AI analysis'}
            </h3>
            <p className="text-xs text-paper/55 leading-relaxed mb-5">
              {gapsIdentified > 0
                ? 'Address these to move your score in the next run.'
                : opportunities.length > 0
                ? `${opportunities.length} opportunities surfaced from your last run.`
                : 'Get baseline metrics across all four major AI models.'}
            </p>
            <Link
              href={
                gapsIdentified > 0
                  ? `/${slug}/brands/${brandId}/geo`
                  : opportunities.length > 0
                  ? `/${slug}/brands/${brandId}/opportunities`
                  : '#'
              }
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-paper/80 hover:text-ember transition-colors"
            >
              View details <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </motion.div>

      {/* ── Row 3: Provider performance + Trend chart ────────────────── */}
      <motion.div {...fadeUp(2)} className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Provider breakdown: 4/12 */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Provider Performance</CardTitle>
            <p className="text-xs text-dim mt-0.5">AI visibility by model</p>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="space-y-5">
              {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => {
                const p     = PROVIDERS[key]
                const score = providerScores?.[key] ?? 0
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: p.color }}
                        />
                        <span className="text-[13px] font-medium text-ink">{p.label}</span>
                      </div>
                      <div className="flex items-baseline gap-0.5">
                        <span
                          className="font-display text-lg font-bold tabular-nums"
                          style={{ color: p.color }}
                        >
                          {score}
                        </span>
                        <span className="text-[11px] text-dim">/100</span>
                      </div>
                    </div>
                    <div className="h-1 bg-surface rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: p.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${score}%` }}
                        transition={{ duration: 0.9, ease: SPRING_CURVE, delay: 0.3 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Trend chart: 8/12 */}
        <Card className="lg:col-span-8">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Visibility Trend</CardTitle>
                <p className="text-xs text-dim mt-0.5">Score across providers over time</p>
              </div>
              {/* Time range toggle */}
              <div className="flex items-center gap-0.5 bg-surface border border-border rounded-lg p-1 shrink-0">
                {TIME_RANGES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setTimeRange(r.value)}
                    className={[
                      'px-2.5 py-1 text-[11px] font-bold tracking-wide rounded-md transition-all duration-150 cursor-pointer',
                      timeRange === r.value
                        ? 'bg-surface-raised text-ink shadow-[0_1px_3px_rgba(22,20,15,0.08)]'
                        : 'text-dim hover:text-ink',
                    ].join(' ')}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {brandLoading ? (
              <div className="h-52 w-full rounded-lg bg-surface animate-pulse" />
            ) : trendData.length === 0 ? (
              <EmptyState
                icon={<Activity className="w-5 h-5" />}
                title="No trend data yet"
                description="Run an AI analysis to start tracking visibility over time."
                compact
              />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <defs>
                      {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => (
                        <linearGradient key={key} id={`g-${key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={PROVIDERS[key].color} stopOpacity={0.12} />
                          <stop offset="100%" stopColor={PROVIDERS[key].color} stopOpacity={0}    />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--color-dim)', fontFamily: 'var(--font-sans)' }}
                      axisLine={{ stroke: 'var(--color-border)' }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'var(--color-dim)', fontFamily: 'var(--font-sans)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={PROVIDERS[key].color}
                        strokeWidth={2}
                        fill={`url(#g-${key})`}
                        isAnimationActive
                        animationDuration={900}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="flex items-center justify-center gap-5 mt-4 pt-4 border-t border-border">
                  {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: PROVIDERS[key].color }} />
                      <span className="text-[11px] font-medium text-dim">{PROVIDERS[key].label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Row 4: Opportunities + Activity ──────────────────────────── */}
      <motion.div {...fadeUp(3)} className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Opportunities: 7/12 */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Top Opportunities</CardTitle>
                <p className="text-xs text-dim mt-0.5">Highest-impact P1 gaps from your last run</p>
              </div>
              <Link
                href={brandId ? `/${slug}/brands/${brandId}/opportunities` : '#'}
                className="shrink-0 text-xs font-semibold text-dim hover:text-ink transition-colors inline-flex items-center gap-1"
              >
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {oppsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-lg bg-surface animate-pulse" />
                ))}
              </div>
            ) : opportunities.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="w-5 h-5" />}
                title="No P1 opportunities yet"
                description="Run an AI analysis to surface high-impact growth opportunities."
                compact
              />
            ) : (
              <div className="space-y-1 -mx-2">
                {opportunities.map((opp, i) => (
                  <motion.div
                    key={opp.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.28, ease: SPRING_CURVE }}
                    className="group flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-surface transition-colors"
                  >
                    <Badge variant="danger" size="sm">P1</Badge>
                    <span className="flex-1 text-[13px] text-ink font-medium truncate">
                      {opp.title}
                    </span>
                    {opp.unified_score != null && (
                      <div className="hidden sm:flex items-center gap-2 shrink-0">
                        <Progress
                          value={opp.unified_score}
                          size="sm"
                          className="w-16"
                        />
                        <span className="text-[11px] font-bold text-dim tabular-nums w-6 text-right">
                          {opp.unified_score}
                        </span>
                      </div>
                    )}
                    <Link href={`/${slug}/brands/${brandId}/opportunities`} className="shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity gap-1"
                      >
                        Act <ArrowRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity: 5/12 */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Recent Activity</CardTitle>
                <p className="text-xs text-dim mt-0.5">Latest agent actions</p>
              </div>
              <Link
                href={brandId ? `/${slug}/brands/${brandId}/actions` : '#'}
                className="shrink-0 text-xs font-semibold text-dim hover:text-ink transition-colors inline-flex items-center gap-1"
              >
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {actionsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-surface animate-pulse" />
                ))}
              </div>
            ) : actions.length === 0 ? (
              <EmptyState
                icon={<Zap className="w-5 h-5" />}
                title="No actions yet"
                description="Actions from your analysis runs will appear here."
                compact
              />
            ) : (
              <div className="space-y-px -mx-2">
                {actions.map((action, i) => (
                  <motion.div
                    key={action.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.28, ease: SPRING_CURVE }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface transition-colors"
                  >
                    <ActionStatusDot status={action.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-ink font-medium truncate leading-tight">
                        {action.title}
                      </p>
                    </div>
                    <span className="text-[11px] text-dim shrink-0 tabular-nums">
                      {relativeTime(action.created_at)}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}

/* ── KPI Tile ────────────────────────────────────────────────────────────── */
const ACCENT_MAP = {
  ember:   { icon: 'text-ember',   num: 'text-ember' },
  info:    { icon: 'text-info',    num: 'text-info' },
  success: { icon: 'text-success', num: 'text-success' },
  warning: { icon: 'text-warning', num: 'text-warning' },
  danger:  { icon: 'text-danger',  num: 'text-danger' },
  default: { icon: 'text-dim',     num: 'text-ink' },
} as const

interface KpiTileProps {
  label: string
  value: number
  icon: React.ReactNode
  accent?: keyof typeof ACCENT_MAP
  trend?: string
  trendUp?: boolean
}

function KpiTile({ label, value, icon, accent = 'default', trend, trendUp }: KpiTileProps) {
  const a = ACCENT_MAP[accent]
  return (
    <div className="bg-surface-raised border border-border rounded-xl px-4 py-3 flex items-center gap-4 shadow-[0_1px_3px_rgba(22,20,15,0.05)]">
      <span className={a.icon}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-dim">{label}</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className={['font-display text-2xl font-bold leading-none tabular-nums', a.num].join(' ')}>
            {value}
          </span>
          {trend && (
            <span
              className={[
                'inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                trendUp ? 'text-success bg-success/10' : 'text-danger bg-danger/10',
              ].join(' ')}
            >
              {trendUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
              {trend}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
