'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Plus, RefreshCw, CheckCircle, AlertTriangle,
  Lightbulb, ExternalLink, FileJson, FileSpreadsheet, Clock,
  Search, SlidersHorizontal,
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { cn, scoreColor, relativeTime } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ContentType = 'blog' | 'whitepaper' | 'case_study' | 'video' | string
type ContentStatus = 'published' | 'draft' | 'needs_review' | 'optimized'

interface ContentPiece {
  id: string
  title: string
  url: string
  score: number
  geo_score?: number
  word_count: number
  last_modified: string
  status: ContentStatus
  content_type?: ContentType
  keywords_count?: number
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
    published?: number
    this_month?: number
    last_analyzed?: string
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SPRING: [number, number, number, number] = [0.16, 1, 0.3, 1]

function statusVariant(s: ContentStatus): 'success' | 'info' | 'warning' | 'outline' {
  const map = { published: 'success', optimized: 'info', needs_review: 'warning', draft: 'outline' } as const
  return map[s] ?? 'outline'
}

function statusLabel(s: ContentStatus) {
  const map: Record<ContentStatus, string> = { published: 'Published', optimized: 'Optimized', needs_review: 'Review', draft: 'Draft' }
  return map[s] ?? s
}

function contentTypeBadge(t: ContentType): { label: string; variant: 'info' | 'outline' | 'success' | 'warning' } {
  const map: Record<string, { label: string; variant: 'info' | 'outline' | 'success' | 'warning' }> = {
    blog: { label: 'Blog', variant: 'info' },
    whitepaper: { label: 'Whitepaper', variant: 'outline' },
    case_study: { label: 'Case Study', variant: 'success' },
    video: { label: 'Video', variant: 'warning' },
  }
  return map[t] ?? { label: t.replace(/_/g, ' '), variant: 'outline' }
}

// For whitepaper we want purple styling — override inline
function contentTypeClass(t: ContentType): string {
  if (t === 'whitepaper') return 'bg-purple-50 text-purple-700 border-purple-200 border rounded-full px-2.5 py-0.5 text-xs font-medium font-sans inline-flex items-center gap-1.5'
  return ''
}

function geoScoreProgressVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'danger'
}

function geoScoreTextColor(score: number) {
  if (score >= 70) return 'text-[var(--success)]'
  if (score >= 40) return 'text-[var(--warning)]'
  return 'text-[var(--danger)]'
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
    critical: 'text-[var(--danger)] border-[color:var(--danger)]/20 bg-red-50',
    high: 'text-[var(--warning)] border-[color:var(--warning)]/20 bg-amber-50',
    medium: 'text-[var(--info)] border-[color:var(--info)]/20 bg-blue-50',
  }
  return map[p]
}

// ─── Content Card ──────────────────────────────────────────────────────────────

function ContentCard({ piece, onSelect, index }: { piece: ContentPiece; onSelect: () => void; index: number }) {
  const geoScore = piece.geo_score ?? piece.score
  const progressVariant = geoScoreProgressVariant(geoScore)
  const textColor = geoScoreTextColor(geoScore)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: SPRING, delay: index * 0.05 }}
      className="rounded-2xl border border-[var(--border)] bg-white/70 p-5 hover:shadow-md transition-shadow cursor-pointer flex flex-col"
      onClick={onSelect}
    >
      {/* Type badge */}
      {piece.content_type && (() => {
        const badge = contentTypeBadge(piece.content_type)
        const cls = contentTypeClass(piece.content_type)
        if (cls) {
          return <span className={cls}>{badge.label}</span>
        }
        return <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
      })()}

      {/* Title */}
      <h3 className="font-display text-lg text-[var(--ink)] mt-2 leading-snug line-clamp-2">
        {piece.title}
      </h3>

      {/* GEO Score bar */}
      <div className="mt-3 mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-[var(--dim)] uppercase tracking-wide">GEO Score</span>
          <span className={cn('text-sm font-display font-semibold', textColor)}>{geoScore}/100</span>
        </div>
        <Progress value={geoScore} variant={progressVariant} className="h-1.5" />
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 flex-wrap mt-auto">
        <Badge variant={statusVariant(piece.status)} size="sm">{statusLabel(piece.status)}</Badge>
        {piece.keywords_count != null && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[11px] font-mono text-[var(--dim)]">
            {piece.keywords_count} kw
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={(e) => { e.stopPropagation(); onSelect() }}
        >
          View →
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Filter Bar ────────────────────────────────────────────────────────────────

interface Filters {
  type: string
  status: string
  sort: string
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-[var(--dim)]">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span className="text-xs font-medium uppercase tracking-wide">Filter</span>
      </div>
      <Select value={filters.type || 'all'} onValueChange={(v) => onChange({ ...filters, type: v === 'all' ? '' : v })}>
        <SelectTrigger className="h-8 text-xs w-36">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="blog">Blog</SelectItem>
          <SelectItem value="whitepaper">Whitepaper</SelectItem>
          <SelectItem value="case_study">Case Study</SelectItem>
          <SelectItem value="video">Video</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.status || 'all'} onValueChange={(v) => onChange({ ...filters, status: v === 'all' ? '' : v })}>
        <SelectTrigger className="h-8 text-xs w-36">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="published">Published</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="needs_review">Needs Review</SelectItem>
          <SelectItem value="optimized">Optimized</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// ─── Piece Detail Modal ────────────────────────────────────────────────────────

function PieceModal({ piece, open, onClose }: { piece: ContentPiece | null; open: boolean; onClose: () => void }) {
  if (!piece) return null
  const geoScore = piece.geo_score ?? piece.score
  const progressVariant = geoScoreProgressVariant(geoScore)
  const textColor = geoScoreTextColor(geoScore)

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <ModalHeader>
          <div className="flex items-start gap-3 pr-6">
            <ScoreRing score={geoScore} size={52} strokeWidth={5} />
            <div className="flex-1 min-w-0">
              <ModalTitle className="line-clamp-2">{piece.title}</ModalTitle>
              <a href={piece.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[var(--dim)] hover:text-[var(--ember)] transition-colors mt-1 font-mono">
                {piece.url.length > 60 ? piece.url.slice(0, 60) + '…' : piece.url}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge variant={statusVariant(piece.status)} size="sm">{statusLabel(piece.status)}</Badge>
            {piece.content_type && (() => {
              const badge = contentTypeBadge(piece.content_type)
              const cls = contentTypeClass(piece.content_type)
              if (cls) return <span className={cls}>{badge.label}</span>
              return <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
            })()}
            <span className="text-xs text-[var(--dim)] font-mono">{piece.word_count.toLocaleString()} words</span>
            <span className="text-xs text-[var(--dim)]">· {relativeTime(piece.last_modified)}</span>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-[var(--dim)] uppercase tracking-wide">GEO Score</span>
              <span className={cn('text-sm font-display font-semibold', textColor)}>{geoScore}/100</span>
            </div>
            <Progress value={geoScore} variant={progressVariant} />
          </div>
        </ModalHeader>
        <ModalBody className="space-y-5">
          {piece.strengths.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--dim)] uppercase tracking-wide mb-2">Strengths</p>
              <ul className="space-y-1.5">
                {piece.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--ink)]">
                    <CheckCircle className="h-4 w-4 text-[var(--success)] shrink-0 mt-0.5" />{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {piece.weaknesses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--dim)] uppercase tracking-wide mb-2">Weaknesses</p>
              <ul className="space-y-1.5">
                {piece.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--ink)]">
                    <AlertTriangle className="h-4 w-4 text-[var(--warning)] shrink-0 mt-0.5" />{w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {piece.recommendations.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--dim)] uppercase tracking-wide mb-2">Recommendations</p>
              <ul className="space-y-1.5">
                {piece.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--ink)]">
                    <Lightbulb className="h-4 w-4 text-[var(--ember)] shrink-0 mt-0.5" />{r}
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

// ─── Content Grid ──────────────────────────────────────────────────────────────

function ContentGrid({ pieces, onSelect }: { pieces: ContentPiece[]; onSelect: (p: ContentPiece) => void }) {
  const [filters, setFilters] = useState<Filters>({ type: '', status: '', sort: 'modified' })

  const filtered = pieces
    .filter((p) => !filters.type || p.content_type === filters.type)
    .filter((p) => !filters.status || p.status === filters.status)
    .sort((a, b) => {
      if (filters.sort === 'score_desc') return (b.geo_score ?? b.score) - (a.geo_score ?? a.score)
      if (filters.sort === 'score_asc') return (a.geo_score ?? a.score) - (b.geo_score ?? b.score)
      if (filters.sort === 'title') return a.title.localeCompare(b.title)
      return new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime()
    })

  if (pieces.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-6 w-6" />}
        title="No content pieces"
        description="Add your first piece of content to begin tracking GEO performance."
        action={<Button><Plus className="h-4 w-4" />Add Content</Button>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} onChange={setFilters} />
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Search className="h-8 w-8 text-[var(--dim)]" />
          <p className="text-sm text-[var(--dim)]">No content matches these filters.</p>
          <button onClick={() => setFilters({ type: '', status: '', sort: 'modified' })} className="text-xs text-[var(--ember)] hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((piece, i) => (
              <ContentCard key={piece.id} piece={piece} onSelect={() => onSelect(piece)} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
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
                  <p className="text-sm text-[var(--ink)] leading-relaxed">{gap.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-[var(--dim)] mb-0.5">Est. Impact</p>
                  <p className={cn('text-lg font-display font-semibold', gap.estimated_impact >= 20 ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
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
                        <p className="text-sm font-medium text-[var(--ink)]">{imp.title}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs text-[var(--dim)]">Effort:</span>
                          <Badge variant={effortVariant(imp.effort)} size="sm">
                            {imp.effort.charAt(0).toUpperCase() + imp.effort.slice(1)}
                          </Badge>
                          <span className="text-xs text-[var(--dim)] ml-1">
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
      <p className="text-sm text-[var(--dim)] font-sans text-center max-w-xs leading-relaxed">
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
            className="flex flex-col items-center gap-3 p-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--paper)] hover:border-[var(--ember)]/40 hover:shadow-md transition-all cursor-pointer group"
          >
            <Icon className="h-10 w-10 text-[var(--dim)] group-hover:text-[var(--ember)] transition-colors" />
            <div className="text-center">
              <p className="font-semibold text-[var(--ink)] text-sm">{label}</p>
              <p className="text-xs text-[var(--dim)] mt-0.5">{sub}</p>
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
  const [activeTab, setActiveTab] = useState('content')

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

  const published = summary?.published ?? pieces.filter((p) => p.status === 'published').length
  const avgGeo = pieces.length
    ? Math.round(pieces.reduce((acc, p) => acc + (p.geo_score ?? p.score), 0) / pieces.length)
    : 0

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-10 w-72 rounded-lg bg-[var(--surface)] animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
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
            <h1 className="font-display text-3xl font-semibold text-[var(--ink)]">Content Intelligence</h1>
            {summary?.last_analyzed && (
              <p className="text-sm text-[var(--dim)] mt-1 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Last analyzed {relativeTime(summary.last_analyzed)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => analyzeMutation.mutate()} loading={analyzeMutation.isPending}>
              <RefreshCw className="h-4 w-4" />
              Analyze
            </Button>
            <Button>
              <Plus className="h-4 w-4" />
              Add Content
            </Button>
          </div>
        </motion.div>

        {/* Stats row — 3 cards */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: SPRING, delay: 0.05 }}
          className="grid grid-cols-3 gap-4"
        >
          <StatCard label="Total Pieces" value={summary?.pieces_analyzed ?? pieces.length} />
          <StatCard label="Published" value={published} />
          <StatCard label="Avg GEO Score" value={avgGeo} suffix="/100" />
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: SPRING, delay: 0.1 }}
        >
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="content">
                Content
                {pieces.length > 0 && <span className="ml-1.5 text-xs text-[var(--dim)] font-mono">({pieces.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="gaps">
                Gaps
                {gaps.length > 0 && <span className="ml-1.5 text-xs text-[var(--dim)] font-mono">({gaps.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="improvements">
                Improvements
                {improvements.length > 0 && <span className="ml-1.5 text-xs text-[var(--dim)] font-mono">({improvements.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="export">Export</TabsTrigger>
            </TabsList>

            <TabsContent value="content">
              <ContentGrid pieces={pieces} onSelect={setSelectedPiece} />
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
      </div>
    </>
  )
}
