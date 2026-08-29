'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Lightbulb,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  Clock,
  ChevronLeft,
  ChevronRight,
  Table2,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScoreRing } from '@/components/ui/score-ring'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { cn, scoreColor, relativeTime } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ContentPiece {
  id: string
  title: string
  url: string
  score: number
  word_count: number
  last_modified: string
  status: 'published' | 'draft' | 'needs_review' | 'optimized'
  strengths: string[]
  weaknesses: string[]
  recommendations: string[]
}

interface Gap {
  id: string
  gap_type: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  estimated_impact: number
}

interface Improvement {
  id: string
  title: string
  priority: 'critical' | 'high' | 'medium'
  effort: 'low' | 'medium' | 'high'
  impact_score: number
}

interface ContentData {
  pieces: ContentPiece[]
  gaps: Gap[]
  improvements: Improvement[]
  summary: {
    content_score: number
    gaps_found: number
    improvements: number
    pieces_analyzed: number
    last_analyzed?: string
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SPRING: [number, number, number, number] = [0.16, 1, 0.3, 1]

function statusVariant(s: ContentPiece['status']): 'success' | 'info' | 'warning' | 'outline' {
  const map = { published: 'success', optimized: 'info', needs_review: 'warning', draft: 'outline' } as const
  return map[s]
}

function statusLabel(s: ContentPiece['status']) {
  const map = { published: 'Published', optimized: 'Optimized', needs_review: 'Needs Review', draft: 'Draft' }
  return map[s]
}

function severityVariant(s: Gap['severity']): 'danger' | 'warning' | 'info' | 'outline' {
  const map = { critical: 'danger', high: 'warning', medium: 'info', low: 'outline' } as const
  return map[s]
}

function effortVariant(e: Improvement['effort']): 'success' | 'warning' | 'danger' {
  const map = { low: 'success', medium: 'warning', high: 'danger' } as const
  return map[e]
}

function priorityHeaderClass(p: Improvement['priority']) {
  const map = {
    critical: 'text-danger border-danger/20 bg-danger-muted',
    high: 'text-warning border-warning/20 bg-warning-muted',
    medium: 'text-info border-info/20 bg-info-muted',
  }
  return map[p]
}

// ─── Clickable Audit Table ─────────────────────────────────────────────────────

const PAGE_SIZE = 10

function AuditTable({
  pieces,
  onSelect,
}: {
  pieces: ContentPiece[]
  onSelect: (p: ContentPiece) => void
}) {
  const [page, setPage] = useState(0)
  const total = Math.ceil(pieces.length / PAGE_SIZE)
  const slice = pieces.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (pieces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-dim">
          <Table2 className="h-5 w-5" />
        </div>
        <p className="text-sm text-dim">No content pieces found.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-paper overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead className="sticky top-0 bg-surface z-10 border-b border-border">
            <tr>
              {['Title', 'URL', 'Score', 'Words', 'Modified', 'Status'].map((h) => (
                <th key={h} className="text-left py-3 px-4 text-xs font-medium text-dim uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <motion.tr
                key={row.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
                onClick={() => onSelect(row)}
                className="border-b border-border last:border-0 cursor-pointer hover:bg-surface transition-colors duration-100"
              >
                <td className="py-3 px-4 max-w-[220px]">
                  <span className="block truncate font-medium text-ink">{row.title}</span>
                </td>
                <td className="py-3 px-4">
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs font-mono text-dim hover:text-ember transition-colors max-w-[160px] truncate"
                  >
                    {row.url.replace(/^https?:\/\//, '').slice(0, 36)}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </td>
                <td className="py-3 px-4 w-16">
                  <ScoreRing score={row.score} size={36} strokeWidth={4} />
                </td>
                <td className="py-3 px-4 w-24">
                  <span className="font-mono text-xs text-dim">{row.word_count.toLocaleString()}</span>
                </td>
                <td className="py-3 px-4 w-28">
                  <span className="text-xs text-dim">{relativeTime(row.last_modified)}</span>
                </td>
                <td className="py-3 px-4 w-32">
                  <Badge variant={statusVariant(row.status)} size="sm">{statusLabel(row.status)}</Badge>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-xs text-dim">Page {page + 1} of {total}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-md text-dim hover:text-ink hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
              disabled={page === total - 1}
              className="p-1.5 rounded-md text-dim hover:text-ink hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Piece Detail Modal ─────────────────────────────────────────────────────────

function PieceModal({
  piece,
  open,
  onClose,
}: {
  piece: ContentPiece | null
  open: boolean
  onClose: () => void
}) {
  if (!piece) return null

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <ModalHeader>
          <div className="flex items-start gap-3 pr-6">
            <ScoreRing score={piece.score} size={52} strokeWidth={5} />
            <div className="flex-1 min-w-0">
              <ModalTitle className="line-clamp-2">{piece.title}</ModalTitle>
              <a
                href={piece.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-dim hover:text-ember transition-colors mt-1 font-mono"
              >
                {piece.url.length > 60 ? piece.url.slice(0, 60) + '…' : piece.url}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge variant={statusVariant(piece.status)} size="sm">{statusLabel(piece.status)}</Badge>
            <span className="text-xs text-dim font-mono">{piece.word_count.toLocaleString()} words</span>
            <span className="text-xs text-dim">· {relativeTime(piece.last_modified)}</span>
          </div>
        </ModalHeader>
        <ModalBody className="space-y-5">
          {piece.strengths.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-dim uppercase tracking-wide mb-2">Strengths</p>
              <ul className="space-y-1.5">
                {piece.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {piece.weaknesses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-dim uppercase tracking-wide mb-2">Weaknesses</p>
              <ul className="space-y-1.5">
                {piece.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {piece.recommendations.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-dim uppercase tracking-wide mb-2">Recommendations</p>
              <ul className="space-y-1.5">
                {piece.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <Lightbulb className="h-4 w-4 text-ember shrink-0 mt-0.5" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

// ─── Gaps Tab ──────────────────────────────────────────────────────────────────

function GapsTab({ gaps }: { gaps: Gap[] }) {
  if (gaps.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle className="h-6 w-6" />}
        title="No gaps detected"
        description="Your content covers all identified topic clusters."
      />
    )
  }

  return (
    <div className="space-y-3">
      {gaps.map((gap, i) => (
        <motion.div
          key={gap.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: SPRING, delay: i * 0.06 }}
        >
          <Card className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <Badge variant={severityVariant(gap.severity)} size="sm" dot>
                      {gap.severity.charAt(0).toUpperCase() + gap.severity.slice(1)}
                    </Badge>
                    <Badge variant="outline" size="sm">{gap.gap_type.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="text-sm text-ink leading-relaxed">{gap.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-dim mb-0.5">Est. Impact</p>
                  <p className={cn('text-lg font-display font-semibold', gap.estimated_impact >= 20 ? 'text-success' : 'text-warning')}>
                    +{gap.estimated_impact}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Improvements Tab ──────────────────────────────────────────────────────────

function ImprovementsTab({ improvements }: { improvements: Improvement[] }) {
  const groups: Improvement['priority'][] = ['critical', 'high', 'medium']

  if (improvements.length === 0) {
    return (
      <EmptyState
        icon={<Lightbulb className="h-6 w-6" />}
        title="No improvements queued"
        description="Run an analysis to surface improvement opportunities."
      />
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((priority) => {
        const items = improvements.filter((imp) => imp.priority === priority)
        if (!items.length) return null
        return (
          <div key={priority}>
            <div className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border mb-3', priorityHeaderClass(priority))}>
              {priority.charAt(0).toUpperCase() + priority.slice(1)}
              <span className="opacity-60">· {items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((imp, i) => (
                <motion.div
                  key={imp.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease: SPRING, delay: i * 0.05 }}
                >
                  <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink">{imp.title}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs text-dim">Effort:</span>
                          <Badge variant={effortVariant(imp.effort)} size="sm">
                            {imp.effort.charAt(0).toUpperCase() + imp.effort.slice(1)}
                          </Badge>
                          <span className="text-xs text-dim ml-1">
                            Impact: <span className={cn('font-semibold', scoreColor(imp.impact_score))}>{imp.impact_score}</span>
                          </span>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">Apply</Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Export Tab ────────────────────────────────────────────────────────────────

function ExportTab({ slug, brandId }: { slug: string; brandId: string }) {
  function downloadAs(format: 'csv' | 'json') {
    window.open(`${routes.content(slug, brandId)}/export?format=${format}`, '_blank')
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <p className="text-sm text-dim font-sans text-center max-w-xs leading-relaxed">
        Export your full content analysis for offline review or client reporting.
      </p>
      <div className="flex items-center gap-4">
        {(
          [
            { format: 'csv', Icon: FileSpreadsheet, label: 'Export CSV', sub: 'Spreadsheet format' },
            { format: 'json', Icon: FileJson, label: 'Export JSON', sub: 'Structured data' },
          ] as const
        ).map(({ format, Icon, label, sub }) => (
          <motion.button
            key={format}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => downloadAs(format)}
            className="flex flex-col items-center gap-3 p-8 rounded-xl border border-border bg-surface hover:bg-paper hover:border-ember/40 hover:shadow-md transition-all cursor-pointer group"
          >
            <Icon className="h-10 w-10 text-dim group-hover:text-ember transition-colors" />
            <div className="text-center">
              <p className="font-semibold text-ink text-sm">{label}</p>
              <p className="text-xs text-dim mt-0.5">{sub}</p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ContentPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [selectedPiece, setSelectedPiece] = useState<ContentPiece | null>(null)
  const [activeTab, setActiveTab] = useState('audit')

  const { data, isLoading } = useQuery({
    queryKey: ['content', slug, brandId],
    queryFn: () => api.get<ContentData>(routes.content(slug, brandId)),
  })

  const analyzeMutation = useMutation({
    mutationFn: () => api.post(`${routes.content(slug, brandId)}/analyze`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content', slug, brandId] })
      toast({ title: 'Analysis complete', description: 'Content intelligence refreshed.', variant: 'success' })
    },
    onError: () => {
      toast({ title: 'Analysis failed', description: 'Please try again.', variant: 'error' })
    },
  })

  const pieces = data?.pieces ?? []
  const gaps = data?.gaps ?? []
  const improvements = data?.improvements ?? []
  const summary = data?.summary
  const isEmpty = !isLoading && pieces.length === 0 && gaps.length === 0 && improvements.length === 0

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="h-8 w-64 skeleton rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  return (
    <>
      <PieceModal piece={selectedPiece} open={!!selectedPiece} onClose={() => setSelectedPiece(null)} />

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: SPRING }}
          className="flex items-start justify-between gap-4"
        >
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink">Content Intelligence</h1>
            {summary?.last_analyzed && (
              <p className="text-sm text-dim mt-1 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Last analyzed {relativeTime(summary.last_analyzed)}
              </p>
            )}
          </div>
          <Button onClick={() => analyzeMutation.mutate()} loading={analyzeMutation.isPending} className="shrink-0">
            <RefreshCw className="h-4 w-4" />
            Analyze Now
          </Button>
        </motion.div>

        {/* Stat cards */}
        {summary && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: SPRING, delay: 0.05 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          >
            <StatCard label="Content Score" value={summary.content_score} suffix="/100" />
            <StatCard label="Gaps Found" value={summary.gaps_found} />
            <StatCard label="Improvements" value={summary.improvements} />
            <StatCard label="Pieces Analyzed" value={summary.pieces_analyzed} />
          </motion.div>
        )}

        {/* Empty state */}
        {isEmpty ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No content analyzed yet"
            description="Run your first analysis to surface insights across your content library."
            action={
              <Button onClick={() => analyzeMutation.mutate()} loading={analyzeMutation.isPending}>
                <RefreshCw className="h-4 w-4" />
                Analyze Now
              </Button>
            }
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: SPRING, delay: 0.1 }}
          >
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="audit">
                  Content Audit
                  {pieces.length > 0 && <span className="ml-1.5 text-xs text-dim font-mono">({pieces.length})</span>}
                </TabsTrigger>
                <TabsTrigger value="gaps">
                  Gaps
                  {gaps.length > 0 && <span className="ml-1.5 text-xs text-dim font-mono">({gaps.length})</span>}
                </TabsTrigger>
                <TabsTrigger value="improvements">
                  Improvements
                  {improvements.length > 0 && <span className="ml-1.5 text-xs text-dim font-mono">({improvements.length})</span>}
                </TabsTrigger>
                <TabsTrigger value="export">Export</TabsTrigger>
              </TabsList>

              <TabsContent value="audit">
                <AuditTable pieces={pieces} onSelect={setSelectedPiece} />
                <p className="text-xs text-dim mt-2 font-sans">Click any row to view full analysis.</p>
              </TabsContent>

              <TabsContent value="gaps">
                <GapsTab gaps={gaps} />
              </TabsContent>

              <TabsContent value="improvements">
                <ImprovementsTab improvements={improvements} />
              </TabsContent>

              <TabsContent value="export">
                <ExportTab slug={slug} brandId={brandId} />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </div>
    </>
  )
}
