'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn, formatNumber, relativeTime } from '@/lib/utils'
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Trash2,
  GitCompare,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type Module = 'seo' | 'geo' | 'competitive' | 'visibility'

interface Snapshot {
  id: string
  label: string
  created_at: string
  modules: Module[]
  scores: Record<string, number>
}

interface SnapshotsResponse {
  snapshots: Snapshot[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_COLORS: Record<Module, string> = {
  seo: 'bg-blue-100 text-blue-700',
  geo: 'bg-green-100 text-green-700',
  competitive: 'bg-purple-100 text-purple-700',
  visibility: 'bg-amber-100 text-amber-700',
}

// ─── Camera Shutter Overlay ───────────────────────────────────────────────────

function ShutterOverlay({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-0 z-50 pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.6) 60%, transparent 100%)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.6, times: [0, 0.1, 0.4, 1] }}
        />
      )}
    </AnimatePresence>
  )
}

// ─── Module Badge ─────────────────────────────────────────────────────────────

function ModuleBadge({ module }: { module: Module }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
        MODULE_COLORS[module]
      )}
    >
      {module}
    </span>
  )
}

// ─── Score Card ───────────────────────────────────────────────────────────────

function ScoreCard({
  label,
  value,
  prev,
}: {
  label: string
  value: number
  prev?: number
}) {
  const delta = prev !== undefined ? value - prev : null
  const up = delta !== null && delta > 0
  const down = delta !== null && delta < 0

  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)]">{label}</p>
      <p className="text-2xl font-bold text-[var(--ink)]">{formatNumber(value)}</p>
      {delta !== null && delta !== 0 && (
        <p className={cn('flex items-center gap-0.5 text-xs font-medium', up ? 'text-green-600' : 'text-red-500')}>
          {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {up ? '+' : ''}{formatNumber(delta)}
        </p>
      )}
      {delta === 0 && (
        <p className="flex items-center gap-0.5 text-xs font-medium text-[var(--dim)]">
          <Minus size={12} /> No change
        </p>
      )}
    </div>
  )
}

// ─── Snapshot Row ─────────────────────────────────────────────────────────────

function SnapshotRow({
  snapshot,
  isLatest,
  prevScores,
  onDelete,
}: {
  snapshot: Snapshot
  isLatest: boolean
  prevScores?: Record<string, number>
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const scoreEntries = Object.entries(snapshot.scores)

  return (
    <div className="relative flex gap-4">
      {/* Timeline spine + dot */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'w-3 h-3 rounded-full mt-1 shrink-0 transition-shadow',
            isLatest
              ? 'bg-[var(--ember)] shadow-[0_0_0_4px_rgba(194,65,12,0.2)]'
              : 'bg-[var(--dim)]'
          )}
        />
        <div className="w-px flex-1 bg-[var(--border)] mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-[var(--ink)]">{snapshot.label}</p>
              {isLatest && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ember)] bg-[var(--ember)]/10 px-2 py-0.5 rounded-full">
                  Latest
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--dim)] mt-0.5">{relativeTime(snapshot.created_at)}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {snapshot.modules.map((m) => (
                <ModuleBadge key={m} module={m} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Delete with inline confirm */}
            <button
              onClick={() => {
                if (confirmDelete) {
                  onDelete(snapshot.id)
                } else {
                  setConfirmDelete(true)
                }
              }}
              onBlur={() => setTimeout(() => setConfirmDelete(false), 200)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer',
                confirmDelete
                  ? 'bg-red-100 text-red-600 border border-red-300'
                  : 'text-[var(--dim)] hover:text-red-500 hover:bg-red-50 border border-transparent'
              )}
            >
              <Trash2 size={12} />
              {confirmDelete ? 'Confirm?' : 'Delete'}
            </button>

            {/* Expand/collapse */}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:border-[var(--ember)] transition-colors cursor-pointer"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Hide' : 'View'}
            </button>
          </div>
        </div>

        {/* Expandable scores */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                {scoreEntries.map(([key, val]) => (
                  <ScoreCard
                    key={key}
                    label={key}
                    value={val}
                    prev={prevScores?.[key]}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Comparison Table ─────────────────────────────────────────────────────────

function ComparisonView({ snapshots }: { snapshots: Snapshot[] }) {
  const [idA, setIdA] = useState(snapshots[0]?.id ?? '')
  const [idB, setIdB] = useState(snapshots[1]?.id ?? '')

  const a = snapshots.find((s) => s.id === idA)
  const b = snapshots.find((s) => s.id === idB)

  const allKeys = Array.from(
    new Set([...Object.keys(a?.scores ?? {}), ...Object.keys(b?.scores ?? {})])
  )

  const fmt = (n?: number) => (n !== undefined ? formatNumber(n) : '—')

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-[var(--border)] bg-[var(--paper)] overflow-hidden"
    >
      {/* Selectors */}
      <div className="grid grid-cols-3 gap-px bg-[var(--border)]">
        <div className="bg-[var(--paper)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)] mb-2">Snapshot A</p>
          <select
            value={idA}
            onChange={(e) => setIdA(e.target.value)}
            className="w-full text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--surface)] text-[var(--ink)] cursor-pointer"
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.label} — {relativeTime(s.created_at)}</option>
            ))}
          </select>
        </div>
        <div className="bg-[var(--paper)] p-4 flex items-end justify-center">
          <GitCompare size={18} className="text-[var(--dim)] mb-1.5" />
        </div>
        <div className="bg-[var(--paper)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)] mb-2">Snapshot B</p>
          <select
            value={idB}
            onChange={(e) => setIdB(e.target.value)}
            className="w-full text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--surface)] text-[var(--ink)] cursor-pointer"
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.label} — {relativeTime(s.created_at)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Diff table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)]">Metric</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)]">A</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)]">B</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--dim)]">Delta</th>
            </tr>
          </thead>
          <tbody>
            {allKeys.map((key, i) => {
              const va = a?.scores[key]
              const vb = b?.scores[key]
              const delta = va !== undefined && vb !== undefined ? vb - va : null
              const up = delta !== null && delta > 0
              const down = delta !== null && delta < 0
              return (
                <tr
                  key={key}
                  className={cn('border-b border-[var(--border)]', i % 2 === 0 ? 'bg-[var(--paper)]' : 'bg-[var(--surface)]')}
                >
                  <td className="px-4 py-2.5 font-medium text-[var(--ink)] capitalize">{key}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dim)]">{fmt(va)}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dim)]">{fmt(vb)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {delta === null ? (
                      <span className="text-[var(--dim)]">—</span>
                    ) : (
                      <span className={cn('inline-flex items-center gap-0.5 font-semibold', up ? 'text-green-600' : down ? 'text-red-500' : 'text-[var(--dim)]')}>
                        {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : <Minus size={11} />}
                        {up ? '+' : ''}{formatNumber(delta)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SnapshotsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()
  const [shutter, setShutter] = useState(false)
  const [compareMode, setCompareMode] = useState(false)

  const { data, isLoading } = useQuery<SnapshotsResponse>({
    queryKey: ['snapshots', slug, brandId],
    queryFn: () => api.get(`/api/orgs/${slug}/brands/${brandId}/snapshots`),
  })

  const takeMutation = useMutation({
    mutationFn: () => api.post(`/api/orgs/${slug}/brands/${brandId}/snapshots`),
    onMutate: () => {
      setShutter(true)
      setTimeout(() => setShutter(false), 700)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snapshots', slug, brandId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/api/orgs/${slug}/brands/${brandId}/snapshots/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snapshots', slug, brandId] }),
  })

  const handleDelete = useCallback(
    (id: string) => deleteMutation.mutate(id),
    [deleteMutation]
  )

  const snapshots = data?.snapshots ?? []

  return (
    <>
      <ShutterOverlay active={shutter} />

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold font-display text-[var(--ink)]">Snapshots</h1>
            <p className="text-sm text-[var(--dim)] mt-0.5">Point-in-time intelligence captures</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {snapshots.length >= 2 && (
              <button
                onClick={() => setCompareMode((v) => !v)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer',
                  compareMode
                    ? 'bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]'
                    : 'bg-[var(--paper)] text-[var(--ink)] border-[var(--border)] hover:border-[var(--ink)]'
                )}
              >
                <GitCompare size={14} />
                Compare Two Snapshots
              </button>
            )}
            <button
              onClick={() => takeMutation.mutate()}
              disabled={takeMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--ember)] text-white hover:bg-[var(--ember)]/90 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Camera size={14} />
              {takeMutation.isPending ? 'Capturing…' : 'Take Snapshot'}
            </button>
          </div>
        </div>

        {/* Comparison view */}
        <AnimatePresence>
          {compareMode && snapshots.length >= 2 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden mb-8"
            >
              <ComparisonView snapshots={snapshots} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Timeline */}
        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="w-3 h-3 rounded-full bg-[var(--border)] mt-1 shrink-0" />
                <div className="flex-1 space-y-2 pb-6">
                  <div className="h-4 bg-[var(--border)] rounded w-40" />
                  <div className="h-3 bg-[var(--border)] rounded w-24" />
                  <div className="flex gap-2 mt-2">
                    <div className="h-5 bg-[var(--border)] rounded-full w-16" />
                    <div className="h-5 bg-[var(--border)] rounded-full w-20" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : snapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Camera size={32} className="text-[var(--dim)] mb-3" />
            <p className="text-sm font-medium text-[var(--ink)]">No snapshots yet</p>
            <p className="text-xs text-[var(--dim)] mt-1">Take your first snapshot to begin tracking intelligence over time.</p>
          </div>
        ) : (
          <div>
            {snapshots.map((snap, i) => (
              <SnapshotRow
                key={snap.id}
                snapshot={snap}
                isLatest={i === 0}
                prevScores={snapshots[i + 1]?.scores}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
