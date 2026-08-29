'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  RefreshCw,
  Sparkles,
  FileText,
  Check,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Progress } from '@/components/ui/progress'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { cn, scoreColor, relativeTime } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────────

type BriefStatus = 'draft' | 'generating' | 'ready' | 'published'
type Tone = 'professional' | 'conversational' | 'authoritative'

interface Brief {
  id: string
  topic: string
  target_keyword: string
  tone: Tone
  word_count: number
  status: BriefStatus
  created_at: string
  notes?: string
}

interface DraftSubScores {
  relevance: number
  readability: number
  keyword_density: number
}

interface Draft {
  content: string
  score: number
  sub_scores: DraftSubScores
}

interface DraftResponse {
  draft: Draft | null
  status: BriefStatus
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SPRING: [number, number, number, number] = [0.16, 1, 0.3, 1]

function statusVariant(s: BriefStatus): 'outline' | 'warning' | 'success' | 'info' {
  const map = { draft: 'outline', generating: 'warning', ready: 'success', published: 'info' } as const
  return map[s]
}

function statusLabel(s: BriefStatus) {
  const map = { draft: 'Draft', generating: 'Generating', ready: 'Ready', published: 'Published' }
  return map[s]
}

function subScoreLabel(key: keyof DraftSubScores) {
  const map = { relevance: 'Relevance', readability: 'Readability', keyword_density: 'Keyword Density' }
  return map[key]
}

function scoreBarColor(score: number) {
  if (score >= 75) return 'bg-success'
  if (score >= 50) return 'bg-warning'
  return 'bg-danger'
}

// ─── Pulsing Dots ──────────────────────────────────────────────────────────────

function PulsingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block w-1.5 h-1.5 rounded-full bg-ember"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

// ─── New Brief Modal ───────────────────────────────────────────────────────────

interface BriefFormState {
  topic: string
  target_keyword: string
  tone: Tone
  word_count: string
  notes: string
}

function NewBriefModal({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<Brief, 'id' | 'created_at' | 'status'>) => void
  loading: boolean
}) {
  const [form, setForm] = useState<BriefFormState>({
    topic: '',
    target_keyword: '',
    tone: 'professional',
    word_count: '1000',
    notes: '',
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.topic.trim() || !form.target_keyword.trim()) return
    onSubmit({
      topic: form.topic.trim(),
      target_keyword: form.target_keyword.trim(),
      tone: form.tone,
      word_count: parseInt(form.word_count) || 1000,
      notes: form.notes.trim() || undefined,
    })
  }

  function patch(key: keyof BriefFormState, val: string) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent className="max-w-lg">
        <ModalHeader>
          <ModalTitle>New Content Brief</ModalTitle>
        </ModalHeader>
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            <Input
              label="Topic"
              placeholder="e.g. How AI is transforming B2B sales"
              value={form.topic}
              onChange={(e) => patch('topic', e.target.value)}
              required
            />
            <Input
              label="Target Keyword"
              placeholder="e.g. AI B2B sales software"
              value={form.target_keyword}
              onChange={(e) => patch('target_keyword', e.target.value)}
              required
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Tone</label>
              <Select value={form.tone} onValueChange={(v) => patch('tone', v as Tone)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="conversational">Conversational</SelectItem>
                  <SelectItem value="authoritative">Authoritative</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              label="Target Word Count"
              type="number"
              min={200}
              max={10000}
              step={100}
              value={form.word_count}
              onChange={(e) => patch('word_count', e.target.value)}
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => patch('notes', e.target.value)}
                rows={3}
                placeholder="Additional context, competitor references, angle..."
                className={cn(
                  'w-full rounded-md border border-border bg-paper px-3 py-2 text-sm font-sans text-ink placeholder:text-dim resize-none',
                  'transition-[border-color,box-shadow] duration-[150ms]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:border-ember',
                )}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>
              <Plus className="h-4 w-4" />
              Create Brief
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}

// ─── Brief List Item ───────────────────────────────────────────────────────────

function BriefItem({
  brief,
  selected,
  onClick,
}: {
  brief: Brief
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-4 rounded-lg border transition-all hover:shadow-sm',
        selected
          ? 'border-ember bg-ember/5 ring-1 ring-ember/30'
          : 'border-border bg-paper hover:bg-surface',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-medium text-ink line-clamp-2 leading-snug flex-1">{brief.topic}</p>
        <Badge variant={statusVariant(brief.status)} size="sm" dot>{statusLabel(brief.status)}</Badge>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono text-dim">{brief.target_keyword}</span>
        <span className="text-xs text-dim">·</span>
        <span className="text-xs text-dim capitalize">{brief.tone}</span>
        <span className="text-xs text-dim">·</span>
        <span className="text-xs text-dim">{relativeTime(brief.created_at)}</span>
      </div>
    </button>
  )
}

// ─── Score Bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-dim font-sans">{label}</span>
        <span className={cn('text-xs font-mono font-semibold', scoreColor(value))}>{value}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface border border-border overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full', scoreBarColor(value))}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ─── Draft Editor ──────────────────────────────────────────────────────────────

function DraftEditor({
  brief,
  slug,
  brandId,
}: {
  brief: Brief
  slug: string
  brandId: string
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [briefOpen, setBriefOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const draftQuery = useQuery({
    queryKey: ['draft', slug, brandId, brief.id],
    queryFn: () =>
      api.get<DraftResponse>(`${routes.contentGen(slug, brandId)}/${brief.id}/draft`),
    enabled: brief.status === 'ready' || brief.status === 'published' || brief.status === 'generating',
    refetchInterval: brief.status === 'generating' ? 3000 : false,
  })

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post(`${routes.contentGen(slug, brandId)}/${brief.id}/generate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefs', slug, brandId] })
      qc.invalidateQueries({ queryKey: ['draft', slug, brandId, brief.id] })
      toast({ title: 'Generation started', description: 'Your draft is being written.', variant: 'info' })
    },
    onError: () => {
      toast({ title: 'Failed to start generation', variant: 'error' })
    },
  })

  const draft = draftQuery.data?.draft
  const status = draftQuery.data?.status ?? brief.status
  const isGenerating = status === 'generating'
  const hasDraft = status === 'ready' || status === 'published'

  function copyDraft() {
    if (!draft?.content) return
    navigator.clipboard.writeText(draft.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function exportDraft() {
    if (!draft?.content) return
    const blob = new Blob([draft.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${brief.topic.slice(0, 40).replace(/\s+/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Brief header (collapsible) */}
      <div className="border-b border-border">
        <button
          onClick={() => setBriefOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-surface transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="h-4 w-4 text-dim shrink-0" />
            <p className="text-sm font-medium text-ink truncate">{brief.topic}</p>
            <Badge variant={statusVariant(brief.status)} size="sm" dot>{statusLabel(brief.status)}</Badge>
          </div>
          {briefOpen ? <ChevronUp className="h-4 w-4 text-dim shrink-0" /> : <ChevronDown className="h-4 w-4 text-dim shrink-0" />}
        </button>
        <AnimatePresence>
          {briefOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: SPRING }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-xs text-dim uppercase tracking-wide font-semibold">Keyword</span>
                  <p className="font-mono text-xs text-ink mt-0.5">{brief.target_keyword}</p>
                </div>
                <div>
                  <span className="text-xs text-dim uppercase tracking-wide font-semibold">Tone</span>
                  <p className="text-xs text-ink capitalize mt-0.5">{brief.tone}</p>
                </div>
                <div>
                  <span className="text-xs text-dim uppercase tracking-wide font-semibold">Word Count</span>
                  <p className="text-xs text-ink mt-0.5">{brief.word_count.toLocaleString()}</p>
                </div>
                {brief.notes && (
                  <div className="col-span-2">
                    <span className="text-xs text-dim uppercase tracking-wide font-semibold">Notes</span>
                    <p className="text-xs text-ink mt-0.5 leading-relaxed">{brief.notes}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Draft body */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* No draft yet */}
          {!isGenerating && !hasDraft && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: SPRING }}
              className="flex flex-col items-center justify-center h-full py-24 px-6 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-ember/10 flex items-center justify-center mb-4">
                <Sparkles className="h-7 w-7 text-ember" />
              </div>
              <p className="font-display text-lg font-semibold text-ink mb-1">Ready to generate</p>
              <p className="text-sm text-dim max-w-xs leading-relaxed mb-6">
                The AI pipeline will write a full draft based on your brief, optimized for <span className="font-mono text-ink">{brief.target_keyword}</span>.
              </p>
              <Button onClick={() => generateMutation.mutate()} loading={generateMutation.isPending} size="lg">
                <Sparkles className="h-4 w-4" />
                Generate Draft
              </Button>
            </motion.div>
          )}

          {/* Generating */}
          {isGenerating && (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center justify-center h-full py-24 px-6 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-ember/10 flex items-center justify-center mb-6">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                >
                  <Sparkles className="h-7 w-7 text-ember" />
                </motion.div>
              </div>
              <p className="font-display text-lg font-semibold text-ink mb-1 flex items-center gap-0">
                Generating
                <PulsingDots />
              </p>
              <p className="text-sm text-dim mb-6">Writing your draft — this usually takes 30–60 seconds.</p>
              <div className="w-64">
                <motion.div
                  className="h-1.5 rounded-full bg-ember/20 overflow-hidden"
                >
                  <motion.div
                    className="h-full bg-ember rounded-full"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    style={{ width: '50%' }}
                  />
                </motion.div>
              </div>
            </motion.div>
          )}

          {/* Draft ready */}
          {hasDraft && draft && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: SPRING }}
              className="p-5 space-y-5"
            >
              {/* Score section */}
              <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-dim uppercase tracking-wide font-semibold">Draft Score</p>
                  <span className={cn('text-2xl font-display font-semibold', scoreColor(draft.score))}>
                    {draft.score}
                  </span>
                </div>
                <div className="space-y-2">
                  {(Object.keys(draft.sub_scores) as (keyof DraftSubScores)[]).map((key) => (
                    <ScoreBar key={key} label={subScoreLabel(key)} value={draft.sub_scores[key]} />
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => generateMutation.mutate()}
                  loading={generateMutation.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
                <Button variant="outline" size="sm" onClick={copyDraft}>
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
                <Button variant="outline" size="sm" onClick={exportDraft}>
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </div>

              {/* Draft content */}
              <div
                className={cn(
                  'rounded-lg border border-border bg-paper p-5',
                  'font-serif text-ink leading-relaxed text-sm',
                  'whitespace-pre-wrap break-words',
                  'max-h-[480px] overflow-y-auto',
                )}
              >
                {draft.content}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ContentGenerationPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['briefs', slug, brandId],
    queryFn: () =>
      api.get<{ briefs: Brief[] }>(routes.contentGen(slug, brandId)),
  })

  const createMutation = useMutation({
    mutationFn: (body: Omit<Brief, 'id' | 'created_at' | 'status'>) =>
      api.post<Brief>(routes.contentGen(slug, brandId), body),
    onSuccess: (newBrief) => {
      qc.invalidateQueries({ queryKey: ['briefs', slug, brandId] })
      setCreateOpen(false)
      setSelectedId(newBrief.id)
      toast({ title: 'Brief created', variant: 'success' })
    },
    onError: () => {
      toast({ title: 'Failed to create brief', variant: 'error' })
    },
  })

  const briefs = data?.briefs ?? []
  const selected = briefs.find((b) => b.id === selectedId) ?? null

  return (
    <>
      <NewBriefModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createMutation.mutate(data)}
        loading={createMutation.isPending}
      />

      <div className="max-w-7xl mx-auto space-y-5">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: SPRING }}
        >
          <h1 className="font-display text-3xl font-semibold text-ink">Content Generation</h1>
          <p className="text-sm text-dim mt-1">AI-powered brief-to-draft pipeline</p>
        </motion.div>

        {/* Two-panel layout */}
        <div className="flex gap-0 rounded-xl border border-border bg-paper overflow-hidden shadow-sm" style={{ minHeight: 600 }}>
          {/* Left: Brief List (40%) */}
          <div className="w-[40%] shrink-0 flex flex-col border-r border-border">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
              <p className="text-xs font-semibold text-dim uppercase tracking-wide">Briefs</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New Brief
              </Button>
            </div>

            {/* Brief list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {isLoading && (
                <>
                  <SkeletonCard className="h-20" />
                  <SkeletonCard className="h-20" />
                  <SkeletonCard className="h-20" />
                </>
              )}

              {!isLoading && briefs.length === 0 && (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No briefs yet"
                  description="Create a brief to start generating AI content."
                  action={
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      New Brief
                    </Button>
                  }
                />
              )}

              <AnimatePresence initial={false}>
                {briefs.map((brief, i) => (
                  <motion.div
                    key={brief.id}
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.3, ease: SPRING, delay: i * 0.04 }}
                  >
                    <BriefItem
                      brief={brief}
                      selected={brief.id === selectedId}
                      onClick={() => setSelectedId(brief.id === selectedId ? null : brief.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Right: Draft Editor (60%) */}
          <div className="flex-1 min-w-0 relative overflow-hidden">
            <AnimatePresence mode="wait">
              {selected ? (
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.35, ease: SPRING }}
                  className="absolute inset-0 flex flex-col"
                >
                  <DraftEditor brief={selected} slug={slug} brandId={brandId} />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 flex flex-col items-center justify-center text-center px-8"
                >
                  <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center mb-4">
                    <Sparkles className="h-6 w-6 text-dim" />
                  </div>
                  <p className="font-display text-base font-semibold text-ink mb-1">Select a brief</p>
                  <p className="text-sm text-dim max-w-xs leading-relaxed">
                    Choose a brief from the left to view or generate its draft.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </>
  )
}
