'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { Globe, ArrowUpRight, TrendingUp, Users } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, formatNumber, formatPercent, scoreBg } from '@/lib/utils'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { spring, staggerContainer } from '@/design-system/motion'
import { tokens } from '@/design-system/tokens'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Competitor {
  id: string
  name: string
  domain: string
  mentions: number
  sentiment_score: number
  sov_percent: number
}

interface TimelinePoint {
  date: string
  values: Record<string, number>
}

interface RadarPoint {
  axis: string
  values: Record<string, number>
}

interface CompetitiveData {
  competitors: Competitor[]
  timeline: TimelinePoint[]
  radar_data: RadarPoint[]
  summary: {
    your_sov: number
    total_mentions: number
    avg_sentiment: number
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPRING = tokens.animation.easing.spring as [number, number, number, number]

const CHART_COLORS = [
  '#C2410C', // ember — your brand
  '#2563EB', // info
  '#16A34A', // success
  '#D97706', // warning
  '#7C3AED', // purple
]

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  )
}

function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center" style={{ height }}>
      <div className="space-y-3 w-full px-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-3 rounded-full" style={{ width: `${65 + (i * 7) % 35}%` }} />
        ))}
      </div>
    </div>
  )
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--paper)] border border-[var(--border)] rounded-lg shadow-md px-3 py-2 text-xs font-sans">
      {label && <p className="text-[var(--dim)] mb-1.5 font-medium">{label}</p>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-[var(--dim)]">{p.name}:</span>
          <span className="text-[var(--ink)] font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── SOV Bar ──────────────────────────────────────────────────────────────────

function SOVBar({ data, yourBrand, yourSov }: { data: CompetitiveData; yourBrand: string; yourSov: number }) {
  const segments = [
    { name: yourBrand, value: yourSov, color: CHART_COLORS[0], isYou: true },
    ...data.competitors.map((c, i) => ({ name: c.name, value: c.sov_percent, color: CHART_COLORS[i + 1] ?? '#C4BFB6', isYou: false })),
  ]
  const totalAssigned = segments.reduce((s, d) => s + d.value, 0)
  if (totalAssigned < 100) {
    segments.push({ name: 'Other', value: parseFloat((100 - totalAssigned).toFixed(1)), color: '#C4BFB6', isYou: false })
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-6 mb-6">
      <p className="font-display text-lg font-semibold text-[var(--ink)] mb-4">Share of Voice</p>
      {/* Segmented bar */}
      <div className="w-full h-5 rounded-full overflow-hidden flex mb-4">
        {segments.map((seg) => (
          <motion.div
            key={seg.name}
            initial={{ width: 0 }}
            animate={{ width: `${seg.value}%` }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.1 }}
            style={{ backgroundColor: seg.color }}
            className="h-full"
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {segments.map((seg) => (
          <div key={seg.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span className={cn('text-xs font-sans', seg.isYou ? 'font-semibold text-[var(--ink)]' : 'text-[var(--dim)]')}>
              {seg.name}
              {seg.isYou && <span className="ml-1 text-[var(--ember)]">(you)</span>}
            </span>
            <span className="text-xs font-mono text-[var(--dim)]">{seg.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Competitor Cards ─────────────────────────────────────────────────────────

function CompetitorCards({ data }: { data: CompetitiveData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {data.competitors.map((c, i) => (
        <motion.div
          key={c.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: SPRING, delay: i * 0.07 }}
          className="rounded-xl border border-[var(--border)] bg-white/60 p-5"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-lg font-semibold text-[var(--ink)] leading-snug">{c.name}</h3>
              <div className="flex items-center gap-1 mt-0.5">
                <Globe className="h-3.5 w-3.5 text-[var(--dim)] shrink-0" />
                <span className="text-xs text-[var(--dim)] font-mono truncate">{c.domain}</span>
              </div>
            </div>
            <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1 ml-2" style={{ background: CHART_COLORS[i + 1] ?? '#C4BFB6' }} />
          </div>

          <p className="text-3xl font-bold text-[var(--ember)] font-display">{c.sov_percent.toFixed(1)}%</p>
          <p className="text-sm text-[var(--dim)] mt-0.5">{formatNumber(c.mentions)} mentions</p>

          {/* 4 provider mini-bars placeholder */}
          <div className="mt-3 space-y-1">
            {['ChatGPT', 'Gemini', 'Claude', 'Perplexity'].map((provider, pi) => {
              const fakeVal = Math.max(0, c.sov_percent - pi * 3)
              return (
                <div key={provider} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--dim)] w-16 shrink-0">{provider}</span>
                  <div className="flex-1 h-1 bg-[var(--border)] rounded-full overflow-hidden">
                    <div
                      className="h-1 rounded-full"
                      style={{ width: `${Math.min(fakeVal, 100)}%`, backgroundColor: CHART_COLORS[i + 1] ?? '#C4BFB6', opacity: 0.7 }}
                    />
                  </div>
                  <span className="text-xs font-mono text-[var(--dim)] w-8 text-right">{fakeVal.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ data, yourBrand }: { data: CompetitiveData; yourBrand: string }) {
  const radarFormatted = data.radar_data.map((point) => ({
    axis: point.axis,
    [yourBrand]: point.values[yourBrand] ?? 0,
    ...data.competitors.slice(0, 3).reduce<Record<string, number>>((acc, c) => {
      acc[c.name] = point.values[c.name] ?? 0
      return acc
    }, {}),
  }))

  const participants = [yourBrand, ...data.competitors.slice(0, 3).map((c) => c.name)]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: SPRING }}
      className="space-y-6"
    >
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Competitive Radar</CardTitle>
          <p className="text-sm text-[var(--dim)]">Multi-axis comparison across the top 3 competitors</p>
        </CardHeader>
        <CardContent className="pt-4">
          <ResponsiveContainer width="100%" height={380}>
            <RadarChart data={radarFormatted} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
              <PolarGrid stroke={tokens.colors.border} strokeDasharray="3 3" />
              <PolarAngleAxis
                dataKey="axis"
                tick={{ fill: tokens.colors.dim, fontSize: 12, fontFamily: 'var(--font-inter)' }}
              />
              {participants.map((name, idx) => (
                <Radar
                  key={name}
                  name={name}
                  dataKey={name}
                  stroke={CHART_COLORS[idx]}
                  fill={CHART_COLORS[idx]}
                  fillOpacity={idx === 0 ? 0.2 : 0.08}
                  strokeWidth={idx === 0 ? 2.5 : 1.5}
                  dot={idx === 0}
                />
              ))}
              <Legend
                wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-inter)', paddingTop: 12 }}
                formatter={(value, entry) => (
                  <span style={{ color: (entry as { color?: string }).color, fontWeight: value === yourBrand ? 600 : 400 }}>
                    {value}
                  </span>
                )}
              />
              <Tooltip content={<CustomTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.competitors.slice(0, 3).map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: SPRING, delay: i * 0.07 }}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display font-semibold text-[var(--ink)] text-sm">{c.name}</p>
                <p className="text-xs text-[var(--dim)] font-mono mt-0.5">{c.domain}</p>
              </div>
              <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: CHART_COLORS[i + 1] }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-xs text-[var(--dim)]">SOV</p>
                <p className="font-display font-semibold text-[var(--ink)]">{c.sov_percent.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-[var(--dim)]">Mentions</p>
                <p className="font-display font-semibold text-[var(--ink)]">{formatNumber(c.mentions)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--dim)]">Sentiment</p>
                <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', scoreBg(c.sentiment_score))}>
                  {c.sentiment_score}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

// ─── SOV Tab ──────────────────────────────────────────────────────────────────

function SOVTab({ data, yourBrand, yourSov }: { data: CompetitiveData; yourBrand: string; yourSov: number }) {
  const pieData = [
    { name: yourBrand, value: yourSov, isYou: true },
    ...data.competitors.map((c) => ({ name: c.name, value: c.sov_percent, isYou: false })),
  ]

  const totalAssigned = pieData.reduce((s, d) => s + d.value, 0)
  if (totalAssigned < 100) {
    pieData.push({ name: 'Other', value: parseFloat((100 - totalAssigned).toFixed(1)), isYou: false })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: SPRING }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Share of Voice</CardTitle>
          <p className="text-sm text-[var(--dim)]">Distribution of AI-generated mentions across competitors</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col lg:flex-row items-center gap-8">
            <div className="w-full lg:w-1/2">
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={130}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                    animationBegin={0}
                    animationDuration={900}
                    animationEasing="ease-out"
                  >
                    {pieData.map((entry, idx) => (
                      <Cell
                        key={entry.name}
                        fill={idx === 0 ? CHART_COLORS[0] : idx < CHART_COLORS.length ? CHART_COLORS[idx] : '#C4BFB6'}
                        opacity={entry.isYou ? 1 : 0.75}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val) => [`${Number(val).toFixed(1)}%`, 'SOV']}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${tokens.colors.border}`,
                      background: tokens.colors.paper,
                      fontSize: 12,
                      fontFamily: 'var(--font-inter)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="w-full lg:w-1/2 space-y-3">
              {pieData.map((entry, idx) => (
                <motion.div
                  key={entry.name}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease: SPRING, delay: idx * 0.06 }}
                  className="flex items-center gap-3"
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: idx === 0 ? CHART_COLORS[0] : idx < CHART_COLORS.length ? CHART_COLORS[idx] : '#C4BFB6' }}
                  />
                  <span className={cn('text-sm flex-1', entry.isYou ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink)]')}>
                    {entry.name}
                    {entry.isYou && <span className="ml-1.5 text-xs font-normal text-[var(--ember)] font-sans">(you)</span>}
                  </span>
                  <span className="font-mono text-sm font-semibold text-[var(--ink)]">{entry.value.toFixed(1)}%</span>
                  <div className="w-24 bg-[var(--border)]/40 rounded-full h-1.5">
                    <motion.div
                      className="h-1.5 rounded-full"
                      style={{ background: idx === 0 ? CHART_COLORS[0] : idx < CHART_COLORS.length ? CHART_COLORS[idx] : '#C4BFB6' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${entry.value}%` }}
                      transition={{ duration: 0.7, ease: SPRING, delay: idx * 0.06 + 0.2 }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

function TimelineTab({ data, yourBrand }: { data: CompetitiveData; yourBrand: string }) {
  const lineData = data.timeline.map((point) => ({
    date: point.date,
    [yourBrand]: point.values[yourBrand] ?? 0,
    ...data.competitors.reduce<Record<string, number>>((acc, c) => {
      acc[c.name] = point.values[c.name] ?? 0
      return acc
    }, {}),
  }))

  const lines = [yourBrand, ...data.competitors.map((c) => c.name)]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: SPRING }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Mention Timeline</CardTitle>
          <p className="text-sm text-[var(--dim)]">30-day mention volume trend across all tracked brands</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={lineData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.colors.border} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: tokens.colors.dim, fontSize: 11, fontFamily: 'var(--font-inter)' }}
                tickLine={false}
                axisLine={{ stroke: tokens.colors.border }}
                tickFormatter={(v) => {
                  const d = new Date(v)
                  return `${d.getMonth() + 1}/${d.getDate()}`
                }}
              />
              <YAxis
                tick={{ fill: tokens.colors.dim, fontSize: 11, fontFamily: 'var(--font-inter)' }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-inter)', paddingTop: 16 }}
                formatter={(value) => (
                  <span style={{ color: value === yourBrand ? CHART_COLORS[0] : tokens.colors.dim, fontWeight: value === yourBrand ? 600 : 400 }}>
                    {value}
                  </span>
                )}
              />
              {lines.map((name, idx) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={CHART_COLORS[idx] ?? '#C4BFB6'}
                  strokeWidth={name === yourBrand ? 2.5 : 1.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  opacity={name === yourBrand ? 1 : 0.7}
                  animationBegin={0}
                  animationDuration={900}
                  animationEasing="ease-out"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Profiles Tab ─────────────────────────────────────────────────────────────

function ProfilesTab({ data }: { data: CompetitiveData }) {
  const cardVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: SPRING, delay: i * 0.07 },
    }),
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      <AnimatePresence>
        {data.competitors.map((c, i) => (
          <motion.div
            key={c.id}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            whileHover={{ scale: 1.01, borderColor: tokens.colors.ember }}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5 flex flex-col gap-4 transition-shadow hover:shadow-md cursor-default"
            style={{ transition: 'box-shadow 200ms, border-color 200ms' }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-semibold text-[var(--ink)] leading-snug">{c.name}</h3>
                <div className="flex items-center gap-1.5 mt-1">
                  <Globe className="h-3.5 w-3.5 text-[var(--dim)] flex-shrink-0" />
                  <span className="text-xs text-[var(--dim)] font-mono truncate">{c.domain}</span>
                </div>
              </div>
              <div
                className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5 ml-2"
                style={{ background: CHART_COLORS[(i + 1) % CHART_COLORS.length] }}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[var(--paper)] border border-[var(--border)] rounded-md px-2.5 py-2 text-center">
                <p className="text-xs text-[var(--dim)] mb-0.5">Mentions</p>
                <p className="font-display font-bold text-[var(--ink)] text-base leading-none">{formatNumber(c.mentions)}</p>
              </div>
              <div className="bg-[var(--paper)] border border-[var(--border)] rounded-md px-2.5 py-2 text-center">
                <p className="text-xs text-[var(--dim)] mb-0.5">SOV</p>
                <p className="font-display font-bold text-[var(--ink)] text-base leading-none">{formatPercent(c.sov_percent, 1)}</p>
              </div>
              <div className="bg-[var(--paper)] border border-[var(--border)] rounded-md px-2.5 py-2 text-center">
                <p className="text-xs text-[var(--dim)] mb-1">Sentiment</p>
                <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded leading-none', scoreBg(c.sentiment_score))}>
                  {c.sentiment_score}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <Badge
                variant={c.sentiment_score >= 75 ? 'success' : c.sentiment_score >= 50 ? 'warning' : 'danger'}
                size="sm"
                dot
              >
                {c.sentiment_score >= 75 ? 'Positive' : c.sentiment_score >= 50 ? 'Neutral' : 'Negative'}
              </Badge>

              <motion.a
                href={`https://${c.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ x: 2, y: -2 }}
                transition={{ type: 'tween', ease: SPRING, duration: 0.15 }}
                className="inline-flex items-center gap-1 text-xs font-sans font-medium text-[var(--dim)] hover:text-[var(--ember)] transition-colors"
              >
                View site
                <ArrowUpRight className="h-3.5 w-3.5" />
              </motion.a>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {data.competitors.length === 0 && (
        <div className="col-span-full">
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No competitors tracked"
            description="Run a competitive analysis scan to start tracking competitors."
          />
        </div>
      )}
    </motion.div>
  )
}

// ─── Page Skeleton ────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <StatsSkeleton />
      <div className="space-y-4">
        <div className="flex gap-6 border-b border-[var(--border)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 mb-2" />
          ))}
        </div>
        <ChartSkeleton height={380} />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const YOUR_BRAND_KEY = 'You'

export default function CompetitivePage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const [activeTab, setActiveTab] = useState('overview')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['competitive', slug, brandId],
    queryFn: () => api.get<CompetitiveData>(routes.competitive(slug, brandId)),
  })

  if (isLoading) return <PageSkeleton />

  if (isError || !data) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <EmptyState
          icon={<TrendingUp className="h-6 w-6" />}
          title="Competitive data unavailable"
          description="We couldn't load competitive intelligence. Check your connection and try again."
        />
      </div>
    )
  }

  const summary = data.summary ?? { your_sov: 0, total_mentions: 0, avg_sentiment: 0 }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
      >
        <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Competitive Intelligence</h1>
        <p className="text-sm text-[var(--dim)] mt-1">Share of AI voice vs competitors</p>
      </motion.div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Competitors Tracked" value={data.competitors.length} />
        <StatCard label="Your SOV" value={summary.your_sov} suffix="%" decimals={1} />
        <StatCard label="Total Mentions" value={summary.total_mentions} />
        <StatCard label="Avg Sentiment" value={summary.avg_sentiment} decimals={0} />
      </div>

      {/* SOV Bar */}
      <SOVBar data={data} yourBrand={YOUR_BRAND_KEY} yourSov={summary.your_sov} />

      {/* Competitor Cards */}
      {data.competitors.length > 0 ? (
        <CompetitorCards data={data} />
      ) : (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No competitors tracked"
          description="Run a competitive analysis scan to start tracking competitors."
        />
      )}

      {/* Tabs for deeper analysis */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Radar</TabsTrigger>
          <TabsTrigger value="sov">SOV Detail</TabsTrigger>
          <TabsTrigger value="timeline">Mention Timeline</TabsTrigger>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <AnimatePresence mode="wait">
            {activeTab === 'overview' && (
              <OverviewTab key="overview" data={data} yourBrand={YOUR_BRAND_KEY} />
            )}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="sov">
          <AnimatePresence mode="wait">
            {activeTab === 'sov' && (
              <SOVTab key="sov" data={data} yourBrand={YOUR_BRAND_KEY} yourSov={summary.your_sov} />
            )}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="timeline">
          <AnimatePresence mode="wait">
            {activeTab === 'timeline' && (
              <TimelineTab key="timeline" data={data} yourBrand={YOUR_BRAND_KEY} />
            )}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="profiles">
          <AnimatePresence mode="wait">
            {activeTab === 'profiles' && (
              <ProfilesTab key="profiles" data={data} />
            )}
          </AnimatePresence>
        </TabsContent>
      </Tabs>
    </div>
  )
}
