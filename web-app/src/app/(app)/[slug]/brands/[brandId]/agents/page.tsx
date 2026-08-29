'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  Search,
  Zap,
  Play,
  ChevronDown,
  ChevronUp,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, relativeTime, formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

// ─── Types ─────────────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'running' | 'completed' | 'failed'
type AgentType = 'geo' | 'seo' | 'growth'

interface AgentState {
  status: AgentStatus
  last_run_at?: string
  last_run_id?: string
  actions_generated?: number
}

interface AgentRun {
  id: string
  agent_type: AgentType
  status: AgentStatus
  started_at: string
  completed_at?: string
  actions_generated?: number
}

interface RunAction {
  id: string
  title: string
  description?: string
  priority?: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const SPRING = [0.16, 1, 0.3, 1] as [number, number, number, number]

const AGENTS: {
  type: AgentType
  label: string
  description: string
  icon: React.ElementType
  iconBg: string
  iconColor: string
  routeKey: 'geoAgent' | 'seoAgent' | 'growthAgent'
}[] = [
  {
    type: 'geo',
    label: 'GEO Agent',
    description: 'Audits AI model citations, detects brand mentions, and maps generative visibility gaps across ChatGPT, Gemini, Claude, and Perplexity.',
    icon: Brain,
    iconBg: 'bg-[var(--ember)]/10',
    iconColor: 'text-[var(--ember)]',
    routeKey: 'geoAgent',
  },
  {
    type: 'seo',
    label: 'SEO Agent',
    description: 'Crawls keyword rankings, identifies content gaps, and surfaces link opportunities to grow organic search authority.',
    icon: Search,
    iconBg: 'bg-[var(--info)]/10',
    iconColor: 'text-[var(--info)]',
    routeKey: 'seoAgent',
  },
  {
    type: 'growth',
    label: 'Growth Agent',
    description: 'Analyses funnel conversion signals, competitive positioning, and recommends high-leverage growth experiments.',
    icon: Zap,
    iconBg: 'bg-[var(--success)]/10',
    iconColor: 'text-[var(--success)]',
    routeKey: 'growthAgent',
  },
]

// ─── CSS Sparkle effect ────────────────────────────────────────────────────────

const sparkleKeyframes = `
@keyframes sparkle-pop {
  0%   { opacity: 0; transform: scale(0) translate(0, 0); }
  40%  { opacity: 1; transform: scale(1) translate(var(--tx), var(--ty)); }
  100% { opacity: 0; transform: scale(0.5) translate(var(--tx2), var(--ty2)); }
}
`

function SparkleOverlay({ active }: { active: boolean }) {
  if (!active) return null
  const particles = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * 360
    const dist = 40 + Math.random() * 60
    const tx = Math.cos((angle * Math.PI) / 180) * dist
    const ty = Math.sin((angle * Math.PI) / 180) * dist
    const tx2 = tx * 1.4
    const ty2 = ty * 1.4
    const delay = Math.random() * 0.3
    const colors = ['#C2410C', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899']
    const color = colors[i % colors.length]
    const size = 4 + Math.random() * 6
    return { tx, ty, tx2, ty2, delay, color, size }
  })

  return (
    <>
      <style>{sparkleKeyframes}</style>
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl" aria-hidden="true">
        {particles.map((p, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: '50%',
              top: '40%',
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              backgroundColor: p.color,
              animation: `sparkle-pop 0.8s ${p.delay}s ease-out forwards`,
              // @ts-expect-error CSS custom properties
              '--tx': `${p.tx}px`,
              '--ty': `${p.ty}px`,
              '--tx2': `${p.tx2}px`,
              '--ty2': `${p.ty2}px`,
            }}
          />
        ))}
      </div>
    </>
  )
}

// ─── Status helpers ────────────────────────────────────────────────────────────

function statusBadgeVariant(s: AgentStatus): 'outline' | 'info' | 'success' | 'danger' {
  switch (s) {
    case 'idle': return 'outline'
    case 'running': return 'info'
    case 'completed': return 'success'
    case 'failed': return 'danger'
  }
}

function StatusIcon({ status }: { status: AgentStatus }) {
  switch (status) {
    case 'running': return <Loader2 className="h-3.5 w-3.5 animate-spin" />
    case 'completed': return <CheckCircle2 className="h-3.5 w-3.5" />
    case 'failed': return <XCircle className="h-3.5 w-3.5" />
    default: return null
  }
}

function durationStr(run: AgentRun): string {
  if (!run.completed_at) return '—'
  const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

// ─── Agent Card ────────────────────────────────────────────────────────────────

function AgentCard({
  agentDef,
  state,
  recentRuns,
  onRun,
  running,
  justCompleted,
}: {
  agentDef: (typeof AGENTS)[number]
  state?: AgentState
  recentRuns: AgentRun[]
  onRun: () => void
  running: boolean
  justCompleted: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = agentDef.icon
  const status: AgentStatus = state?.status ?? 'idle'
  const isRunning = status === 'running'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: SPRING }}
      className="relative rounded-2xl border border-[var(--border)] bg-white/70 p-6 flex flex-col overflow-hidden"
    >
      <SparkleOverlay active={justCompleted} />

      {/* Icon circle */}
      <div className={cn('w-14 h-14 rounded-full flex items-center justify-center mb-4', agentDef.iconBg)}>
        <Icon className={cn('h-6 w-6', agentDef.iconColor)} />
      </div>

      {/* Name */}
      <h3 className="font-display text-xl text-[var(--ink)]">{agentDef.label}</h3>

      {/* Description */}
      <p className="text-sm text-[var(--dim)] mt-1 leading-relaxed flex-1">{agentDef.description}</p>

      {/* Status badge */}
      <div className="mt-3">
        <Badge variant={statusBadgeVariant(status)} size="sm" dot={status !== 'running'}>
          {status === 'running' ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running
            </span>
          ) : status}
        </Badge>
      </div>

      {/* Last run */}
      {state?.last_run_at && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--dim)] mt-3">
          <Clock className="h-3 w-3 shrink-0" />
          <span>Last run {relativeTime(state.last_run_at)}</span>
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center gap-2 mt-4">
        <Button
          size="sm"
          onClick={onRun}
          loading={running || isRunning}
          disabled={isRunning}
          className="flex-1"
        >
          <Play className="h-3.5 w-3.5" />
          {isRunning ? 'Running…' : 'Run Now'}
        </Button>
        <Button size="sm" variant="outline">
          <Settings className="h-3.5 w-3.5" />
          Configure
        </Button>
      </div>

      {/* Expand recent runs */}
      {recentRuns.length > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between text-xs text-[var(--dim)] hover:text-[var(--ink)] transition-colors py-1 mt-3"
        >
          <span>Recent runs ({recentRuns.length})</span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: SPRING }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-1">
              {recentRuns.slice(0, 5).map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-2 text-xs py-2 border-b border-[var(--border)] last:border-0"
                >
                  <StatusIcon status={run.status} />
                  <Badge variant={statusBadgeVariant(run.status)} size="sm">{run.status}</Badge>
                  <span className="text-[var(--dim)] flex-1 text-right">{relativeTime(run.started_at)}</span>
                  {run.actions_generated != null && (
                    <span className="font-mono text-[var(--dim)]">{run.actions_generated} actions</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Run Detail Panel ─────────────────────────────────────────────────────────

function RunDetailPanel({
  run,
  slug,
  brandId,
  onClose,
}: {
  run: AgentRun
  slug: string
  brandId: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['run-actions', slug, brandId, run.id],
    queryFn: () =>
      api.get<{ actions: RunAction[] }>(
        `/api/orgs/${slug}/brands/${brandId}/runs/${run.id}/actions`
      ),
  })

  const actions: RunAction[] = (data as { actions?: RunAction[] } | undefined)?.actions ?? []

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.32, ease: SPRING }}
      className="h-full flex flex-col overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 p-5 border-b border-[var(--border)] shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={statusBadgeVariant(run.status)} size="sm" dot>{run.status}</Badge>
            <span className="text-xs font-mono text-[var(--dim)] uppercase">{run.agent_type} agent</span>
          </div>
          <h3 className="font-display text-lg font-semibold text-[var(--ink)]">Run Details</h3>
          <p className="text-xs text-[var(--dim)] mt-0.5">{relativeTime(run.started_at)}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-[var(--surface)] transition-colors text-[var(--dim)] hover:text-[var(--ink)] shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 p-5 border-b border-[var(--border)] shrink-0">
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <p className="text-xs text-[var(--dim)] mb-1">Duration</p>
          <p className="font-display text-xl font-semibold text-[var(--ink)]">{durationStr(run)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <p className="text-xs text-[var(--dim)] mb-1">Actions</p>
          <p className="font-display text-xl font-semibold text-[var(--ink)]">{run.actions_generated ?? '—'}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <p className="text-xs text-[var(--dim)] uppercase tracking-wide font-semibold mb-3">Generated Actions</p>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 bg-[var(--surface)] rounded-md animate-pulse" />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <p className="text-sm text-[var(--dim)]">No actions recorded for this run.</p>
        ) : (
          <motion.ul
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.05 } }, hidden: {} }}
            className="space-y-2"
          >
            {actions.map((action) => (
              <motion.li
                key={action.id}
                variants={{
                  hidden: { opacity: 0, x: 12 },
                  visible: { opacity: 1, x: 0, transition: { duration: 0.25, ease: SPRING } },
                }}
                className="flex items-start gap-2.5 p-3 bg-[var(--surface)] rounded-lg border border-[var(--border)]"
              >
                <Zap className="h-4 w-4 text-[var(--ember)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[var(--ink)]">{action.title}</p>
                  {action.description && (
                    <p className="text-xs text-[var(--dim)] mt-0.5 leading-relaxed">{action.description}</p>
                  )}
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </motion.div>
  )
}

// ─── Run History Table ─────────────────────────────────────────────────────────

const AGENT_TYPE_META: Record<AgentType, { label: string }> = {
  geo: { label: 'GEO Agent' },
  seo: { label: 'SEO Agent' },
  growth: { label: 'Growth Agent' },
}

function RunHistoryTable({
  runs,
  selectedRun,
  onSelect,
}: {
  runs: AgentRun[]
  selectedRun: AgentRun | null
  onSelect: (run: AgentRun) => void
}) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 rounded-lg border border-dashed border-[var(--border)]">
        <p className="text-sm text-[var(--dim)]">No runs yet. Fire an agent to get started.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_120px_120px_80px_80px] gap-3 px-4 py-2.5 bg-[var(--surface)] border-b border-[var(--border)]">
        {['Agent', 'Status', 'Started', 'Completed', 'Duration', 'Actions'].map((h) => (
          <span key={h} className="text-xs font-semibold text-[var(--dim)] uppercase tracking-wide">{h}</span>
        ))}
      </div>

      <div className="divide-y divide-[var(--border)]">
        <AnimatePresence initial={false}>
          {runs.map((run, i) => {
            const meta = AGENT_TYPE_META[run.agent_type]
            const isSelected = selectedRun?.id === run.id
            return (
              <motion.button
                key={run.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, ease: SPRING, delay: i * 0.04 }}
                onClick={() => onSelect(run)}
                className={cn(
                  'w-full grid grid-cols-[1fr_120px_120px_120px_80px_80px] gap-3 px-4 py-3 text-left',
                  'hover:bg-[var(--surface)]/70 transition-colors',
                  isSelected && 'bg-[var(--surface)] ring-1 ring-inset ring-[var(--ember)]/30'
                )}
              >
                <span className="text-sm font-medium text-[var(--ink)]">{meta.label}</span>
                <div>
                  <Badge variant={statusBadgeVariant(run.status)} size="sm" dot={run.status !== 'running'}>
                    {run.status === 'running' ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Running
                      </span>
                    ) : run.status}
                  </Badge>
                </div>
                <span className="text-xs text-[var(--dim)] self-center">{relativeTime(run.started_at)}</span>
                <span className="text-xs text-[var(--dim)] self-center">{run.completed_at ? relativeTime(run.completed_at) : '—'}</span>
                <span className="text-xs font-mono text-[var(--dim)] self-center">{durationStr(run)}</span>
                <span className="text-xs font-mono text-[var(--ink)] self-center">{run.actions_generated ?? '—'}</span>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null)
  const prevStatuses = useRef<Record<AgentType, AgentStatus>>({ geo: 'idle', seo: 'idle', growth: 'idle' })
  const [justCompleted, setJustCompleted] = useState<Record<AgentType, boolean>>({ geo: false, seo: false, growth: false })
  const [runningAgents, setRunningAgents] = useState<Record<AgentType, boolean>>({ geo: false, seo: false, growth: false })

  const agentQueries = AGENTS.map((a) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['agent-state', slug, brandId, a.type],
      queryFn: () => api.get<AgentState>(routes[a.routeKey](slug, brandId)),
      refetchInterval: (query) => {
        const s = (query.state.data as AgentState | undefined)?.status
        return s === 'running' ? 5000 : false
      },
    })
  )

  const agentStates: Record<AgentType, AgentState | undefined> = {
    geo: agentQueries[0].data as AgentState | undefined,
    seo: agentQueries[1].data as AgentState | undefined,
    growth: agentQueries[2].data as AgentState | undefined,
  }

  useEffect(() => {
    AGENTS.forEach((a) => {
      const cur = agentStates[a.type]?.status ?? 'idle'
      const prev = prevStatuses.current[a.type]
      if (prev === 'running' && cur === 'completed') {
        setJustCompleted((s) => ({ ...s, [a.type]: true }))
        setTimeout(() => setJustCompleted((s) => ({ ...s, [a.type]: false })), 1200)
      }
      prevStatuses.current[a.type] = cur
    })
  })

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['agent-runs-history', slug, brandId],
    queryFn: () =>
      api.get<{ runs: AgentRun[] }>(`/api/orgs/${slug}/brands/${brandId}/agent-runs`),
    refetchInterval: () => {
      const anyRunning = AGENTS.some((a) => agentStates[a.type]?.status === 'running')
      return anyRunning ? 5000 : false
    },
  })

  const allRuns: AgentRun[] = (historyData as { runs?: AgentRun[] } | undefined)?.runs ?? []

  const runMutation = useMutation({
    mutationFn: ({ agentType, route }: { agentType: AgentType; route: string }) =>
      api.post<void>(`${route}/run`).then(() => ({ agentType })),
    onMutate: ({ agentType }) => {
      setRunningAgents((s) => ({ ...s, [agentType]: true }))
    },
    onSettled: (_data, _err, variables) => {
      if (variables?.agentType) setRunningAgents((s) => ({ ...s, [variables.agentType]: false }))
      AGENTS.forEach((a) => {
        qc.invalidateQueries({ queryKey: ['agent-state', slug, brandId, a.type] })
      })
      qc.invalidateQueries({ queryKey: ['agent-runs-history', slug, brandId] })
    },
  })

  const isLoading = agentQueries.some((q) => q.isLoading)

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: SPRING }}
      >
        <h1 className="font-display text-3xl font-semibold text-[var(--ink)]">AI Agents</h1>
        <p className="text-sm text-[var(--dim)] mt-1">Specialized intelligence modules</p>
      </motion.div>

      {/* Agent cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {AGENTS.map((agentDef, i) => {
            const recentRuns = allRuns.filter((r) => r.agent_type === agentDef.type).slice(0, 5)
            return (
              <motion.div
                key={agentDef.type}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: SPRING, delay: i * 0.08 }}
              >
                <AgentCard
                  agentDef={agentDef}
                  state={agentStates[agentDef.type]}
                  recentRuns={recentRuns}
                  onRun={() =>
                    runMutation.mutate({
                      agentType: agentDef.type,
                      route: routes[agentDef.routeKey](slug, brandId),
                    })
                  }
                  running={runningAgents[agentDef.type]}
                  justCompleted={justCompleted[agentDef.type]}
                />
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Run History */}
      <div>
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="font-display text-xl font-semibold text-[var(--ink)] mb-4"
        >
          Run History
        </motion.h2>

        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0">
            {historyLoading ? (
              <SkeletonCard />
            ) : (
              <RunHistoryTable
                runs={allRuns}
                selectedRun={selectedRun}
                onSelect={(run) => setSelectedRun(selectedRun?.id === run.id ? null : run)}
              />
            )}
          </div>

          <AnimatePresence>
            {selectedRun && (
              <motion.div
                key={selectedRun.id}
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: '380px' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.32, ease: SPRING }}
                className="shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--paper)] shadow-md sticky top-4"
                style={{ maxHeight: 'calc(100vh - 120px)' }}
              >
                <RunDetailPanel
                  run={selectedRun}
                  slug={slug}
                  brandId={brandId}
                  onClose={() => setSelectedRun(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
