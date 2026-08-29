'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Copy,
  RefreshCw,
  Sparkles,
  FileText,
  Check,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { cn, relativeTime } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────────

type BriefStatus = 'draft' | 'generating' | 'ready' | 'published'
type Tone = 'professional' | 'conversational' | 'authoritative'
type ContentTypeOption = 'blog' | 'whitepaper' | 'case_study' | 'video'

interface Brief {
  id: string
  topic: string
  target_keyword: string
  tone: Tone
  word_count: number
  status: BriefStatus
  created_at: string
  notes?: string
  content_type?: ContentTypeOption
  target_audience?: string
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

function typeLabel(t: ContentTypeOption): string {
  const map: Record<ContentTypeOption, string> = {
    blog: 'Blog',
    whitepaper: 'Whitepaper',
    case_study: 'Case Study',
    video: 'Video',
  }
  return map[t] ?? t
}

// ─── Generation Form ───────────────────────────────────────────────────────────

interface GenerateFormState {
  topic: string
  content_type: ContentTypeOption
  tone: Tone
  target_audience: string
  target_keyword: string
  word_count: string
}

function GenerationForm({
  onGenerate,
  generating,
}: {
  onGenerate: (form: GenerateFormState) => void
  generating: boolean
}) {
  const [form, setForm] = useState<GenerateFormState>({
    topic: '',
    content_type: 'blog',
    tone: 'professional',
    target_audience: '',
    target_keyword: '',
    word_count: '1000',
  })

  function patch<K extends keyof GenerateFormState>(key: K, val: GenerateFormState[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.topic.trim()) return
    onGenerate(form)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 space-y-4"
    >
      {/* Topic */}
      <Input
        label="Topic"
        placeholder="What topic do you want to cover?"
        value={form.topic}
        onChange={(e) => patch('topic', e.target.value)}
        className="text-base h-12"
        required
      />

      {/* Content Type + Tone row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)] font-sans">Content Type</label>
          <Select value={form.content_type} onValueChange={(v) => patch('content_type', v as ContentTypeOption)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blog">Blog Post</SelectItem>
              <SelectItem value="whitepaper">Whitepaper</SelectItem>
              <SelectItem value="case_study">Case Study</SelectItem>
              <SelectItem value="video">Video Script</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)] font-sans">Tone</label>
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
      </div>

      {/* Target Audience */}
      <Input
        label="Target Audience"
        placeholder="e.g. B2B SaaS founders, marketing managers"
        value={form.target_audience}
        onChange={(e) => patch('target_audience', e.target.value)}
      />

      {/* Generate button */}
      <Button
        type="submit"
        className="w-full h-12 text-base"
        disabled={!form.topic.trim() || generating}
      >
        {generating ? (
          <>
            <Spinner />
            Generating…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Generate Content
          </>
        )}
      </Button>
    </form>
  )
}

// ─── Generated Result Card ─────────────────────────────────────────────────────

function GeneratedResultCard({
  draft,
  onRegenerate,
  onSave,
  regenerating,
}: {
  draft: Draft
  onRegenerate: () => void
  onSave: () => void
  regenerating: boolean
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(draft.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: SPRING }}
      className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 space-y-4"
    >
      {/* Heading + copy */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg text-[var(--ink)]">Generated Content</h2>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--paper)] p-4 font-serif text-sm text-[var(--ink)] leading-relaxed whitespace-pre-wrap break-words">
        {draft.content}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={onSave} className="flex-1">
          Save to Library
        </Button>
        <Button variant="outline" onClick={onRegenerate} loading={regenerating}>
          <RefreshCw className="h-4 w-4" />
          Regenerate
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Recent Generations List ───────────────────────────────────────────────────

function RecentGenerations({ briefs }: { briefs: Brief[] }) {
  if (briefs.length === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-6">
      <h2 className="font-display text-lg text-[var(--ink)] mb-4">Recent Generations</h2>
      <div className="space-y-3">
        {briefs.slice(0, 8).map((brief) => (
          <div
            key={brief.id}
            className="flex items-center gap-3 py-2 border-b border-[var(--border)] last:border-0"
          >
            <FileText className="h-4 w-4 text-[var(--dim)] shrink-0" />
            <p className="text-sm text-[var(--ink)] flex-1 line-clamp-1">{brief.topic}</p>
            {brief.content_type && (
              <Badge variant="outline" size="sm">{typeLabel(brief.content_type as ContentTypeOption)}</Badge>
            )}
            <span className="text-xs text-[var(--dim)] shrink-0">{relativeTime(brief.created_at)}</span>
            <Badge variant={statusVariant(brief.status)} size="sm">{statusLabel(brief.status)}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ContentGenerationPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [currentBriefId, setCurrentBriefId] = useState<string | null>(null)
  const [currentDraft, setCurrentDraft] = useState<Draft | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['briefs', slug, brandId],
    queryFn: () => api.get<{ briefs: Brief[] }>(routes.contentGen(slug, brandId)),
  })

  const createMutation = useMutation({
    mutationFn: (body: Omit<Brief, 'id' | 'created_at' | 'status'>) =>
      api.post<Brief>(routes.contentGen(slug, brandId), body),
    onSuccess: (newBrief) => {
      qc.invalidateQueries({ queryKey: ['briefs', slug, brandId] })
      setCurrentBriefId(newBrief.id)
      generateMutation.mutate(newBrief.id)
    },
    onError: () => {
      toast({ title: 'Failed to create brief', variant: 'error' })
    },
  })

  const generateMutation = useMutation({
    mutationFn: (briefId: string) =>
      api.post<DraftResponse>(`${routes.contentGen(slug, brandId)}/${briefId}/generate`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['briefs', slug, brandId] })
      if (res?.draft) setCurrentDraft(res.draft)
      else toast({ title: 'Generation started — check back shortly.', variant: 'info' })
    },
    onError: () => {
      toast({ title: 'Failed to generate content', variant: 'error' })
    },
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      currentBriefId
        ? api.post(`${routes.contentGen(slug, brandId)}/${currentBriefId}/publish`)
        : Promise.reject(new Error('No brief')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefs', slug, brandId] })
      toast({ title: 'Saved to library', variant: 'success' })
      setCurrentDraft(null)
      setCurrentBriefId(null)
    },
    onError: () => {
      toast({ title: 'Failed to save', variant: 'error' })
    },
  })

  function handleGenerate(form: { topic: string; content_type: ContentTypeOption; tone: Tone; target_audience: string; target_keyword: string; word_count: string }) {
    setCurrentDraft(null)
    createMutation.mutate({
      topic: form.topic,
      target_keyword: form.target_keyword || form.topic,
      tone: form.tone,
      word_count: parseInt(form.word_count) || 1000,
      content_type: form.content_type,
      target_audience: form.target_audience || undefined,
    })
  }

  const briefs = data?.briefs ?? []
  const isGenerating = createMutation.isPending || generateMutation.isPending

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
      >
        <h1 className="font-display text-3xl font-semibold text-[var(--ink)]">Content Generation</h1>
        <p className="text-sm text-[var(--dim)] mt-1">AI-optimized content for recommendation engines</p>
      </motion.div>

      {/* Generation form */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING, delay: 0.05 }}
      >
        <GenerationForm onGenerate={handleGenerate} generating={isGenerating} />
      </motion.div>

      {/* Generated result */}
      <AnimatePresence mode="wait">
        {currentDraft && (
          <GeneratedResultCard
            key="result"
            draft={currentDraft}
            onRegenerate={() => currentBriefId && generateMutation.mutate(currentBriefId)}
            onSave={() => saveMutation.mutate()}
            regenerating={generateMutation.isPending}
          />
        )}
      </AnimatePresence>

      {/* Recent generations */}
      {isLoading ? (
        <SkeletonCard />
      ) : briefs.length === 0 && !currentDraft ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="No content generated yet"
          description="Fill in the form above and click Generate Content to get started."
        />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: SPRING, delay: 0.1 }}
        >
          <RecentGenerations briefs={briefs} />
        </motion.div>
      )}
    </div>
  )
}
