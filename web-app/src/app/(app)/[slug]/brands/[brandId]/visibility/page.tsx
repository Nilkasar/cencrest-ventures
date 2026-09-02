'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { Play, RefreshCw } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, formatScore, relativeTime, scoreColor } from '@/lib/utils'
import {
  Card, CardHeader, CardTitle, CardContent,
  ScoreRing, SkeletonCard, EmptyState, DataTable, Badge, Button,
  StatCard,
} from '@/components/ui'
import { Progress } from '@/components/ui/progress'
import { PageHeader } from '@/components/layout/page-header'
import { SPRING_CURVE } from '@/lib/motion'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProviderScore {
  chatgpt: number
  gemini: number
  claude: number
  perplexity: number
}

interface Run {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  scores?: ProviderScore
  mention_rate?: ProviderScore
}

interface MentionRow {
  query: string
  provider: string
  mentioned: boolean
  sentiment: string
  position: number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDERS = [
  { key: 'chatgpt' as const,    label: 'ChatGPT',    color: '#2563EB' },
  { key: 'gemini' as const,     label: 'Gemini',     color: '#16A34A' },
  { key: 'claude' as const,     label: 'Claude',     color: '#7C3AED' },
  { key: 'perplexity' as const, label: 'Perplexity', color: '#EA580C' },
]

const EASE = SPRING_CURVE as unknown as [number, number, number, number]

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-raised border border-border rounded-xl px-4 py-3 shadow-lg min-w-[160px]">
      <p className="text-xs text-dim font-sans mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs font-sans py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-dim">{p.name}</span>
          <span className="ml-auto font-semibold text-ink">{Math.round(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Provider Score Row ─────────────────────────────────────────────────────────

function ProviderScoreRow({
  label,
  color,
  score,
}: {
  label: string
  color: string
  score: number
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <span
        className="rounded-full shrink-0"
        style={{ width: 10, height: 10, background: color }}
      />
      <span className="font-sans text-sm text-ink w-24 shrink-0">{label}</span>
      <div className="flex-1">
        <Progress value={score} className="h-2" />
      </div>
      <span className="text-sm font-semibold text-ink w-10 text-right font-sans" style={{ color }}>
        {formatScore(score)}
      </span>
    </div>
  )
}

// ── Mention Table columns ──────────────────────────────────────────────────────

const mentionColumns = [
  {
    key: 'query',
    header: 'Query',
    render: (v: unknown) => (
      <span className="text-xs font-sans text-ink line-clamp-2 max-w-[280px]">{String(v)}</span>
    ),
  },
  {
    key: 'provider',
    header: 'Provider',
    render: (v: unknown) => {
      const p = PROVIDERS.find((x) => x.key === String(v))
      return p ? (
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-xs font-sans">{p.label}</span>
        </div>
      ) : <span className="text-xs font-sans text-dim">{String(v)}</span>
    },
  },
  {
    key: 'mentioned',
    header: 'Mentioned',
    render: (v: unknown) => (
      <span className={cn(
        'inline-flex items-center gap-1.5 text-xs font-sans font-medium',
        v ? 'text-success' : 'text-dim'
      )}>
        <span className={cn('w-1.5 h-1.5 rounded-full', v ? 'bg-success' : 'bg-dim')} />
        {v ? 'Yes' : 'No'}
      </span>
    ),
  },
  {
    key: 'sentiment',
    header: 'Sentiment',
    render: (v: unknown) => {
      const s = String(v || 'neutral')
      const variant = s === 'positive' ? 'success' : s === 'negative' ? 'danger' : 'outline'
      return <Badge variant={variant as 'success' | 'danger' | 'outline'} size="sm">{s}</Badge>
    },
  },
  {
    key: 'position',
    header: 'Position',
    render: (v: unknown) => (
      <span className="text-xs font-mono text-dim">{v != null ? `#${v}` : '—'}</span>
    ),
  },
] as const

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VisibilityPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['runs', slug, brandId],
    queryFn: () => api.get<{ runs: Run[] }>(routes.runs(slug, brandId)),
  })

  const runs = (data as { runs?: Run[] } | undefined)?.runs ?? []
  const completedRuns = runs.filter((r) => r.status === 'completed')
  const latest = completedRuns[0]
  const prev = completedRuns[1]

  // Overall score: average of provider scores from latest run
  const overallScore = latest?.scores
    ? Math.round(
        Object.values(latest.scores).reduce((a, b) => a + b, 0) / PROVIDERS.length
      )
    : 0

  // Build trend chart data
  const trendData = [...completedRuns].reverse().map((r) => ({
    date: relativeTime(r.created_at),
    ChatGPT: r.scores?.chatgpt ?? 0,
    Gemini: r.scores?.gemini ?? 0,
    Claude: r.scores?.claude ?? 0,
    Perplexity: r.scores?.perplexity ?? 0,
  }))

  // Build mention rate bar chart data
  const mentionRateData = [...completedRuns].reverse().map((r) => ({
    date: relativeTime(r.created_at),
    ChatGPT: Math.round((r.mention_rate?.chatgpt ?? 0) * 100),
    Gemini: Math.round((r.mention_rate?.gemini ?? 0) * 100),
    Claude: Math.round((r.mention_rate?.claude ?? 0) * 100),
    Perplexity: Math.round((r.mention_rate?.perplexity ?? 0) * 100),
  }))

  // Build SOV donut data from latest run
  const sovData = latest ? PROVIDERS.map((p) => ({
    name: p.label,
    value: latest.scores?.[p.key] ?? 0,
    color: p.color,
  })) : []

  // Mention table rows (real data comes from run detail)
  const mentionRows: MentionRow[] = []

  if (isLoading) {
    return (
      <div className="grid gap-6">
        {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <p className="text-sm text-dim font-sans">Failed to load visibility data.</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    )
  }

  if (completedRuns.length === 0) {
    return (
      <EmptyState
        title="No runs yet. Start your first AI analysis."
        description="Run an analysis to measure how AI models describe your brand across ChatGPT, Gemini, Claude, and Perplexity."
        action={
          <Button onClick={() => window.location.href = `/${slug}/brands/${brandId}/visibility/runs`}>
            <Play className="h-4 w-4" /> Start a run
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-8 pb-16">

      {/* Page header */}
      <PageHeader
        title="AI Visibility"
        subtitle="How often AI models mention your brand across tracked queries."
      />

      {/* 1. Top section — ScoreRing + provider rows */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <div className="flex flex-col sm:flex-row gap-8">
          {/* Left — overall ring */}
          <div className="flex flex-col items-center justify-center gap-6 min-w-[180px]">
            <ScoreRing score={overallScore} size={140} />
            <p className="font-display text-xl font-semibold text-ink text-center">
              Overall AI Visibility
            </p>
            {prev && (
              <span className={cn(
                'text-xs font-sans',
                overallScore > (prev.scores ? Math.round(Object.values(prev.scores).reduce((a, b) => a + b, 0) / PROVIDERS.length) : 0)
                  ? 'text-success'
                  : 'text-danger'
              )}>
                vs last run
              </span>
            )}
          </div>

          {/* Right — 4 provider rows */}
          <Card className="flex-1">
            <CardContent className="pt-6 pb-4">
              {PROVIDERS.map((p) => (
                <ProviderScoreRow
                  key={p.key}
                  label={p.label}
                  color={p.color}
                  score={latest?.scores?.[p.key] ?? 0}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      </motion.section>

      {/* 2. Trend chart */}
      {trendData.length > 1 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4, ease: EASE }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Visibility Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--dim)' }} />
                  {PROVIDERS.map((p) => (
                    <Line
                      key={p.key}
                      dataKey={p.label}
                      stroke={p.color}
                      strokeWidth={2}
                      dot={{ r: 3, fill: p.color }}
                      activeDot={{ r: 5 }}
                      isAnimationActive
                      animationDuration={900}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.section>
      )}

      {/* 3. Mention breakdown table */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4, ease: EASE }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Mention Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              data={mentionRows as unknown as Record<string, unknown>[]}
              columns={mentionColumns as unknown as import('@/components/ui/data-table').Column<Record<string, unknown>>[]}
              emptyMessage="Run an analysis to see mention data."
              rowKey={(r) => `${r.query as string}-${r.provider as string}`}
            />
          </CardContent>
        </Card>
      </motion.section>

      {/* 4. Mention rate bar chart */}
      {mentionRateData.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4, ease: EASE }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Mention Rate by Provider</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={mentionRateData} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--dim)' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--dim)' }} />
                  {PROVIDERS.map((p) => (
                    <Bar
                      key={p.key}
                      dataKey={p.label}
                      fill={p.color}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive
                      animationDuration={900}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.section>
      )}

      {/* 5. Share of Voice donut */}
      {sovData.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4, ease: EASE }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Share of Voice</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row items-center gap-8">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={sovData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    isAnimationActive
                    animationDuration={600}
                  >
                    {sovData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => [`${Math.round(Number(v))}`, String(name ?? '')]}
                    contentStyle={{
                      background: 'var(--paper)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-3">
                {sovData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2 text-sm font-sans">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.color }} />
                    <span className="text-dim">{entry.name}</span>
                    <span className="ml-auto font-semibold text-ink">{Math.round(entry.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.section>
      )}
    </div>
  )
}
