'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

interface Brand {
  id: string
  name: string
  industry?: string
  website?: string
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

const crawlBadgeVariant = (status?: string) => {
  switch (status) {
    case 'completed': return 'success'
    case 'running': return 'info'
    case 'failed': return 'danger'
    default: return 'outline'
  }
}

function AddBrandModal({ onClose, slug }: { onClose: () => void; slug: string }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', industry: '', website: '' })

  const mutation = useMutation({
    mutationFn: () => api.post(routes.brands(slug), form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands', slug] })
      onClose()
    },
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-300 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        className="bg-paper border border-border rounded-xl shadow-xl w-full max-w-md"
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="font-display text-xl font-semibold text-ink">Add Brand</h2>
          <button onClick={onClose} className="text-dim hover:text-ink transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          className="p-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
        >
          {([
            { key: 'name', label: 'Brand Name', placeholder: 'Acme Corp', required: true },
            { key: 'industry', label: 'Industry', placeholder: 'SaaS, Healthcare…', required: false },
            { key: 'website', label: 'Website', placeholder: 'https://acme.com', required: false },
          ] as const).map(({ key, label, placeholder, required }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-sm font-sans font-medium text-ink">
                {label} {required && <span className="text-ember">*</span>}
              </label>
              <input
                type={key === 'website' ? 'url' : 'text'}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                required={required}
                className="h-10 px-3 rounded-md border border-border bg-paper text-ink text-sm font-sans focus:outline-none focus:ring-2 focus:ring-ember transition-shadow"
              />
            </div>
          ))}
          {mutation.isError && (
            <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={mutation.isPending}>
              Add Brand
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
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
    <div className="max-w-5xl mx-auto">
      <AnimatePresence>
        {showModal && <AddBrandModal onClose={() => setShowModal(false)} slug={slug} />}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Brands</h1>
          <p className="text-sm text-dim mt-1">Manage your tracked brands</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4" />
          Add Brand
        </Button>
      </motion.div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : brands.length === 0 ? (
        <EmptyState
          title="No brands yet"
          description="Add your first brand to start tracking AI visibility."
          action={
            <Button onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4" /> Add Brand
            </Button>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {brands.map((brand, i) => (
            <motion.div
              key={brand.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            >
              <Link href={`/${slug}/brands/${brand.id}`}>
                <Card hover className="group">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h2 className="font-display text-lg font-semibold text-ink leading-tight group-hover:text-ember transition-colors">
                        {brand.name}
                      </h2>
                      <Badge
                        variant={crawlBadgeVariant(brand.crawl_status) as 'success' | 'info' | 'danger' | 'outline'}
                        size="sm"
                        dot
                      >
                        {brand.crawl_status ?? 'idle'}
                      </Badge>
                    </div>
                    {brand.industry && (
                      <p className="text-sm text-dim mb-1">{brand.industry}</p>
                    )}
                    {brand.website && (
                      <p className="text-xs text-dim font-mono truncate mb-3">{brand.website}</p>
                    )}
                    {brand.last_crawled_at && (
                      <p className="text-xs text-dim">
                        Last crawled {relativeTime(brand.last_crawled_at)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
