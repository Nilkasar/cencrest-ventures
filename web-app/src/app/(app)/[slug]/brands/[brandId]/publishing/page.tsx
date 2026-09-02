'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import {
  Plus,
  CheckCircle2,
  XCircle,
  Calendar,
  ExternalLink,
  Clock,
  FileText,
  Send,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, relativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SkeletonCard } from '@/components/ui/skeleton'
import {
  Modal,
  ModalTrigger,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalClose,
} from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { SPRING_CURVE } from '@/lib/motion'

// ─── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = 'draft' | 'pending_approval' | 'scheduled' | 'published'
type ContentType = 'blog_post' | 'social' | 'email' | 'landing_page' | 'video' | 'press_release'

interface Job {
  id: string
  title: string
  content_type: ContentType
  status: JobStatus
  scheduled_at?: string
  created_at: string
  created_by: { id: string; name: string; avatar?: string }
  content_url?: string
  notes?: string
  rejection_reason?: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────


const COLUMNS: { id: JobStatus; label: string; color: string; accent: string }[] = [
  { id: 'draft', label: 'Draft', color: 'text-dim', accent: 'bg-border' },
  { id: 'pending_approval', label: 'Pending Approval', color: 'text-warning', accent: 'bg-warning-muted' },
  { id: 'scheduled', label: 'Scheduled', color: 'text-info', accent: 'bg-info-muted' },
  { id: 'published', label: 'Published', color: 'text-success', accent: 'bg-success-muted' },
]

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  blog_post: 'Blog Post',
  social: 'Social',
  email: 'Email',
  landing_page: 'Landing Page',
  video: 'Video',
  press_release: 'Press Release',
}

const CONTENT_TYPE_VARIANT: Record<ContentType, 'outline' | 'info' | 'warning' | 'ember' | 'default' | 'success'> = {
  blog_post: 'outline',
  social: 'info',
  email: 'warning',
  landing_page: 'ember',
  video: 'default',
  press_release: 'success',
}

// ─── Job Card ──────────────────────────────────────────────────────────────────

function JobCard({
  job,
  onApprove,
  onReject,
  onSchedule,
  onSubmit,
  approving,
  submitting,
}: {
  job: Job
  onApprove?: () => void
  onReject?: (reason: string) => void
  onSchedule?: (at: string) => void
  onSubmit?: () => void
  approving?: boolean
  submitting?: boolean
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')

  return (
    <motion.div
      layout
      layoutId={`job-${job.id}`}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      transition={{ duration: 0.32, ease: SPRING_CURVE }}
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(22,20,15,0.10)', scale: 1.015 }}
      className="bg-paper border border-border rounded-lg p-5 cursor-default select-none"
    >
      {/* Title & type */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-ink leading-snug flex-1">{job.title}</p>
        <Badge variant={CONTENT_TYPE_VARIANT[job.content_type]} size="sm">
          {CONTENT_TYPE_LABELS[job.content_type]}
        </Badge>
      </div>

      {/* Scheduled at */}
      {job.scheduled_at && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-dim">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>{new Date(job.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}

      {/* Rejection reason */}
      {job.rejection_reason && (
        <div className="mb-3 px-2.5 py-2 bg-danger-muted rounded-md">
          <p className="text-xs text-danger leading-snug">{job.rejection_reason}</p>
        </div>
      )}

      {/* Author */}
      <div className="flex items-center gap-2 mb-4">
        <Avatar src={job.created_by.avatar} name={job.created_by.name} size="sm" />
        <span className="text-xs text-dim">{job.created_by.name}</span>
        <span className="ml-auto text-xs text-dim">{relativeTime(job.created_at)}</span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {/* Draft → Submit */}
        {job.status === 'draft' && onSubmit && (
          <Button size="sm" onClick={onSubmit} loading={submitting} className="w-full">
            <Send className="h-3.5 w-3.5" />
            Submit for Approval
          </Button>
        )}

        {/* Pending Approval → Approve / Reject */}
        {job.status === 'pending_approval' && (
          <>
            <Button size="sm" variant="success" onClick={onApprove} loading={approving} className="flex-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Modal open={rejectOpen} onOpenChange={setRejectOpen}>
              <ModalTrigger asChild>
                <Button size="sm" variant="danger" className="flex-1">
                  <XCircle className="h-3.5 w-3.5" />
                  Reject
                </Button>
              </ModalTrigger>
              <ModalContent>
                <ModalHeader>
                  <ModalTitle>Reject Job</ModalTitle>
                  <ModalDescription>Provide a reason so the author can revise.</ModalDescription>
                </ModalHeader>
                <ModalBody>
                  <textarea
                    className="w-full h-24 resize-none rounded-md border border-border bg-paper px-3 py-2 text-sm font-sans text-ink placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-ember"
                    placeholder="Rejection reason…"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                </ModalBody>
                <ModalFooter>
                  <ModalClose asChild>
                    <Button variant="outline" size="sm">Cancel</Button>
                  </ModalClose>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!rejectReason.trim()}
                    onClick={() => {
                      onReject?.(rejectReason.trim())
                      setRejectOpen(false)
                      setRejectReason('')
                    }}
                  >
                    Confirm Reject
                  </Button>
                </ModalFooter>
              </ModalContent>
            </Modal>
          </>
        )}

        {/* Scheduled → Reschedule */}
        {job.status === 'scheduled' && (
          <Modal open={scheduleOpen} onOpenChange={setScheduleOpen}>
            <ModalTrigger asChild>
              <Button size="sm" variant="outline" className="w-full">
                <Clock className="h-3.5 w-3.5" />
                Reschedule
              </Button>
            </ModalTrigger>
            <ModalContent>
              <ModalHeader>
                <ModalTitle>Reschedule Job</ModalTitle>
                <ModalDescription>Choose a new publish time.</ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Input
                  label="Scheduled at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
              </ModalBody>
              <ModalFooter>
                <ModalClose asChild>
                  <Button variant="outline" size="sm">Cancel</Button>
                </ModalClose>
                <Button
                  size="sm"
                  disabled={!scheduleAt}
                  onClick={() => {
                    onSchedule?.(new Date(scheduleAt).toISOString())
                    setScheduleOpen(false)
                    setScheduleAt('')
                  }}
                >
                  Reschedule
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}

        {/* Published → View */}
        {job.status === 'published' && job.content_url && (
          <a
            href={job.content_url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium rounded-md border border-border',
              'text-ink hover:bg-surface transition-colors w-full justify-center'
            )}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View
          </a>
        )}
      </div>
    </motion.div>
  )
}

// ─── Column ────────────────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  jobs,
  onApprove,
  onReject,
  onSchedule,
  onSubmit,
  approvingId,
  submittingId,
}: {
  column: (typeof COLUMNS)[number]
  jobs: Job[]
  onApprove: (id: string) => void
  onReject: (id: string, reason: string) => void
  onSchedule: (id: string, at: string) => void
  onSubmit: (id: string) => void
  approvingId: string | null
  submittingId: string | null
}) {
  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={cn('text-sm font-semibold font-sans', column.color)}>{column.label}</span>
        <span className={cn('text-xs font-mono font-semibold px-1.5 py-0.5 rounded-full', column.accent, column.color)}>
          {jobs.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-4" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        <AnimatePresence mode="popLayout">
          {jobs.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center h-32 rounded-lg border border-dashed border-border"
            >
              <p className="text-xs text-dim">No items</p>
            </motion.div>
          ) : (
            jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onApprove={() => onApprove(job.id)}
                onReject={(reason) => onReject(job.id, reason)}
                onSchedule={(at) => onSchedule(job.id, at)}
                onSubmit={() => onSubmit(job.id)}
                approving={approvingId === job.id}
                submitting={submittingId === job.id}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── New Job Modal ─────────────────────────────────────────────────────────────

function NewJobModal({
  open,
  onOpenChange,
  onCreate,
  creating,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreate: (data: { title: string; content_type: string; content_url: string; notes: string }) => void
  creating: boolean
}) {
  const [title, setTitle] = useState('')
  const [contentType, setContentType] = useState<ContentType>('blog_post')
  const [contentUrl, setContentUrl] = useState('')
  const [notes, setNotes] = useState('')

  const reset = () => {
    setTitle('')
    setContentType('blog_post')
    setContentUrl('')
    setNotes('')
  }

  return (
    <Modal open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>New Publishing Job</ModalTitle>
          <ModalDescription>Add a new piece of content to the publishing pipeline.</ModalDescription>
        </ModalHeader>
        <ModalBody className="space-y-4">
          <Input
            label="Title"
            placeholder="e.g. Why AI is reshaping B2B marketing"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Content Type</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ContentType)}
              className="h-10 w-full rounded-md border border-border bg-paper px-3 text-sm font-sans text-ink focus:outline-none focus:ring-2 focus:ring-ember"
            >
              {(Object.keys(CONTENT_TYPE_LABELS) as ContentType[]).map((ct) => (
                <option key={ct} value={ct}>{CONTENT_TYPE_LABELS[ct]}</option>
              ))}
            </select>
          </div>
          <Input
            label="Content URL"
            placeholder="https://docs.google.com/…"
            value={contentUrl}
            onChange={(e) => setContentUrl(e.target.value)}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Notes</label>
            <textarea
              className="w-full h-20 resize-none rounded-md border border-border bg-paper px-3 py-2 text-sm font-sans text-ink placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-ember"
              placeholder="Any notes for reviewers…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalClose asChild>
            <Button variant="outline" size="sm">Cancel</Button>
          </ModalClose>
          <Button
            size="sm"
            disabled={!title.trim()}
            loading={creating}
            onClick={() => onCreate({ title, content_type: contentType, content_url: contentUrl, notes })}
          >
            <FileText className="h-3.5 w-3.5" />
            Create Job
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PublishingPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()
  const base = `/api/orgs/${slug}/brands/${brandId}/publishing`

  const [newJobOpen, setNewJobOpen] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['publishing', slug, brandId],
    queryFn: () => api.get<{ jobs: Job[] }>(base),
  })

  const jobs: Job[] = (data as { jobs?: Job[] } | undefined)?.jobs ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['publishing', slug, brandId] })

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<Job>(base, body),
    onSuccess: () => { invalidate(); setNewJobOpen(false) },
  })

  const approveMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`${base}/${jobId}/approve`),
    onMutate: (jobId) => setApprovingId(jobId),
    onSettled: () => { setApprovingId(null); invalidate() },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason: string }) =>
      api.post(`${base}/${jobId}/reject`, { reason }),
    onSettled: () => invalidate(),
  })

  const scheduleMutation = useMutation({
    mutationFn: ({ jobId, scheduled_at }: { jobId: string; scheduled_at: string }) =>
      api.post(`${base}/${jobId}/schedule`, { scheduled_at }),
    onSettled: () => invalidate(),
  })

  const submitMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`${base}/${jobId}/approve`),
    onMutate: (jobId) => setSubmittingId(jobId),
    onSettled: () => { setSubmittingId(null); invalidate() },
  })

  // Summary bar metrics
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const publishedThisWeek = jobs.filter(
    (j) => j.status === 'published' && j.scheduled_at && new Date(j.scheduled_at) >= weekAgo
  ).length
  const pending = jobs.filter((j) => j.status === 'pending_approval').length
  const scheduled = jobs.filter((j) => j.status === 'scheduled').length

  const byStatus = (status: JobStatus) => jobs.filter((j) => j.status === status)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 shrink-0">
        <PageHeader
          title="Publishing Queue"
          subtitle="Approval & scheduling pipeline"
          actions={
            <Button
              onClick={() => setNewJobOpen(true)}
              className="bg-ember text-white hover:bg-ember/90"
            >
              <Plus className="h-4 w-4" />
              Schedule Post
            </Button>
          }
        />
      </div>

      {/* Summary bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: SPRING_CURVE, delay: 0.05 }}
        className="flex items-center gap-6 mb-6 px-4 py-3 bg-surface border border-border rounded-lg shrink-0"
      >
        <div className="flex items-center gap-2">
          <span className="font-display text-2xl font-semibold text-ink">{publishedThisWeek}</span>
          <span className="text-sm text-dim">published this week</span>
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="flex items-center gap-2">
          <span className="font-display text-2xl font-semibold text-warning">{pending}</span>
          <span className="text-sm text-dim">pending review</span>
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="flex items-center gap-2">
          <span className="font-display text-2xl font-semibold text-info">{scheduled}</span>
          <span className="text-sm text-dim">scheduled</span>
        </div>
      </motion.div>

      {/* Kanban board */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <LayoutGroup>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: SPRING_CURVE, delay: 0.1 }}
            className="grid grid-cols-4 gap-4 flex-1 min-h-0"
          >
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                column={col}
                jobs={byStatus(col.id)}
                onApprove={(id) => approveMutation.mutate(id)}
                onReject={(id, reason) => rejectMutation.mutate({ jobId: id, reason })}
                onSchedule={(id, at) => scheduleMutation.mutate({ jobId: id, scheduled_at: at })}
                onSubmit={(id) => submitMutation.mutate(id)}
                approvingId={approvingId}
                submittingId={submittingId}
              />
            ))}
          </motion.div>
        </LayoutGroup>
      )}

      {/* New job modal */}
      <NewJobModal
        open={newJobOpen}
        onOpenChange={setNewJobOpen}
        onCreate={(data) => createMutation.mutate(data)}
        creating={createMutation.isPending}
      />
    </div>
  )
}
