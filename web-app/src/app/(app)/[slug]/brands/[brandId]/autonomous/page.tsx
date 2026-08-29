'use client'

import { useState, useEffect } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { DataTable, Column } from '@/components/ui/data-table'
import { SkeletonCard } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

type Frequency = 'daily' | 'weekly' | 'monthly'

const DAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAYS_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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

function nextScheduledTimes(schedule: Schedule): string[] {
  const results: string[] = []
  const now = new Date()
  for (let d = 0; d < 30 && results.length < 3; d++) {
    const candidate = new Date(now)
    candidate.setDate(now.getDate() + d)
    candidate.setHours(schedule.hour, schedule.minute, 0, 0)
    if (candidate <= now) continue
    if (schedule.frequency === 'weekly' && candidate.getDay() !== schedule.day_of_week) continue
    if (schedule.frequency === 'monthly' && candidate.getDate() !== 1) continue
    results.push(candidate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
  }
  return results
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex items-center w-11 h-6 rounded-full transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember)] focus-visible:ring-offset-2',
        checked ? 'bg-[var(--ember)]' : 'border border-[var(--border)] bg-[var(--surface)]',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        className={cn(
          'inline-block w-4 h-4 rounded-full bg-white shadow-sm',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  )
}

// ─── Frequency Selector (segmented control) ───────────────────────────────────

function FrequencySelector({ value, onChange }: { value: Frequency; onChange: (f: Frequency) => void }) {
  const options: Frequency[] = ['daily', 'weekly', 'monthly']
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1 gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            'relative px-4 py-1.5 text-sm font-sans capitalize rounded-md transition-colors duration-150 focus-visible:outline-none',
            value === opt ? 'text-white' : 'text-[var(--dim)] hover:text-[var(--ink)]'
          )}
        >
          {value === opt && (
            <motion.div
              layoutId="freq-indicator"
              className="absolute inset-0 rounded-md bg-[var(--ember)]"
              transition={{ type: 'spring', stiffness: 450, damping: 36 }}
            />
          )}
          <span className="relative z-10">{opt}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Day of week multi-select ─────────────────────────────────────────────────

function DayButtons({
  selected,
  onChange,
}: {
  selected: number[]
  onChange: (days: number[]) => void
}) {
  function toggle(i: number) {
    onChange(selected.includes(i) ? selected.filter((d) => d !== i) : [...selected, i])
  }

  return (
    <div className="flex gap-1.5">
      {DAYS_SHORT.map((d, i) => {
        const active = selected.includes(i)
        return (
          <button
            key={i}
            onClick={() => toggle(i)}
            title={DAYS_FULL[i]}
            className={cn(
              'relative w-9 h-9 rounded-lg text-xs font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember)]',
              active ? 'text-white' : 'text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--surface)] border border-[var(--border)]'
            )}
          >
            {active && (
              <motion.div
                layoutId={`day-${i}`}
                className="absolute inset-0 rounded-lg bg-[var(--ember)]"
                transition={{ type: 'spring', stiffness: 450, damping: 36 }}
              />
            )}
            <span className="relative z-10">{d}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Module Checkboxes ────────────────────────────────────────────────────────

function ModuleChecks({ selected, onChange }: { selected: string[]; onChange: (m: string[]) => void }) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((m) => m !== id) : [...selected, id])
  }
  return (
    <div className="space-y-2">
      {MODULES.map(({ id, label, icon: Icon }) => {
        const checked = selected.includes(id)
        return (
          <label
            key={id}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors duration-150',
              checked ? 'bg-[var(--ember)]/5 border-[var(--ember)]/30' : 'bg-[var(--paper)] border-[var(--border)] hover:bg-[var(--surface)]'
            )}
          >
            <div
              className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors duration-150',
                checked ? 'bg-[var(--ember)] border-[var(--ember)]' : 'border-[var(--border)]'
              )}
              aria-hidden="true"
            >
              {checked && (
                <svg viewBox="0 0 10 8" fill="none" className="w-3 h-2.5">
                  <path d="M1 4l2.5 3L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="sr-only" />
            <Icon className={cn('h-4 w-4 flex-shrink-0', checked ? 'text-[var(--ember)]' : 'text-[var(--dim)]')} />
            <span className={cn('text-sm font-sans', checked ? 'text-[var(--ink)] font-medium' : 'text-[var(--dim)]')}>
              {label}
            </span>
          </label>
        )
      })}
    </div>
  )
}

// ─── Schedule Card ────────────────────────────────────────────────────────────

function ScheduleCard({ schedule, slug, brandId }: { schedule: Schedule; slug: string; brandId: string }) {
  const qc = useQueryClient()
  const base = buildRoute(slug, brandId)
  const [form, setForm] = useState(schedule)
  useEffect(() => { setForm(schedule) }, [schedule])

  const [selectedDays, setSelectedDays] = useState<number[]>([schedule.day_of_week])

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`${base}/schedule`, { ...form, day_of_week: selectedDays[0] ?? 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autonomous', slug, brandId] }),
  })

  const timeValue = `${String(form.hour).padStart(2, '0')}:${String(form.minute).padStart(2, '0')}`

  function onTimeChange(v: string) {
    const [h, m] = v.split(':').map(Number)
    setForm((f) => ({ ...f, hour: h ?? 0, minute: m ?? 0 }))
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/70 p-5 mb-6 space-y-5">
      <h2 className="font-display text-lg text-[var(--ink)]">Schedule</h2>

      {/* Frequency */}
      <div>
        <label className="text-xs font-medium text-[var(--dim)] uppercase tracking-wide block mb-2">Frequency</label>
        <FrequencySelector value={form.frequency} onChange={(f) => setForm((p) => ({ ...p, frequency: f }))} />
      </div>

      {/* Time */}
      <div>
        <label className="text-xs font-medium text-[var(--dim)] uppercase tracking-wide block mb-2">Run at</label>
        <input
          type="time"
          value={timeValue}
          onChange={(e) => onTimeChange(e.target.value)}
          className="h-10 rounded-md border border-[var(--border)] bg-[var(--paper)] px-3 text-sm font-mono text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ember)] focus:border-[var(--ember)]"
        />
      </div>

      {/* Day of week (weekly only) */}
      <AnimatePresence>
        {form.frequency === 'weekly' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: SPRING }}
            className="overflow-hidden"
          >
            <label className="text-xs font-medium text-[var(--dim)] uppercase tracking-wide block mb-2">Day of Week</label>
            <DayButtons selected={selectedDays} onChange={setSelectedDays} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modules */}
      <div>
        <label className="text-xs font-medium text-[var(--dim)] uppercase tracking-wide block mb-2">Modules</label>
        <ModuleChecks selected={form.modules} onChange={(modules) => setForm((p) => ({ ...p, modules }))} />
      </div>

      <Button className="w-full" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
        Save Schedule
      </Button>
    </div>
  )
}

// ─── Status summary mini cards ────────────────────────────────────────────────

function ScheduleStatusCards({ status }: { status: ScheduleStatus }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-4 w-4 text-[var(--dim)]" />
          <span className="text-xs text-[var(--dim)] font-sans uppercase tracking-wide">Next run</span>
        </div>
        <p className="font-display text-2xl font-semibold text-[var(--ink)]">
          {status.next_run ? countdown(status.next_run) : '—'}
        </p>
      </div>
      <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
        <div className="flex items-center gap-2 mb-1">
          <CheckSquare className="h-4 w-4 text-[var(--dim)]" />
          <span className="text-xs text-[var(--dim)] font-sans uppercase tracking-wide">Last run</span>
        </div>
        <p className="text-sm font-sans text-[var(--ink)] mb-2">
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
      <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-4 w-4 text-[var(--dim)]" />
          <span className="text-xs text-[var(--dim)] font-sans uppercase tracking-wide">Total runs</span>
        </div>
        <p className="font-display text-2xl font-semibold text-[var(--ink)]">
          {formatNumber(status.total_runs)}
        </p>
      </div>
    </div>
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
        <span className="text-sm text-[var(--ink)] font-mono">
          {relativeTime(v as string)}
        </span>
      ),
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
      key: 'duration',
      header: 'Duration',
      render: (v) => {
        const secs = v as number
        return (
          <span className="font-mono text-xs text-[var(--dim)]">
            {secs >= 60 ? `${Math.round(secs / 60)}m` : `${secs}s`}
          </span>
        )
      },
    },
    {
      key: 'actions_generated',
      header: 'Actions',
      render: (v) => (
        <span className="font-mono text-sm text-[var(--ink)]">{formatNumber(v as number)}</span>
      ),
    },
    {
      key: 'id',
      header: '',
      render: () => (
        <button className="text-xs text-[var(--ember)] hover:underline font-medium">View</button>
      ),
    },
  ]

  if (isLoading) return <SkeletonCard />

  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h2 className="font-display text-lg text-[var(--ink)]">Run History</h2>
      </div>
      <DataTable
        data={runs}
        columns={columns}
        loading={false}
        rowKey={(r) => String(r.id)}
        emptyMessage="No runs yet. Schedule or trigger a run to get started."
        pageSize={10}
      />
    </div>
  )
}

// ─── Next Scheduled Runs ──────────────────────────────────────────────────────

function NextRunsList({ schedule }: { schedule: Schedule }) {
  const times = nextScheduledTimes(schedule)
  if (times.length === 0) return null

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/70 p-5">
      <h2 className="font-display text-lg text-[var(--ink)] mb-3">Upcoming Runs</h2>
      <ul className="space-y-2">
        {times.map((t, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-[var(--dim)]">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-[var(--ink)] text-xs">{t}</span>
          </li>
        ))}
      </ul>
    </div>
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
          <div key={i} className="h-40 rounded-xl bg-[var(--surface)] border border-[var(--border)] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
      >
        <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Autonomous Mode</h1>
        <p className="text-sm text-[var(--dim)] mt-1">Scheduled recurring AI analysis</p>
      </motion.div>

      {/* Master control card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING, delay: 0.05 }}
        className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 mb-6 flex items-center justify-between"
      >
        <div>
          <h2 className="font-display text-lg text-[var(--ink)]">Autonomous Analysis</h2>
          <p className="text-sm text-[var(--dim)] mt-0.5">Enable to run analysis on your configured schedule automatically.</p>
        </div>
        <ToggleSwitch
          checked={enabled}
          onChange={(v) => toggleMutation.mutate(v)}
        />
      </motion.div>

      {/* Status cards */}
      {status && <ScheduleStatusCards status={status} />}

      {/* Schedule card — only when enabled */}
      <AnimatePresence>
        {enabled && schedule && (
          <motion.div
            key="schedule"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: SPRING }}
            className="overflow-hidden"
          >
            <ScheduleCard schedule={schedule} slug={slug} brandId={brandId} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Next scheduled runs */}
      {enabled && schedule && <NextRunsList schedule={schedule} />}

      {/* Run Now */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => runNowMutation.mutate()}
          loading={runNowMutation.isPending || isRunning}
          disabled={runNowMutation.isPending || isRunning}
        >
          <Play className="h-4 w-4" />
          Run Now
        </Button>
      </div>

      {/* Run History */}
      <RunHistory slug={slug} brandId={brandId} />
    </div>
  )
}
