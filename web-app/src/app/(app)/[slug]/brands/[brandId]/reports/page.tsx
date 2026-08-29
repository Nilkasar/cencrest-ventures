'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Globe, Search, MapPin, Swords, LayoutGrid,
  Plus, Download, RefreshCw, Share2, Calendar, AlertCircle,
  CheckCircle2, Clock,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import {
  Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalBody, ModalFooter,
} from '@/components/ui/modal'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { cn, relativeTime } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = 'visibility' | 'seo' | 'geo' | 'competitive' | 'comprehensive'
type ReportFormat = 'PDF' | 'HTML' | 'JSON'
type ReportStatus = 'pending' | 'completed' | 'failed'

interface ReportSection {
  title: string
  summary: string
}

interface Report {
  id: string
  name: string
  type: ReportType
  format: ReportFormat
  status: ReportStatus
  completed_at: string | null
  file_path: string | null
  metadata?: { file_size?: string; error?: string; sections?: ReportSection[] }
}

interface ReportSummary {
  generated_this_month: number
  scheduled: number
}

const SPRING = { type: 'spring', stiffness: 320, damping: 28 } as const

// ─── Report type helpers ──────────────────────────────────────────────────────

function ReportTypeIcon({ type, className }: { type: ReportType; className?: string }) {
  const cls = cn('h-5 w-5', className)
  switch (type) {
    case 'visibility': return <Globe className={cls} />
    case 'seo': return <Search className={cls} />
    case 'geo': return <MapPin className={cls} />
    case 'competitive': return <Swords className={cls} />
    case 'comprehensive': return <LayoutGrid className={cls} />
  }
}

function reportTypeLabel(t: ReportType) {
  const map: Record<ReportType, string> = {
    visibility: 'Visibility',
    seo: 'SEO',
    geo: 'GEO',
    competitive: 'Competitive',
    comprehensive: 'Comprehensive',
  }
  return map[t]
}

function reportTypeColor(t: ReportType) {
  switch (t) {
    case 'visibility': return 'text-blue-600 bg-blue-50'
    case 'seo': return 'text-violet-600 bg-violet-50'
    case 'geo': return 'text-emerald-600 bg-emerald-50'
    case 'competitive': return 'text-red-600 bg-red-50'
    case 'comprehensive': return 'text-amber-600 bg-amber-50'
  }
}

// ─── Report card ──────────────────────────────────────────────────────────────

function ReportCard({
  report, slug, brandId, index, onClick,
}: {
  report: Report
  slug: string
  brandId: string
  index: number
  onClick: () => void
}) {
  const queryClient = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: () => api.post(routes.reports(slug, brandId), {
      name: report.name, type: report.type, format: report.format,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports', slug, brandId] }),
  })

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ ...SPRING, delay: index * 0.04 }}
      whileHover={report.status === 'completed' ? { y: -2, boxShadow: '0 4px 24px 0 rgba(194,65,12,0.10)' } : {}}
      className={cn(
        'rounded-xl border bg-paper p-5 cursor-pointer transition-[border-color] duration-200',
        report.status === 'completed'
          ? 'border-border hover:border-ember/40'
          : 'border-border',
      )}
      onClick={report.status === 'completed' ? onClick : undefined}
    >
      {/* Icon + name */}
      <div className="flex items-start gap-3 mb-4">
        <div className={cn('rounded-lg p-2.5 shrink-0', reportTypeColor(report.type))}>
          <ReportTypeIcon type={report.type} className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-ink leading-snug truncate">{report.name}</h3>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <Badge variant="outline" size="sm">{reportTypeLabel(report.type)}</Badge>
            <Badge variant="default" size="sm" className="font-mono text-[10px]">{report.format}</Badge>
          </div>
        </div>
      </div>

      {/* Status area */}
      <div className="space-y-2.5">
        {report.status === 'pending' && (
          <div className="flex items-center gap-2 text-sm text-dim">
            <Spinner className="h-3.5 w-3.5" />
            <span>Generating…</span>
          </div>
        )}

        {report.status === 'completed' && (
          <>
            <div className="flex items-center gap-1.5 text-success text-xs font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Ready
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-dim flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {report.completed_at ? relativeTime(report.completed_at) : '—'}
              </span>
              {report.metadata?.file_size && (
                <span className="text-xs font-mono text-dim">{report.metadata.file_size}</span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              onClick={(e) => { e.stopPropagation(); window.open(report.file_path ?? '#', '_blank') }}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </>
        )}

        {report.status === 'failed' && (
          <>
            <div className="flex items-center gap-1.5 text-danger text-xs font-medium">
              <AlertCircle className="h-3.5 w-3.5" />
              Failed
            </div>
            {report.metadata?.error && (
              <p className="text-xs text-dim leading-relaxed">{report.metadata.error}</p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              onClick={(e) => { e.stopPropagation(); retryMutation.mutate() }}
              loading={retryMutation.isPending}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ─── Report preview modal ─────────────────────────────────────────────────────

function ReportPreviewModal({
  reportId, open, onClose, slug, brandId,
}: {
  reportId: string | null
  open: boolean
  onClose: () => void
  slug: string
  brandId: string
}) {
  const [copied, setCopied] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['report-detail', reportId],
    queryFn: () => api.get<Report>(`${routes.reports(slug, brandId)}/${reportId}`),
    enabled: !!reportId && open,
  })

  const sections: ReportSection[] = data?.metadata?.sections ?? []

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin + (data?.file_path ?? ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>{data?.name ?? 'Report'}</ModalTitle>
          {data && (
            <ModalDescription>
              {reportTypeLabel(data.type)} · {data.format} · {data.completed_at ? relativeTime(data.completed_at) : ''}
            </ModalDescription>
          )}
        </ModalHeader>
        <ModalBody>
          {isLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : sections.length === 0 ? (
            <p className="text-sm text-dim text-center py-8">No sections available for preview.</p>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {sections.map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="border border-border rounded-lg p-4"
                >
                  <h4 className="text-sm font-semibold text-ink mb-1">{s.title}</h4>
                  <p className="text-xs text-dim leading-relaxed">{s.summary}</p>
                </motion.div>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={handleCopyLink} className="gap-1.5 mr-auto">
            <Share2 className="h-3.5 w-3.5" />
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {data?.file_path && (
            <Button onClick={() => window.open(data.file_path ?? '#', '_blank')} className="gap-1.5">
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── Generate Report Modal ────────────────────────────────────────────────────

function GenerateReportModal({
  open, onClose, slug, brandId,
}: {
  open: boolean; onClose: () => void; slug: string; brandId: string
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<{ name: string; type: ReportType; format: ReportFormat }>({
    name: '', type: 'comprehensive', format: 'PDF',
  })

  const mutation = useMutation({
    mutationFn: () => api.post(routes.reports(slug, brandId), form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', slug, brandId] })
      queryClient.invalidateQueries({ queryKey: ['reports-summary', slug, brandId] })
      onClose()
      setForm({ name: '', type: 'comprehensive', format: 'PDF' })
    },
  })

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Generate Report</ModalTitle>
          <ModalDescription>Configure and queue a new intelligence brief.</ModalDescription>
        </ModalHeader>
        <ModalBody className="space-y-4">
          <Input
            label="Report name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Q3 Visibility Brief"
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Type</label>
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as ReportType }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="visibility">Visibility</SelectItem>
                <SelectItem value="seo">SEO</SelectItem>
                <SelectItem value="geo">GEO</SelectItem>
                <SelectItem value="competitive">Competitive</SelectItem>
                <SelectItem value="comprehensive">Comprehensive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Format</label>
            <div className="flex gap-2">
              {(['PDF', 'HTML', 'JSON'] as ReportFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setForm((f) => ({ ...f, format: fmt }))}
                  className={cn(
                    'flex-1 h-10 rounded-md border text-sm font-mono font-medium transition-all',
                    form.format === fmt
                      ? 'border-ember bg-ember/5 text-ember'
                      : 'border-border text-dim hover:border-border-strong hover:text-ink',
                  )}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.name}>
            Generate
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const [showGenerate, setShowGenerate] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', slug, brandId],
    queryFn: () => api.get<{ reports: Report[] }>(routes.reports(slug, brandId)),
    refetchInterval: (q) => {
      const reports = (q.state.data as { reports?: Report[] } | undefined)?.reports ?? []
      return reports.some((r) => r.status === 'pending') ? 4000 : false
    },
  })

  const { data: summary } = useQuery({
    queryKey: ['reports-summary', slug, brandId],
    queryFn: () => api.get<ReportSummary>(`${routes.reports(slug, brandId)}/summary`),
  })

  const reports = data?.reports ?? []

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="flex items-start justify-between mb-6"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink flex items-center gap-2.5">
            <FileText className="h-7 w-7 text-ember" />
            Reports
          </h1>
          <p className="text-sm text-dim mt-1">Intelligence briefs &amp; exports</p>
        </div>
        <Button onClick={() => setShowGenerate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Generate Report
        </Button>
      </motion.div>

      {/* Summary bar */}
      <AnimatePresence>
        {summary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-6 bg-surface border border-border rounded-lg px-5 py-3 mb-6 text-sm text-dim"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <strong className="text-ink">{summary.generated_this_month}</strong> generated this month
            </span>
            <span className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-info" />
              <strong className="text-ink">{summary.scheduled}</strong> scheduled
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Generate your first intelligence brief to share AI visibility insights."
          action={<Button onClick={() => setShowGenerate(true)} className="gap-2"><Plus className="h-4 w-4" />Generate Report</Button>}
        />
      ) : (
        <motion.div layout className="grid grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {reports.map((r, i) => (
              <ReportCard
                key={r.id}
                report={r}
                slug={slug}
                brandId={brandId}
                index={i}
                onClick={() => setPreviewId(r.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <GenerateReportModal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        slug={slug}
        brandId={brandId}
      />
      <ReportPreviewModal
        reportId={previewId}
        open={!!previewId}
        onClose={() => setPreviewId(null)}
        slug={slug}
        brandId={brandId}
      />
    </div>
  )
}
