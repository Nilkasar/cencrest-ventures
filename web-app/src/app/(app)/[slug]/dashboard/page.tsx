'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import Link from 'next/link'
import { Zap, ArrowRight, Clock } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ScoreRing } from '@/components/ui/score-ring'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'

const PROVIDERS = {
  chatgpt:    { color: '#2563EB', label: 'ChatGPT' },
  gemini:     { color: '#16A34A', label: 'Gemini' },
  claude:     { color: '#7C3AED', label: 'Claude' },
  perplexity: { color: '#EA580C', label: 'Perplexity' },
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

const today = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
}).format(new Date())

const SPRING = [0.16, 1, 0.3, 1] as [number, number, number, number]

const fadeUp = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: SPRING, delay: i * 0.08 },
})

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--paper)] border border-[var(--border)] rounded-xl shadow-lg px-4 py-3 text-sm font-sans min-w-[160px]">
      <p className="text-[var(--dim)] mb-2 text-xs">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-[var(--ink)] font-medium capitalize flex-1">{p.name}</span>
          <span className="font-semibold text-[var(--ink)]">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function ActionDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-[var(--success)]',
    in_progress: 'bg-[var(--info)]',
    failed: 'bg-[var(--danger)]',
  }
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status] ?? 'bg-[var(--border)]'}`} />
  )
}

export default function DashboardPage() {
  const { slug } = useParams<{ slug: string }>()

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

  const brandRecord = brand as BrandData | undefined
  const opportunities = (
    oppsData as { opportunities?: Opportunity[] } | undefined
  )?.opportunities?.filter((o) => o.priority === 'P1').slice(0, 5) ?? []
  const actions = (actionsData as { actions?: Action[] } | undefined)?.actions?.slice(0, 5) ?? []
  const ownerName = brandRecord?.org?.owner_name ?? 'there'

  const visibilityScore = brandRecord?.visibility_score ?? 0
  const queriesTracked = brandRecord?.queries_tracked ?? 0
  const gapsIdentified = brandRecord?.gaps_identified ?? 0
  const actionsPending = brandRecord?.actions_pending ?? 0
  const trendData = brandRecord?.visibility_trend ?? []
  const providerScores = brandRecord?.provider_scores

  const isRunning = false

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* ── Section 1: Header ─────────────────────────────────── */}
      <motion.div
        {...fadeUp(0)}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-[var(--ink)] leading-tight">
            {greeting()}, {ownerName}
          </h1>
          <p className="text-sm text-[var(--dim)] mt-1 font-sans">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status pill */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-xs font-sans font-medium text-[var(--ink)]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isRunning ? 'bg-[var(--warning)] animate-pulse' : 'bg-[var(--success)] animate-pulse'
              }`}
            />
            {isRunning ? 'Running…' : 'Ready'}
          </div>
          <Button size="lg">
            <Zap className="h-4 w-4" />
            Run AI Analysis
          </Button>
        </div>
      </motion.div>

      {/* ── Section 2: 4 stat cards ─────────────────────────────── */}
      <motion.div {...fadeUp(1)} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {brandLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            {/* AI Visibility */}
            <div className="rounded-xl border border-[var(--border)] bg-white/60 backdrop-blur-sm px-5 py-5 flex flex-col gap-3">
              <p className="text-xs font-sans font-medium text-[var(--dim)] uppercase tracking-wider">AI Visibility</p>
              <div className="flex items-center justify-center">
                <ScoreRing score={visibilityScore} size={80} />
              </div>
            </div>

            {/* Queries Tracked */}
            <div className="rounded-xl border border-[var(--border)] bg-white/60 backdrop-blur-sm px-5 py-5 flex flex-col gap-2">
              <p className="text-xs font-sans font-medium text-[var(--dim)] uppercase tracking-wider">Queries Tracked</p>
              <p className="font-display text-3xl font-semibold text-[var(--ink)]">{queriesTracked}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--dim)] font-sans">active queries</p>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)] bg-[var(--success)]/10 px-2 py-0.5 rounded-full">
                  +12% this week
                </span>
              </div>
            </div>

            {/* Gaps Identified */}
            <div className="rounded-xl border border-[var(--border)] bg-white/60 backdrop-blur-sm px-5 py-5 flex flex-col gap-2">
              <p className="text-xs font-sans font-medium text-[var(--dim)] uppercase tracking-wider">Gaps Identified</p>
              <p className="font-display text-3xl font-semibold text-[var(--ink)]">{gapsIdentified}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--dim)] font-sans">detected</p>
                {gapsIdentified > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--warning)] bg-[var(--warning)]/10 px-2 py-0.5 rounded-full">
                    review needed
                  </span>
                )}
              </div>
            </div>

            {/* Actions Pending */}
            <div className="rounded-xl border border-[var(--border)] bg-white/60 backdrop-blur-sm px-5 py-5 flex flex-col gap-2">
              <p className="text-xs font-sans font-medium text-[var(--dim)] uppercase tracking-wider">Actions Pending</p>
              <p className="font-display text-3xl font-semibold text-[var(--ink)]">{actionsPending}</p>
              <p className="text-xs text-[var(--dim)] font-sans">pending review</p>
            </div>
          </>
        )}
      </motion.div>

      {/* ── Section 3: Provider scores ──────────────────────────── */}
      <motion.div {...fadeUp(2)} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => {
          const p = PROVIDERS[key]
          const score = providerScores?.[key] ?? 0
          return (
            <div key={key} className="rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-sans text-sm font-medium text-[var(--ink)]">{p.label}</span>
                <span className="font-sans text-2xl font-semibold" style={{ color: p.color }}>
                  {score}
                  <span className="text-sm font-normal text-[var(--dim)]">/100</span>
                </span>
              </div>
              <Progress
                value={score}
                className="h-1.5"
                style={
                  {
                    '--progress-color': p.color,
                  } as React.CSSProperties
                }
              />
            </div>
          )
        })}
      </motion.div>

      {/* ── Section 4: Trend chart ─────────────────────────────── */}
      <motion.div {...fadeUp(3)}>
        <Card className="rounded-xl border border-[var(--border)]">
          <CardHeader>
            <div>
              <CardTitle className="font-display">Visibility Trend</CardTitle>
              <p className="text-xs text-[var(--dim)] font-sans mt-0.5">90-day AI model performance</p>
            </div>
          </CardHeader>
          <CardContent>
            {brandLoading ? (
              <div className="h-56 w-full rounded-md bg-[var(--surface)] animate-pulse" />
            ) : trendData.length === 0 ? (
              <EmptyState
                title="No trend data yet"
                description="Run an AI analysis to start tracking visibility over time."
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--dim)', fontFamily: 'var(--font-inter)' }}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: 'var(--dim)', fontFamily: 'var(--font-inter)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-inter)', color: 'var(--dim)' }}
                  />
                  {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={PROVIDERS[key].label}
                      stroke={PROVIDERS[key].color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-out"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Section 5: Two-col layout ──────────────────────────── */}
      <motion.div {...fadeUp(4)} className="flex flex-col lg:flex-row gap-6">
        {/* Top Opportunities (60%) */}
        <Card className="flex-[3] rounded-xl border border-[var(--border)]">
          <CardHeader>
            <CardTitle className="font-display">Top Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            {oppsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-md bg-[var(--surface)] animate-pulse" />
                ))}
              </div>
            ) : opportunities.length === 0 ? (
              <EmptyState
                title="No P1 opportunities found"
                description="Opportunities will appear after your first AI analysis run."
              />
            ) : (
              <div>
                {opportunities.map((opp, i) => (
                  <motion.div
                    key={opp.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.3, ease: SPRING }}
                    className="flex items-center gap-3 py-2.5 border-b border-[var(--border)] last:border-0"
                  >
                    <Badge variant="danger" size="sm">P1</Badge>
                    <span className="flex-1 text-sm text-[var(--ink)] font-sans truncate">{opp.title}</span>
                    {opp.unified_score != null && (
                      <div className="w-20 h-1.5 bg-[var(--border)] rounded-full overflow-hidden shrink-0">
                        <motion.div
                          className="h-full bg-[var(--ember)] rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${opp.unified_score}%` }}
                          transition={{ delay: i * 0.06 + 0.2, duration: 0.5 }}
                        />
                      </div>
                    )}
                    <Link
                      href={`/${slug}/brands/${brandId}/opportunities`}
                      className="shrink-0"
                    >
                      <Button variant="outline" size="sm">Act →</Button>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Actions (40%) */}
        <Card className="flex-[2] rounded-xl border border-[var(--border)]">
          <CardHeader>
            <CardTitle className="font-display">Recent Actions</CardTitle>
          </CardHeader>
          <CardContent>
            {actionsLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-9 rounded-md bg-[var(--surface)] animate-pulse" />
                ))}
              </div>
            ) : actions.length === 0 ? (
              <EmptyState title="No actions yet" description="Actions generated from analysis will appear here." />
            ) : (
              <div>
                {actions.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center gap-3 py-3 border-b border-[var(--border)] last:border-0"
                  >
                    <ActionDot status={action.status} />
                    <p className="flex-1 text-sm text-[var(--ink)] font-sans truncate">{action.title}</p>
                    <span className="text-xs text-[var(--dim)] font-sans shrink-0 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {relativeTime(action.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
