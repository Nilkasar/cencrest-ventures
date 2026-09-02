'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Plus, Clock } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { listItem, cardHover } from '@/lib/motion'

interface Brand {
  id: string
  name: string
  industry?: string
  website?: string
  visibility_score?: number
  crawl_status?: 'idle' | 'running' | 'completed' | 'failed'
  last_crawled_at?: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function scoreVariant(score: number): 'success' | 'warning' | 'danger' | 'default' {
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'danger'
}

function AddBrandModal({ onClose, slug }: { onClose: () => void; slug: string }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post(routes.brands(slug), { name, website }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands', slug] })
      onClose()
    },
  })

  return (
    <Modal open onOpenChange={(open) => { if (!open) onClose() }}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Add Brand</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <form
            id="add-brand-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              mutation.mutate()
            }}
          >
            <Input
              label="Brand Name"
              placeholder="Acme Corp"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              label="Website URL"
              type="url"
              placeholder="https://acme.com"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            {mutation.isError && (
              <p className="text-sm text-danger font-sans">
                {(mutation.error as Error).message}
              </p>
            )}
          </form>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="add-brand-form"
            loading={mutation.isPending}
            disabled={!name.trim()}
          >
            Add Brand
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default function BrandsPage() {
  const { slug } = useParams<{ slug: string }>()
  const [showModal, setShowModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['brands', slug],
    queryFn: () => api.get<{ brands: Brand[] }>(routes.brands(slug)),
  })

  const brands = (data as { brands?: Brand[] } | undefined)?.brands ?? []

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <AnimatePresence>
        {showModal && <AddBrandModal onClose={() => setShowModal(false)} slug={slug} />}
      </AnimatePresence>

      {/* Header */}
      <PageHeader
        title="Your Brands"
        subtitle="Monitor AI visibility and competitive presence for each brand."
        actions={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" />
            Add Brand
          </Button>
        }
        className="mb-8"
      />

      {/* Content */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : brands.length === 0 ? (
        <EmptyState
          title="No brands yet"
          description="Add your first brand to start measuring AI visibility."
          action={
            <Button onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4" /> Add Brand
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {brands.map((brand, i) => {
            const score = brand.visibility_score ?? 0
            const variant = scoreVariant(score)

            return (
              <motion.div
                key={brand.id}
                {...listItem(i)}
                className={`rounded-2xl border border-border bg-surface-raised p-6 cursor-pointer group ${cardHover}`}
              >
                {/* Brand name */}
                <h2 className="font-display text-xl font-semibold text-ink leading-tight group-hover:text-ember transition-colors">
                  {brand.name}
                </h2>

                {/* Domain */}
                {brand.website && (
                  <p className="font-mono text-xs text-dim mt-0.5 truncate">
                    {brand.website.replace(/^https?:\/\//, '')}
                  </p>
                )}

                {/* Visibility score bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-sans text-dim">AI Visibility</span>
                    <span className={`text-xs font-sans font-semibold text-${variant === 'success' ? 'success' : variant === 'warning' ? 'warning' : variant === 'danger' ? 'danger' : 'dim'}`}>
                      {score}
                    </span>
                  </div>
                  <Progress value={score} variant={variant} className="h-1.5" />
                </div>

                {/* Last run */}
                <div className="text-xs text-dim mt-3 flex items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  {brand.last_crawled_at
                    ? `Last run: ${relativeTime(brand.last_crawled_at)}`
                    : 'Never run'}
                </div>

                {/* Status badge */}
                {brand.crawl_status && brand.crawl_status !== 'idle' && (
                  <div className="mt-2">
                    <Badge
                      variant={
                        brand.crawl_status === 'completed'
                          ? 'success'
                          : brand.crawl_status === 'running'
                          ? 'info'
                          : brand.crawl_status === 'failed'
                          ? 'danger'
                          : 'outline'
                      }
                      size="sm"
                      dot
                    >
                      {brand.crawl_status}
                    </Badge>
                  </div>
                )}

                {/* CTA */}
                <Link href={`/${slug}/brands/${brand.id}/visibility`} className="mt-4 block">
                  <Button variant="outline" size="sm" className="w-full">
                    View Dashboard →
                  </Button>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
