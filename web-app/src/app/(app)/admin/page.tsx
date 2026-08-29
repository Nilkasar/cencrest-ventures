'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  RefreshCcw, AlertTriangle, Activity, Cpu, HardDrive, Zap, Shield,
  Building2, Search, ShieldCheck, Users, BarChart3, PlayCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, relativeTime, formatNumber, formatPercent } from '@/lib/utils'
import { spring, staggerContainer, staggerItem } from '@/design-system/motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScoreRing } from '@/components/ui/score-ring'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthCheck {
  id: string
  org_name: string
  health_score: number
  at_risk: boolean
  last_checked: string
}

interface SystemMetrics {
  uptime: number
  memory_used: number
  memory_total: number
  cpu_usage: number
  request_rate: number
  error_rate: number
  request_rate_history?: { time: string; rate: number }[]
}

interface Org {
  id: string
  org_name: string
  slug: string
  plan: string
  brand_count: number
  created_at: string
}

// ─── System Status Badge ──────────────────────────────────────────────────────

type SystemStatus = 'healthy' | 'degraded' | 'down'

function SystemStatusBadge({ status }: { status: SystemStatus }) {
  const config: Record<SystemStatus, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
    healthy: { variant: 'success', label: 'Healthy' },
    degraded: { variant: 'warning', label: 'Degraded' },
    down: { variant: 'danger', label: 'Down' },
  }
  const { variant, label } = config[status]
  return <Badge variant={variant} size="sm" dot>{label}</Badge>
}

function deriveStatus(metrics?: SystemMetrics, ready?: boolean): SystemStatus {
  if (!ready) return 'down'
  if (!metrics) return 'healthy'
  if (metrics.error_rate > 5 || metrics.cpu_usage > 90) return 'degraded'
  if (metrics.error_rate > 20) return 'down'
  return 'healthy'
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({
  label, value, icon: Icon, suffix = '', color = 'text-ink', description,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  suffix?: string
  color?: string
  description?: string
}) {
  return (
    <motion.div
      variants={staggerItem}
      className="bg-surface border border-border rounded-xl p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-sans font-medium text-dim uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 text-dim" />
      </div>
      <div className={cn('font-display text-3xl font-semibold leading-none mb-1', color)}>
        {value}{suffix}
      </div>
      {description && <p className="text-xs text-dim font-sans">{description}</p>}
    </motion.div>
  )
}

// ─── Customer Health Tab ──────────────────────────────────────────────────────

function CustomerHealthTab() {
  const qc = useQueryClient()

  const { data, isLoading, refetch, isFetching } = useQuery<HealthCheck[]>({
    queryKey: ['admin', 'customer-success'],
    queryFn: () => api.get('/api/admin/customer-success'),
  })

  const interventionMutation = useMutation({
    mutationFn: () => api.post('/api/admin/customer-success/interventions'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'customer-success'] }),
  })

  const sorted = React.useMemo(() => {
    return [...(data ?? [])].sort((a, b) => {
      if (a.at_risk !== b.at_risk) return a.at_risk ? -1 : 1
      return a.health_score - b.health_score
    })
  }, [data])

  const atRiskCount = sorted.filter((h) => h.at_risk).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {atRiskCount > 0 && (
            <Badge variant="danger" size="sm" dot>{atRiskCount} at risk</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            loading={isFetching}
            className="gap-1.5"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => interventionMutation.mutate()}
            loading={interventionMutation.isPending}
            className="gap-1.5"
          >
            <Shield className="h-3.5 w-3.5" />
            Run Interventions
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Activity className="h-8 w-8 text-dim" />
          <p className="text-sm text-dim font-sans">No health data yet.</p>
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          <AnimatePresence>
            {sorted.map((check) => (
              <motion.div
                key={check.id}
                variants={staggerItem}
                layout
                className={cn(
                  'border rounded-xl p-5 transition-colors',
                  check.at_risk
                    ? 'bg-danger-muted border-danger/30'
                    : 'bg-surface border-border'
                )}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-sans font-medium text-ink text-sm truncate mb-0.5">{check.org_name}</h3>
                    <p className="text-xs text-dim font-sans">Checked {relativeTime(check.last_checked)}</p>
                  </div>
                  {check.at_risk && (
                    <Badge variant="danger" size="sm">
                      <AlertTriangle className="h-3 w-3" />
                      At risk
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <ScoreRing score={check.health_score} size={64} strokeWidth={5} />
                  <div>
                    <p className="text-xs text-dim font-sans">Health score</p>
                    <p className="font-display font-semibold text-ink text-lg">{check.health_score}/100</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}

// ─── System Tab ───────────────────────────────────────────────────────────────

function SystemTab() {
  const { data: metrics, isLoading: metricsLoading } = useQuery<SystemMetrics>({
    queryKey: ['system', 'metrics'],
    queryFn: () => api.get('/api/system/metrics'),
    refetchInterval: 30000,
  })

  const { data: readyData } = useQuery<{ ready: boolean }>({
    queryKey: ['system', 'health-ready'],
    queryFn: () => api.get('/api/system/health/ready'),
    refetchInterval: 30000,
  })

  const status = deriveStatus(metrics, readyData?.ready !== false)
  const memPct = metrics ? (metrics.memory_used / metrics.memory_total) * 100 : 0

  const sparkData = metrics?.request_rate_history ?? Array.from({ length: 10 }, (_, i) => ({
    time: `${i * 3}m`,
    rate: Math.round(Math.random() * 80 + 20),
  }))

  return (
    <div className="flex flex-col gap-6">
      {/* Status bar */}
      <div className="flex items-center gap-3 bg-surface border border-border rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-sans text-dim">System status:</span>
          <SystemStatusBadge status={status} />
        </div>
        <span className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', readyData?.ready !== false ? 'bg-success' : 'bg-danger')} />
          <span className="text-xs font-sans text-dim">/health/ready</span>
        </div>
        <span className="text-xs font-mono text-dim ml-auto">Refreshes every 30s</span>
      </div>

      {/* Metrics grid */}
      {metricsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid grid-cols-2 md:grid-cols-3 gap-4"
        >
          <MetricCard
            label="Uptime" value={metrics?.uptime?.toFixed(2) ?? '—'} suffix="%" icon={Activity}
            color="text-success" description="Rolling 30-day"
          />
          <MetricCard
            label="Memory" value={formatPercent(memPct, 0)} icon={HardDrive}
            color={memPct > 85 ? 'text-danger' : memPct > 70 ? 'text-warning' : 'text-ink'}
            description={metrics ? `${formatNumber(metrics.memory_used)}MB / ${formatNumber(metrics.memory_total)}MB` : undefined}
          />
          <MetricCard
            label="CPU" value={metrics?.cpu_usage?.toFixed(1) ?? '—'} suffix="%" icon={Cpu}
            color={
              metrics?.cpu_usage !== undefined
                ? metrics.cpu_usage > 85 ? 'text-danger' : metrics.cpu_usage > 70 ? 'text-warning' : 'text-ink'
                : 'text-ink'
            }
          />
          <MetricCard
            label="Request rate" value={metrics?.request_rate ?? '—'} suffix="/min" icon={Zap}
            color="text-info"
          />
          <MetricCard
            label="Error rate" value={metrics?.error_rate?.toFixed(2) ?? '—'} suffix="%" icon={AlertTriangle}
            color={
              metrics?.error_rate !== undefined
                ? metrics.error_rate > 5 ? 'text-danger' : metrics.error_rate > 1 ? 'text-warning' : 'text-ink'
                : 'text-ink'
            }
          />
        </motion.div>
      )}

      {/* Sparkline */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h3 className="font-display font-semibold text-ink text-sm mb-4">Request rate over time</h3>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: -28 }}>
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6B6760', fontFamily: 'Inter' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6B6760', fontFamily: 'Inter' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#F7F3EC', border: '1px solid #DDD9D1', borderRadius: 8, fontSize: 11, fontFamily: 'Inter' }}
              formatter={(v) => [`${v}/min`, 'Rate']}
            />
            <Bar dataKey="rate" fill="#C2410C" radius={[3, 3, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Orgs Tab ─────────────────────────────────────────────────────────────────

function OrgsTab() {
  const [search, setSearch] = React.useState('')

  const { data, isLoading } = useQuery<{ orgs: Org[] }>({
    queryKey: ['admin', 'orgs'],
    queryFn: () => api.get('/api/admin/orgs'),
  })

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase()
    return (data?.orgs ?? []).filter(
      (o) => !q || o.org_name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q) || o.plan.toLowerCase().includes(q)
    )
  }, [data, search])

  const columns: Column<Org>[] = [
    {
      key: 'org_name',
      header: 'Organization',
      render: (v) => <span className="font-sans font-medium text-ink">{String(v)}</span>,
    },
    {
      key: 'slug',
      header: 'Slug',
      render: (v) => <span className="font-mono text-xs text-dim">{String(v)}</span>,
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (v) => {
        const plan = String(v)
        const variant = plan === 'enterprise' ? 'ember' : plan === 'pro' ? 'info' : 'outline'
        return <Badge variant={variant as 'ember' | 'info' | 'outline'} size="sm">{plan}</Badge>
      },
    },
    {
      key: 'brand_count',
      header: 'Brands',
      render: (v) => <span className="font-mono text-sm text-ink">{String(v)}</span>,
    },
    {
      key: 'created_at',
      header: 'Joined',
      render: (v) => <span className="text-xs text-dim font-sans">{relativeTime(String(v))}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-sm">
        <Input
          placeholder="Search orgs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="border border-border rounded-xl overflow-hidden bg-surface">
        <DataTable
          data={filtered as unknown as Record<string, unknown>[]}
          columns={columns as unknown as Column<Record<string, unknown>>[]}
          loading={isLoading}
          rowKey={(r) => String(r.id)}
          emptyMessage="No organisations found."
          emptyIcon={<Building2 className="h-5 w-5" />}
        />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { data: metrics } = useQuery<SystemMetrics>({
    queryKey: ['system', 'metrics'],
    queryFn: () => api.get('/api/system/metrics'),
    refetchInterval: 30000,
  })

  const { data: readyData } = useQuery<{ ready: boolean }>({
    queryKey: ['system', 'health-ready'],
    queryFn: () => api.get('/api/system/health/ready'),
    refetchInterval: 30000,
  })

  const status = deriveStatus(metrics, readyData?.ready !== false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="flex flex-col gap-6 p-6 max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <ShieldCheck className="h-7 w-7 text-[var(--danger)]" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-3xl font-semibold text-ink leading-tight">Admin Panel</h1>
              <Badge variant="danger" size="sm" className="ml-2">Admin Access</Badge>
            </div>
            <p className="text-sm text-dim font-sans mt-0.5">Super-admin system view</p>
          </div>
        </div>
        <SystemStatusBadge status={status} />
      </div>

      {/* Stats row — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Orgs', value: 0, icon: Building2 },
          { label: 'Total Users', value: 0, icon: Users },
          { label: 'Total Brands', value: 0, icon: BarChart3 },
          { label: 'Runs Today', value: 0, icon: PlayCircle },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-sans font-medium text-[var(--dim)] uppercase tracking-wide">{label}</span>
              <Icon className="h-4 w-4 text-[var(--dim)]" />
            </div>
            <p className="font-display text-3xl font-semibold text-[var(--ink)]">{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health">Customer Health</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="orgs">Orgs</TabsTrigger>
        </TabsList>

        <TabsContent value="health">
          <CustomerHealthTab />
        </TabsContent>

        <TabsContent value="system">
          <SystemTab />
        </TabsContent>

        <TabsContent value="orgs">
          <OrgsTab />
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}
