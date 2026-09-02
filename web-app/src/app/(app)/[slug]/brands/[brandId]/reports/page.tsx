'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, Globe, Users, Search, FileText,
  Plus, Download, RefreshCw, Share2, AlertCircle,
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
import { PageHeader } from '@/components/layout/page-header'
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

// ─── Report type config ───────────────────────────────────────────────────────

interface ReportTypeDef {
  type: ReportType
  title: string
  description: string
  icon: React.ElementType
  iconBg: string
  iconColor: string
}

const REPORT_TYPE_DEFS: ReportTypeDef[] = [
  {
    type: 'visibility',
    title: 'Visibility Report',
    description: 'Track how your brand appears across AI models and generative search surfaces.',
    icon: Eye,
    iconBg: 'bg-info/10',
    iconColor: 'text-info',
  },
  {
    type: 'geo',
    title: 'GEO Performance',
    description: 'Measure your generative engine optimization score across query categories.',
    icon: Globe,
    iconBg: 'bg-ember/10',
    iconColor: 'text-ember',
  },
  {
    type: 'competitive',
    title: 'Competitive Intel',
    description: 'Compare AI recommendations for your brand vs. top competitors.',
    icon: Users,
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-600',
  },
  {
    type: 'seo',
    title: 'SEO Analysis',
    description: 'Keyword ranking trends and content gap opportunities in organic search.',
    icon: Search,
    iconBg: 'bg-success/10',
    iconColor: 'text-success',
  },
]

function reportTypeLabel(t: ReportType): string {
  const map: Record<ReportType, string> = {
    visibility: 'Visibility',
    seo: 'SEO',
    geo: 'GEO',
    competitive: 'Competitive',
    comprehensive: 'Comprehensive',
  }
  return map[t]
}

function statusBadgeVariant(s: ReportStatus): 'success' | 'danger' | 'warning' {
  const map: Record<ReportStatus, 'success' | 'danger' | 'warning'> = {
    completed: 'success',
    failed: 'danger',
    pending: 'warning',
  }
  return map[s]
}

function statusLabel(s: ReportStatus): string {
  const map: Record<ReportStatus, string> = { completed: 'Ready', failed: 'Failed', pending: 'Generating' }
  return map[s]
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
  open, onClose, slug, brandId, defaultType,
}: {
  open: boolean; onClose: () => void; slug: string; brandId: string; defaultType?: ReportType
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<{ name: string; type: ReportType; format: ReportFormat }>({
    name: '', type: defaultType ?? 'comprehensive', format: 'PDF',
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
                      ? 'border-[var(--ember)] bg-ember/5 text-ember'
                      : 'border-border text-dim hover:text-ink',
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
  const [generateType, setGenerateType] = useState<ReportType | undefined>()
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

  const queryClient = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: (report: Report) => api.post(routes.reports(slug, brandId), {
      name: report.name, type: report.type, format: report.format,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports', slug, brandId] }),
  })

  const reports = data?.reports ?? []

  function openGenerate(type?: ReportType) {
    setGenerateType(type)
    setShowGenerate(true)
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <PageHeader
          title="Reports"
          subtitle="Intelligence briefs & exports"
          actions={
            <Button onClick={() => openGenerate()} className="gap-2">
              <Plus className="h-4 w-4" />
              Generate Report
            </Button>
          }
        />
      </div>

      {/* Report type cards 2×2 grid */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING, delay: 0.05 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8"
      >
        {REPORT_TYPE_DEFS.map((def) => {
          const Icon = def.icon
          return (
            <div
              key={def.type}
              className="rounded-xl border border-border bg-surface-raised p-6 flex gap-4"
            >
              <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center shrink-0', def.iconBg)}>
                <Icon className={cn('h-5 w-5', def.iconColor)} />
              </div>
              <div className="flex flex-col min-w-0">
                <h3 className="font-display text-lg text-ink">{def.title}</h3>
                <p className="text-sm text-dim mt-1 leading-relaxed flex-1">{def.description}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-fit"
                  onClick={() => openGenerate(def.type)}
                >
                  Generate →
                </Button>
              </div>
            </div>
          )
        })}
      </motion.div>

      {/* Generated Reports */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING, delay: 0.1 }}
      >
        <h2 className="font-display text-xl text-ink mb-4">Generated Reports</h2>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} className="h-14" />)}
          </div>
        ) : reports.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No reports yet"
            description="Generate your first intelligence brief to share AI visibility insights."
            action={<Button onClick={() => openGenerate()} className="gap-2"><Plus className="h-4 w-4" />Generate Report</Button>}
          />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Table head */}
            <div className="grid grid-cols-[1fr_120px_140px_120px_120px] gap-3 px-4 py-2.5 bg-surface border-b border-border">
              {['Name', 'Type', 'Date', 'Status', ''].map((h, i) => (
                <span key={i} className="text-xs font-semibold text-dim uppercase tracking-wide">{h}</span>
              ))}
            </div>
            <AnimatePresence initial={false}>
              {reports.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, ...SPRING }}
                  className="grid grid-cols-[1fr_120px_140px_120px_120px] gap-3 px-4 py-3 items-center border-b border-border last:border-0 hover:bg-surface/50 transition-colors"
                >
                  <span className="text-sm font-medium text-ink truncate">{r.name}</span>
                  <Badge variant="outline" size="sm">{reportTypeLabel(r.type)}</Badge>
                  <span className="text-xs text-dim flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {r.completed_at ? relativeTime(r.completed_at) : '—'}
                  </span>
                  <div>
                    {r.status === 'pending' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                        <Spinner className="h-3 w-3" />
                        Generating
                      </span>
                    ) : r.status === 'failed' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-danger">
                        <AlertCircle className="h-3 w-3" />
                        Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        Ready
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {r.status === 'completed' && r.file_path && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(r.file_path ?? '#', '_blank')}
                        className="gap-1 text-xs"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download PDF
                      </Button>
                    )}
                    {r.status === 'failed' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => retryMutation.mutate(r)}
                        loading={retryMutation.isPending}
                        className="gap-1 text-xs"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      <GenerateReportModal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        slug={slug}
        brandId={brandId}
        defaultType={generateType}
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
