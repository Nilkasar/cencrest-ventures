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
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { StatCard } from '@/components/ui/stat-card'
import { ScoreRing } from '@/components/ui/score-ring'
import { EmptyState } from '@/components/ui/empty-state'

const PROVIDERS = {
  chatgpt: { color: '#2563EB', label: 'ChatGPT' },
  gemini: { color: '#16A34A', label: 'Gemini' },
  claude: { color: '#7C3AED', label: 'Claude' },
  perplexity: { color: '#EA580C', label: 'Perplexity' },
} as const

type ProviderKey = keyof typeof PROVIDERS

interface BrandData {
  id: string
  name: string
  visibility_score?: number
  queries_tracked?: number
  gaps_identified?: number
  actions_pending?: number
  visibility_trend?: Array<Record<string, number | string>>
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
    <div className="bg-paper border border-border rounded-lg shadow-md px-4 py-3 text-sm font-sans">
      <p className="text-dim mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink font-medium capitalize">{p.name}:</span>
          <span className="text-ember font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { slug } = useParams<{ slug: string }>()

  // We need a brandId — in a real app this would come from user preferences or the first brand
  // For now we derive it from the brands list
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

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <motion.div
        {...fadeUp(0)}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink leading-tight">
            {greeting()}, {ownerName}
          </h1>
          <p className="text-sm text-dim mt-1">{today}</p>
        </div>
        <Button size="lg" className="self-start sm:self-auto">
          Run AI Analysis
        </Button>
      </motion.div>

      {/* Stat row */}
      <motion.div {...fadeUp(1)} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {brandLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            {/* Visibility Score card — custom layout with ScoreRing */}
            <Card className="col-span-1">
              <CardContent className="pt-6 flex flex-col gap-3">
                <p className="text-sm font-sans text-dim">AI Visibility Score</p>
                <ScoreRing score={visibilityScore} size={72} label={`${visibilityScore}/100`} />
              </CardContent>
            </Card>
            <StatCard label="Queries Tracked" value={queriesTracked} />
            <StatCard label="Gaps Identified" value={gapsIdentified} />
            <StatCard label="Actions Pending" value={actionsPending} />
          </>
        )}
      </motion.div>

      {/* Visibility trend chart */}
      <motion.div {...fadeUp(2)} className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Visibility Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {brandLoading ? (
              <div className="skeleton h-56 w-full rounded-md" />
            ) : trendData.length === 0 ? (
              <EmptyState
                title="No trend data yet"
                description="Run an AI analysis to start tracking visibility over time."
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
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

      {/* Top P1 Opportunities */}
      <motion.div {...fadeUp(3)} className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Top Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            {oppsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton h-12 w-full rounded-md" />
                ))}
              </div>
            ) : opportunities.length === 0 ? (
              <EmptyState
                title="No P1 opportunities found"
                description="Opportunities will appear after your first AI analysis run."
              />
            ) : (
              <div className="space-y-2">
                {opportunities.map((opp, i) => (
                  <motion.div
                    key={opp.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-3 p-3 rounded-md hover:bg-surface/60 transition-colors"
                  >
                    <Badge variant="danger" size="sm">P1</Badge>
                    <span className="flex-1 text-sm text-ink font-medium truncate">{opp.title}</span>
                    {opp.unified_score != null && (
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-24 h-1.5 bg-border rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-ember rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${opp.unified_score}%` }}
                            transition={{ delay: i * 0.06 + 0.2, duration: 0.5 }}
                          />
                        </div>
                        <span className="text-xs text-dim w-8 text-right">{opp.unified_score}</span>
                      </div>
                    )}
                    <Button variant="outline" size="sm">
                      Act
                    </Button>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Actions */}
      <motion.div {...fadeUp(4)}>
        <Card>
          <CardHeader>
            <CardTitle>Recent Actions</CardTitle>
          </CardHeader>
          <CardContent>
            {actionsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton h-10 w-full rounded-md" />
                ))}
              </div>
            ) : actions.length === 0 ? (
              <EmptyState title="No actions yet" description="Actions generated from analysis will appear here." />
            ) : (
              <div className="space-y-1">
                {actions.map((action) => {
                  const statusVariant =
                    action.status === 'completed'
                      ? 'success'
                      : action.status === 'failed'
                        ? 'danger'
                        : action.status === 'in_progress'
                          ? 'info'
                          : 'outline'

                  return (
                    <div
                      key={action.id}
                      className="flex items-center gap-3 py-3 border-b border-border last:border-0"
                    >
                      <Badge variant={statusVariant as 'success' | 'danger' | 'info' | 'outline'} size="sm" dot>
                        {action.status.replace('_', ' ')}
                      </Badge>
                      <span className="flex-1 text-sm text-ink truncate">{action.title}</span>
                      <span className="text-xs text-dim shrink-0">{relativeTime(action.created_at)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
