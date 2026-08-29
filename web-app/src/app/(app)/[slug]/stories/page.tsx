'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, ArrowLeft, BookOpen, ExternalLink, ChevronDown, ChevronUp,
  Trash2, Send, Clock, User, Tag, X,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, relativeTime } from '@/lib/utils'
import { spring, staggerContainer, staggerItem } from '@/design-system/motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter, ModalClose } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Story {
  id: string
  title: string
  content: string
  author: string
  tags: string[]
  status: 'published' | 'draft'
  created_at: string
  published_at?: string
  source_url?: string
}

// ─── New Story Modal ──────────────────────────────────────────────────────────

function NewStoryModal({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const base = routes.stories(slug)
  const [form, setForm] = React.useState({
    title: '', content: '', author: '', source_url: '', tagsInput: '',
  })
  const [tagList, setTagList] = React.useState<string[]>([])

  const mutation = useMutation({
    mutationFn: () => api.post(base, { title: form.title, content: form.content, author: form.author, source_url: form.source_url, tags: tagList }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stories', slug] })
      onClose()
      setForm({ title: '', content: '', author: '', source_url: '', tagsInput: '' })
      setTagList([])
    },
  })

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }))

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const tag = form.tagsInput.trim().replace(/,+$/, '')
      if (tag && !tagList.includes(tag)) setTagList((t) => [...t, tag])
      set('tagsInput', '')
    }
  }

  const removeTag = (tag: string) => setTagList((t) => t.filter((x) => x !== tag))

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>New Story</ModalTitle>
        </ModalHeader>
        <ModalBody className="flex flex-col gap-4">
          <Input label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="The pivot that saved us..." />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink font-sans">Content</label>
            <textarea
              value={form.content}
              onChange={(e) => set('content', e.target.value)}
              rows={10}
              placeholder="Tell the full story..."
              className="w-full rounded-md border border-border bg-paper px-3 py-2 text-sm font-serif text-ink placeholder:text-dim resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:border-ember transition-[border-color,box-shadow] duration-150 leading-relaxed"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Author" value={form.author} onChange={(e) => set('author', e.target.value)} placeholder="Jane Doe" />
            <Input label="Source URL" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://..." />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-ink font-sans">Tags</label>
            <div className="flex flex-wrap gap-1.5 min-h-[40px] rounded-md border border-border bg-paper px-3 py-2 focus-within:ring-2 focus-within:ring-ember focus-within:border-ember transition-[border-color,box-shadow] duration-150">
              {tagList.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface border border-border rounded-full text-xs font-sans text-ink">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-dim hover:text-danger transition-colors"><X className="h-3 w-3" /></button>
                </span>
              ))}
              <input
                value={form.tagsInput}
                onChange={(e) => set('tagsInput', e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={tagList.length === 0 ? 'Type a tag + Enter...' : ''}
                className="flex-1 min-w-[120px] bg-transparent text-sm font-sans text-ink placeholder:text-dim outline-none"
              />
            </div>
            <p className="text-xs text-dim font-sans">Press Enter or comma to add a tag.</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalClose asChild><Button variant="outline" size="sm">Cancel</Button></ModalClose>
          <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()} disabled={!form.title || !form.content}>
            Save Story
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── Story Slide-Over ─────────────────────────────────────────────────────────

function StorySlideOver({ story, onClose }: { story: Story | null; onClose: () => void }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <AnimatePresence>
      {story && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-ink/20 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={spring}
            className="fixed right-0 top-0 bottom-0 z-[201] w-full max-w-[600px] bg-paper shadow-2xl border-l border-border overflow-y-auto"
          >
            {/* Nav */}
            <div className="sticky top-0 bg-paper/90 backdrop-blur-md border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <button
                onClick={onClose}
                className="flex items-center gap-2 text-sm font-sans text-dim hover:text-ink transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              {story.source_url && (
                <a href={story.source_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-sans text-dim hover:text-ink transition-colors">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Source
                </a>
              )}
            </div>

            {/* Content */}
            <div className="px-8 py-8">
              <h1 className="font-display text-3xl font-semibold text-ink leading-tight mb-4">{story.title}</h1>

              {/* Author block */}
              <div className="flex items-center gap-3 mb-6 pb-6 border-b border-border">
                <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-dim flex-shrink-0">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-sans font-medium text-ink">{story.author}</p>
                  <p className="text-xs text-dim font-sans">
                    {story.published_at ? `Published ${relativeTime(story.published_at)}` : relativeTime(story.created_at)}
                  </p>
                </div>
              </div>

              {/* Tags */}
              {story.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-6">
                  {story.tags.map((tag) => (
                    <Badge key={tag} variant="outline" size="sm">
                      <Tag className="h-2.5 w-2.5" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Story body */}
              <div className="font-serif text-ink leading-relaxed text-base whitespace-pre-wrap">
                {story.content}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Story Card ───────────────────────────────────────────────────────────────

function StoryCard({ story, index, onRead }: { story: Story; index: number; onRead: () => void }) {
  const excerpt = story.content.length > 300 ? story.content.slice(0, 300) + '…' : story.content

  return (
    <motion.div
      variants={staggerItem}
      custom={index}
      layout
      whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(22,20,15,0.10)' }}
      transition={spring}
      className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 hover:shadow-md transition-shadow flex flex-col cursor-default"
    >
      {/* Status badge float right */}
      <div className="flex justify-end mb-1">
        <Badge variant={story.status === 'published' ? 'success' : 'outline'} size="sm">
          {story.status}
        </Badge>
      </div>

      {/* Title */}
      <h2 className="font-display text-xl text-[var(--ink)] mt-2 line-clamp-2 leading-snug">{story.title}</h2>

      {/* Excerpt */}
      <p className="text-sm text-[var(--dim)] mt-2 line-clamp-3 leading-relaxed flex-1">{excerpt}</p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)]">
        <span className="text-xs text-[var(--dim)]">
          {story.published_at ? relativeTime(story.published_at) : relativeTime(story.created_at)}
        </span>
        <Button size="sm" variant="ghost" onClick={onRead} className="gap-1.5">
          <BookOpen className="h-3.5 w-3.5" />
          Edit
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Drafts Section ───────────────────────────────────────────────────────────

function DraftsSection({ drafts, slug }: { drafts: Story[]; slug: string }) {
  const qc = useQueryClient()
  const base = routes.stories(slug)
  const [collapsed, setCollapsed] = React.useState(false)

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.post(`${base}/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories', slug] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories', slug] }),
  })

  if (drafts.length === 0) return null

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 bg-surface hover:bg-border/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-sans font-medium text-ink text-sm">Drafts</span>
          <Badge variant="warning" size="sm">{drafts.length}</Badge>
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 text-dim" /> : <ChevronUp className="h-4 w-4 text-dim" />}
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="divide-y divide-border">
              {drafts.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-5 py-3 bg-paper hover:bg-surface transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-sans font-medium text-ink truncate">{d.title}</p>
                    <p className="text-xs text-dim font-sans">{relativeTime(d.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={publishMutation.isPending}
                      onClick={() => publishMutation.mutate(d.id)}
                      className="gap-1.5"
                    >
                      <Send className="h-3 w-3" />
                      Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(d.id)}
                      className="text-dim hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoriesPage() {
  const { slug } = useParams<{ slug: string }>()
  const base = routes.stories(slug)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [activeStory, setActiveStory] = React.useState<Story | null>(null)

  const { data, isLoading } = useQuery<{ stories: Story[] }>({
    queryKey: ['stories', slug],
    queryFn: () => api.get(base),
  })

  const published = React.useMemo(
    () => (data?.stories ?? []).filter((s) => s.status === 'published'),
    [data]
  )
  const drafts = React.useMemo(
    () => (data?.stories ?? []).filter((s) => s.status === 'draft'),
    [data]
  )

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="flex flex-col gap-6 p-6 max-w-6xl mx-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink leading-tight">Brand Stories</h1>
            <p className="text-sm text-dim font-sans mt-1">Founder intelligence &amp; market narratives</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" asChild>
              <a href="/stories" target="_blank" rel="noopener noreferrer" className="gap-1.5 no-underline">
                <ExternalLink className="h-3.5 w-3.5" />
                Public stories
              </a>
            </Button>
            <Button
              size="sm"
              onClick={() => setModalOpen(true)}
              className="bg-[var(--ember)] text-white hover:bg-[var(--ember)]/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New Story
            </Button>
          </div>
        </div>

        {/* Stories grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-48" />)}
          </div>
        ) : published.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3 border border-dashed border-border rounded-xl">
            <BookOpen className="h-8 w-8 text-dim" />
            <p className="text-sm text-dim font-sans">No stories yet.</p>
            <Button size="sm" onClick={() => setModalOpen(true)} className="bg-[var(--ember)] text-white hover:bg-[var(--ember)]/90">
              <Plus className="h-3.5 w-3.5" /> Write the first story
            </Button>
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
          >
            {published.map((story, i) => (
              <StoryCard
                key={story.id}
                story={story}
                index={i}
                onRead={() => setActiveStory(story)}
              />
            ))}
          </motion.div>
        )}

        {/* Drafts */}
        {!isLoading && <DraftsSection drafts={drafts} slug={slug} />}
      </motion.div>

      {/* Modals */}
      <NewStoryModal slug={slug} open={modalOpen} onClose={() => setModalOpen(false)} />
      <StorySlideOver story={activeStory} onClose={() => setActiveStory(null)} />
    </>
  )
}
