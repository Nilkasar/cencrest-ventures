'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play,
  Clock,
  Calendar,
  CheckSquare,
  Activity,
  Zap,
  BarChart3,
  FileText,
  Search,
  Globe,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, relativeTime, formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DataTable, Column } from '@/components/ui/data-table'
import { spring } from '@/design-system/motion'

// ─── Types ────────────────────────────────────────────────────────────────────

type Frequency = 'daily' | 'weekly' | 'monthly'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MODULES = [
  { id: 'geo_scan', label: 'GEO Scan', icon: Globe },
  { id: 'seo_analysis', label: 'SEO Analysis', icon: Search },
  { id: 'competitive_intel', label: 'Competitive Intel', icon: BarChart3 },
  { id: 'content_analysis', label: 'Content Analysis', icon: FileText },
  { id: 'report_generation', label: 'Report Generation', icon: Activity },
]

interface Schedule {
  enabled: boolean
  frequency: Frequency
  hour: number
  minute: number
  day_of_week: number
  modules: string[]
}

interface ScheduleStatus {
  next_run: string
  last_run: string
  last_status: string
  total_runs: number
}

interface ScheduleData {
  schedule: Schedule
  status: ScheduleStatus
}

interface RunRecord extends Record<string, unknown> {
  id: string
  date: string
  modules_run: string[]
  status: string
  duration: number
  actions_generated: number
}

interface RunHistoryData {
  runs: RunRecord[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SPRING = [0.16, 1, 0.3, 1] as [number, number, number, number]

const stagger = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: SPRING, delay: i * 0.07 },
})

function buildRoute(slug: string, brandId: string) {
  return `/api/orgs/${slug}/brands/${brandId}/autonomous`
}

function countdown(nextRunIso: string): string {
  const ms = new Date(nextRunIso).getTime() - Date.now()
  if (ms <= 0) return 'Now'
  const mins = Math.floor(ms / 60_000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) return `${days}d ${hrs % 24}h`
  if (hrs > 0) return `${hrs}h ${mins % 60}m`
  return `${mins}m`
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  label,
  size = 'md',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const dims = size === 'lg'
    ? { track: 'h-8 w-14', thumb: 'h-6 w-6', on: 'translate-x-7', off: 'translate-x-1' }
    : size === 'sm'
    ? { track: 'h-5 w-9', thumb: 'h-3.5 w-3.5', on: 'translate-x-4', off: 'translate-x-0.5' }
    : { track: 'h-7 w-12', thumb: 'h-5 w-5', on: 'translate-x-6', off: 'translate-x-1' }

  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex items-center rounded-full transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2',
        checked ? 'bg-ember' : 'bg-border',
        dims.track
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        className={cn(
          'inline-block rounded-full bg-paper shadow-sm',
          dims.thumb,
          checked ? dims.on : dims.off
        )}
      />
    </button>
  )
}

// ─── Frequency Selector ───────────────────────────────────────────────────────

function FrequencySelector({
  value,
  onChange,
}: {
  value: Frequency
  onChange: (f: Frequency) => void
}) {
  const options: Frequency[] = ['daily', 'weekly', 'monthly']

  return (
    <div className="flex rounded-lg border border-border bg-paper p-1 gap-1 w-fit">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            'relative px-4 py-1.5 text-sm font-sans capitalize rounded-md transition-colors duration-150 focus-visible:outline-none',
            value === opt ? 'text-paper' : 'text-dim hover:text-ink'
          )}
        >
          {value === opt && (
            <motion.div
              layoutId="freq-indicator"
              className="absolute inset-0 rounded-md bg-ember"
              transition={{ type: 'spring', stiffness: 450, damping: 36 }}
            />
          )}
          <span className="relative z-10">{opt}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Time Picker ──────────────────────────────────────────────────────────────

function TimePicker({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number
  minute: number
  onHourChange: (h: number) => void
  onMinuteChange: (m: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={hour}
        onChange={(e) => onHourChange(Number(e.target.value))}
        className={cn(
          'h-10 rounded-md border border-border bg-paper px-3 text-sm font-mono text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:border-ember'
        )}
        aria-label="Hour"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
        ))}
      </select>
      <span className="text-dim font-display text-lg font-semibold">:</span>
      <select
        value={minute}
        onChange={(e) => onMinuteChange(Number(e.target.value))}
        className={cn(
          'h-10 rounded-md border border-border bg-paper px-3 text-sm font-mono text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:border-ember'
        )}
        aria-label="Minute"
      >
        {[0, 15, 30, 45].map((m) => (
          <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Day-of-Week Picker ───────────────────────────────────────────────────────

function DayPicker({
  value,
  onChange,
}: {
  value: number
  onChange: (d: number) => void
}) {
  return (
    <div className="flex gap-1.5">
      {DAYS.map((day, i) => {
        const active = value === i
        return (
          <button
            key={day}
            onClick={() => onChange(i)}
            className={cn(
              'relative w-10 h-10 rounded-lg text-xs font-sans font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
              active ? 'text-paper' : 'text-dim hover:text-ink hover:bg-surface border border-border'
            )}
          >
            {active && (
              <motion.div
                layoutId="day-indicator"
                className="absolute inset-0 rounded-lg bg-ember"
                transition={{ type: 'spring', stiffness: 450, damping: 36 }}
              />
            )}
            <span className="relative z-10">{day}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Module Checkboxes ────────────────────────────────────────────────────────

function ModuleChecks({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (modules: string[]) => void
}) {
  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((m) => m !== id)
        : [...selected, id]
    )
  }

  return (
    <div className="space-y-2.5">
      {MODULES.map(({ id, label, icon: Icon }) => {
        const checked = selected.includes(id)
        return (
          <label
            key={id}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors duration-150',
              checked
                ? 'bg-ember/5 border-ember/30'
                : 'bg-paper border-border hover:bg-surface'
            )}
          >
            <div
              className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors duration-150',
                checked ? 'bg-ember border-ember' : 'border-border'
              )}
              aria-hidden="true"
            >
              {checked && (
                <svg viewBox="0 0 10 8" fill="none" className="w-3 h-2.5">
                  <path d="M1 4l2.5 3L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(id)}
              className="sr-only"
            />
            <Icon className={cn('h-4 w-4 flex-shrink-0', checked ? 'text-ember' : 'text-dim')} />
            <span className={cn('text-sm font-sans', checked ? 'text-ink font-medium' : 'text-dim')}>
              {label}
            </span>
          </label>
        )
      })}
    </div>
  )
}

// ─── Schedule Config Card ─────────────────────────────────────────────────────

function ScheduleConfigCard({
  schedule,
  slug,
  brandId,
}: {
  schedule: Schedule
  slug: string
  brandId: string
}) {
  const qc = useQueryClient()
  const base = buildRoute(slug, brandId)

  const [form, setForm] = useState(schedule)
  useEffect(() => { setForm(schedule) }, [schedule])

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`${base}/schedule`, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autonomous', slug, brandId] }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-ember" />
          Schedule Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Frequency */}
        <div>
          <label className="text-xs font-sans font-medium text-dim uppercase tracking-wide block mb-3">
            Frequency
          </label>
          <FrequencySelector
            value={form.frequency}
            onChange={(f) => setForm((p) => ({ ...p, frequency: f }))}
          />
        </div>

        {/* Time */}
        <div>
          <label className="text-xs font-sans font-medium text-dim uppercase tracking-wide block mb-3">
            Time (UTC)
          </label>
          <TimePicker
            hour={form.hour}
            minute={form.minute}
            onHourChange={(h) => setForm((p) => ({ ...p, hour: h }))}
            onMinuteChange={(m) => setForm((p) => ({ ...p, minute: m }))}
          />
        </div>

        {/* Day of Week (weekly only) */}
        <AnimatePresence>
          {form.frequency === 'weekly' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: SPRING }}
              className="overflow-hidden"
            >
              <label className="text-xs font-sans font-medium text-dim uppercase tracking-wide block mb-3">
                Day of Week
              </label>
              <DayPicker
                value={form.day_of_week}
                onChange={(d) => setForm((p) => ({ ...p, day_of_week: d }))}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modules */}
        <div>
          <label className="text-xs font-sans font-medium text-dim uppercase tracking-wide block mb-3">
            Included Modules
          </label>
          <ModuleChecks
            selected={form.modules}
            onChange={(modules) => setForm((p) => ({ ...p, modules }))}
          />
        </div>

        <Button
          className="w-full"
          onClick={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
        >
          Save Schedule
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Schedule Status Card ─────────────────────────────────────────────────────

function ScheduleStatusCard({ status }: { status: ScheduleStatus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-ember" />
          Schedule Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Next Run */}
          <div className="bg-surface rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-dim" />
              <span className="text-xs text-dim font-sans uppercase tracking-wide">Next run</span>
            </div>
            <p className="font-display text-2xl font-semibold text-ink">
              {status.next_run ? countdown(status.next_run) : '—'}
            </p>
            {status.next_run && (
              <p className="text-xs text-dim mt-1 font-sans">
                {new Date(status.next_run).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })}
              </p>
            )}
          </div>

          {/* Last Run */}
          <div className="bg-surface rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-1">
              <CheckSquare className="h-4 w-4 text-dim" />
              <span className="text-xs text-dim font-sans uppercase tracking-wide">Last run</span>
            </div>
            <p className="text-sm font-sans text-ink mb-2">
              {status.last_run ? relativeTime(status.last_run) : '—'}
            </p>
            {status.last_status && (
              <Badge
                variant={
                  status.last_status === 'completed' ? 'success'
                    : status.last_status === 'running' ? 'info'
                    : status.last_status === 'failed' ? 'danger'
                    : 'outline'
                }
                size="sm"
                dot
              >
                {status.last_status}
              </Badge>
            )}
          </div>

          {/* Total Runs */}
          <div className="bg-surface rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-dim" />
              <span className="text-xs text-dim font-sans uppercase tracking-wide">Total runs</span>
            </div>
            <p className="font-display text-2xl font-semibold text-ink">
              {formatNumber(status.total_runs)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Run History ──────────────────────────────────────────────────────────────

function RunHistory({ slug, brandId }: { slug: string; brandId: string }) {
  const base = buildRoute(slug, brandId)

  const { data, isLoading } = useQuery({
    queryKey: ['autonomous-runs', slug, brandId],
    queryFn: () => api.get<RunHistoryData>(`${base}/runs`),
  })

  const runs = (data as RunHistoryData | undefined)?.runs ?? []

  const columns: Column<RunRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (v) => (
        <span className="text-sm text-ink font-sans">
          {relativeTime(v as string)}
        </span>
      ),
    },
    {
      key: 'modules_run',
      header: 'Modules',
      render: (v) => {
        const mods = v as string[]
        return (
          <div className="flex flex-wrap gap-1">
            {mods.slice(0, 2).map((m) => (
              <Badge key={m} variant="outline" size="sm">
                {m.replace(/_/g, ' ')}
              </Badge>
            ))}
            {mods.length > 2 && (
              <Badge variant="outline" size="sm">+{mods.length - 2}</Badge>
            )}
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (v) => (
        <Badge
          variant={
            v === 'completed' ? 'success'
              : v === 'running' ? 'info'
              : v === 'failed' ? 'danger'
              : 'outline'
          }
          size="sm"
          dot
        >
          {v as string}
        </Badge>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (v) => {
        const secs = v as number
        return (
          <span className="font-mono text-xs text-dim">
            {secs >= 60 ? `${Math.round(secs / 60)}m` : `${secs}s`}
          </span>
        )
      },
    },
    {
      key: 'actions_generated',
      header: 'Actions',
      render: (v) => (
        <span className="font-mono text-sm text-ink">{formatNumber(v as number)}</span>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          data={runs}
          columns={columns}
          loading={isLoading}
          rowKey={(r) => String(r.id)}
          emptyMessage="No runs yet. Schedule or trigger a run to get started."
          pageSize={10}
        />
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AutonomousPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()
  const base = buildRoute(slug, brandId)

  const { data, isLoading } = useQuery({
    queryKey: ['autonomous', slug, brandId],
    queryFn: () => api.get<ScheduleData>(`${base}/schedule`),
  })

  const scheduleData = data as ScheduleData | undefined
  const schedule = scheduleData?.schedule
  const status = scheduleData?.status

  const enabled = schedule?.enabled ?? false

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) =>
      api.patch(`${base}/schedule`, { enabled: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autonomous', slug, brandId] }),
  })

  const runNowMutation = useMutation({
    mutationFn: () => api.post(`${base}/schedule/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['autonomous', slug, brandId] })
      qc.invalidateQueries({ queryKey: ['autonomous-runs', slug, brandId] })
    },
  })

  const isRunning = status?.last_status === 'running'

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 rounded-xl bg-surface border border-border animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Autonomous Ops</h1>
          <p className="text-sm text-dim font-sans mt-1">Scheduled intelligence runs</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Run Now */}
          <Button
            variant="outline"
            onClick={() => runNowMutation.mutate()}
            loading={runNowMutation.isPending || isRunning}
            disabled={runNowMutation.isPending || isRunning}
          >
            <Play className="h-4 w-4" />
            Run Now
          </Button>

          {/* Global Toggle */}
          <div className="flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-2.5">
            <span className="text-sm font-sans font-medium text-ink">Autonomous Mode</span>
            <ToggleSwitch
              checked={enabled}
              onChange={(v) => toggleMutation.mutate(v)}
              label="Toggle autonomous mode"
              size="md"
            />
          </div>
        </div>
      </motion.div>

      {/* Content */}
      <div className="space-y-6">
        {/* Schedule Config (shown when enabled) */}
        <AnimatePresence>
          {enabled && schedule && (
            <motion.div
              key="schedule-config"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: SPRING }}
              className="overflow-hidden"
            >
              <motion.div {...stagger(0)}>
                <ScheduleConfigCard schedule={schedule} slug={slug} brandId={brandId} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status Card */}
        {status && (
          <motion.div {...stagger(1)}>
            <ScheduleStatusCard status={status} />
          </motion.div>
        )}

        {/* Run History */}
        <motion.div {...stagger(2)}>
          <RunHistory slug={slug} brandId={brandId} />
        </motion.div>
      </div>
    </div>
  )
}
