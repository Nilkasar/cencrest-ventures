'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Users, BarChart3, FileText, TrendingUp, X, Eye, Trash2, Building2 } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, relativeTime, formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { ScoreRing } from '@/components/ui/score-ring'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal'
import { spring } from '@/design-system/motion'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client {
  id: string
  org_slug: string
  org_name: string
  brand_count: number
  health_score: number
  last_activity: string
}

interface AgencyData {
  clients: Client[]
}

interface ClientSummary {
  org_name: string
  org_slug: string
  health_score: number
  brands: Array<{ id: string; name: string; health_score: number }>
  recent_runs: Array<{ id: string; created_at: string; status: string; brand_name: string }>
  health_breakdown: Record<string, number>
}

interface AgencyStats {
  total_clients: number
  active_brands: number
  reports_sent: number
  avg_score: number
}

// ─── Animations ───────────────────────────────────────────────────────────────

const SPRING = [0.16, 1, 0.3, 1] as [number, number, number, number]

const stagger = (i: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: SPRING, delay: i * 0.07 },
})

// ─── Client Card ──────────────────────────────────────────────────────────────

function ClientCard({
  client,
  index,
  onView,
  onRemove,
}: {
  client: Client
  index: number
  onView: (client: Client) => void
  onRemove: (client: Client) => void
}) {
  return (
    <motion.div
      {...stagger(index)}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'group relative bg-surface border border-border rounded-xl p-6 shadow-sm',
        'hover:border-ember hover:shadow-md transition-[border-color,box-shadow] duration-200'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-ember/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-5 w-5 text-ember" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-ink text-base leading-tight truncate">
              {client.org_name}
            </h3>
            <Badge variant="outline" size="sm" className="mt-1 font-mono text-xs">
              {client.org_slug}
            </Badge>
          </div>
        </div>
        <ScoreRing score={client.health_score} size={56} strokeWidth={5} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-paper rounded-lg p-3 border border-border">
          <p className="text-xs text-dim font-sans mb-0.5">Brands</p>
          <p className="font-display text-xl font-semibold text-ink">{client.brand_count}</p>
        </div>
        <div className="bg-paper rounded-lg p-3 border border-border">
          <p className="text-xs text-dim font-sans mb-0.5">Last active</p>
          <p className="text-sm text-ink font-sans">{relativeTime(client.last_activity)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onView(client)}
        >
          <Eye className="h-4 w-4" />
          View
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger-muted hover:text-danger"
          onClick={() => onRemove(client)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Add Client Modal ─────────────────────────────────────────────────────────

function AddClientModal({
  open,
  onOpenChange,
  slug,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  slug: string
}) {
  const qc = useQueryClient()
  const [orgSlug, setOrgSlug] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (body: { client_org_slug: string; notes: string }) =>
      api.post(`${routes.agency(slug)}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency', slug] })
      onOpenChange(false)
      setOrgSlug('')
      setNotes('')
      setError('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = orgSlug.trim()
    if (!trimmed) { setError('Client slug is required'); return }
    if (!/^[a-z0-9-]+$/.test(trimmed)) { setError('Slug must be lowercase alphanumeric with hyphens'); return }
    setError('')
    mutation.mutate({ client_org_slug: trimmed, notes: notes.trim() })
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <form onSubmit={handleSubmit}>
          <ModalHeader>
            <ModalTitle>Add Client</ModalTitle>
            <ModalDescription>
              Enter the client's organisation slug to add them to your agency.
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <Input
              label="Client org slug"
              placeholder="acme-corp"
              value={orgSlug}
              onChange={(e) => { setOrgSlug(e.target.value); setError('') }}
              error={error}
              autoFocus
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink font-sans">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any context about this client…"
                rows={3}
                className={cn(
                  'w-full rounded-md border border-border bg-paper px-3 py-2 text-sm font-sans text-ink placeholder:text-dim',
                  'transition-[border-color,box-shadow] duration-[150ms]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:border-ember',
                  'resize-none'
                )}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Add Client
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}

// ─── Confirm Remove Modal ─────────────────────────────────────────────────────

function RemoveModal({
  client,
  onClose,
  slug,
}: {
  client: Client | null
  onClose: () => void
  slug: string
}) {
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api.delete(`${routes.agency(slug)}/${client!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency', slug] })
      onClose()
    },
  })

  return (
    <Modal open={!!client} onOpenChange={() => onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Remove Client</ModalTitle>
          <ModalDescription>
            Are you sure you want to remove <strong>{client?.org_name}</strong>? This action cannot be undone.
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Remove Client
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─── Client Summary Slide-Over ────────────────────────────────────────────────

function ClientSummary({
  client,
  slug,
  onClose,
}: {
  client: Client | null
  slug: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['agency-client-summary', slug, client?.id],
    queryFn: () => api.get<ClientSummary>(`${routes.agency(slug)}/${client!.id}/summary`),
    enabled: !!client,
  })

  const summary = data as ClientSummary | undefined

  return (
    <AnimatePresence>
      {client && (
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
            transition={{ duration: 0.35, ease: SPRING }}
            className="fixed right-0 top-0 bottom-0 z-[201] w-[480px] max-w-full bg-paper border-l border-border shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border flex-shrink-0">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">{client.org_name}</h2>
                <Badge variant="outline" size="sm" className="font-mono text-xs mt-1">
                  {client.org_slug}
                </Badge>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-md flex items-center justify-center text-dim hover:text-ink hover:bg-surface transition-colors"
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-20 rounded-lg bg-surface border border-border animate-pulse" />
                  ))}
                </div>
              ) : summary ? (
                <>
                  {/* Health Score */}
                  <div className="flex items-center gap-6 bg-surface rounded-xl p-5 border border-border">
                    <ScoreRing score={summary.health_score} size={72} strokeWidth={6} label="Health" />
                    <div>
                      <p className="text-sm text-dim font-sans mb-1">Overall health score</p>
                      <p className="font-display text-3xl font-semibold text-ink">{summary.health_score}</p>
                    </div>
                  </div>

                  {/* Health Breakdown */}
                  {summary.health_breakdown && Object.keys(summary.health_breakdown).length > 0 && (
                    <div>
                      <h4 className="text-xs font-sans font-medium text-dim uppercase tracking-wide mb-3">Score Breakdown</h4>
                      <div className="space-y-2">
                        {Object.entries(summary.health_breakdown).map(([key, val]) => (
                          <div key={key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                            <span className="text-sm text-ink font-sans capitalize">{key.replace(/_/g, ' ')}</span>
                            <span className="font-mono text-sm text-ink">{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Brands */}
                  <div>
                    <h4 className="text-xs font-sans font-medium text-dim uppercase tracking-wide mb-3">Brands</h4>
                    {summary.brands.length === 0 ? (
                      <p className="text-sm text-dim">No brands yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {summary.brands.map((brand) => (
                          <div
                            key={brand.id}
                            className="flex items-center justify-between bg-surface rounded-lg px-4 py-3 border border-border"
                          >
                            <span className="text-sm font-sans text-ink">{brand.name}</span>
                            <ScoreRing score={brand.health_score} size={36} strokeWidth={4} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Recent Runs */}
                  <div>
                    <h4 className="text-xs font-sans font-medium text-dim uppercase tracking-wide mb-3">Recent Runs</h4>
                    {summary.recent_runs.length === 0 ? (
                      <p className="text-sm text-dim">No runs yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {summary.recent_runs.map((run) => (
                          <div
                            key={run.id}
                            className="flex items-center justify-between py-2 border-b border-border last:border-0"
                          >
                            <div>
                              <p className="text-sm text-ink font-sans">{run.brand_name}</p>
                              <p className="text-xs text-dim">{relativeTime(run.created_at)}</p>
                            </div>
                            <Badge
                              variant={
                                run.status === 'completed' ? 'success'
                                  : run.status === 'running' ? 'info'
                                  : run.status === 'failed' ? 'danger'
                                  : 'outline'
                              }
                              size="sm"
                              dot
                            >
                              {run.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgencyPage() {
  const { slug } = useParams<{ slug: string }>()
  const [addOpen, setAddOpen] = useState(false)
  const [removeClient, setRemoveClient] = useState<Client | null>(null)
  const [viewClient, setViewClient] = useState<Client | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['agency', slug],
    queryFn: () => api.get<AgencyData>(routes.agency(slug)),
  })

  const clients = (data as AgencyData | undefined)?.clients ?? []

  // Derived stats
  const stats: AgencyStats = {
    total_clients: clients.length,
    active_brands: clients.reduce((sum, c) => sum + c.brand_count, 0),
    reports_sent: 0,
    avg_score: clients.length
      ? Math.round(clients.reduce((sum, c) => sum + c.health_score, 0) / clients.length)
      : 0,
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: SPRING }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Agency</h1>
          <p className="text-sm text-dim font-sans mt-1">Manage your client organisations</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Client
        </Button>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Clients', value: stats.total_clients, icon: Users },
          { label: 'Active Brands', value: stats.active_brands, icon: BarChart3 },
          { label: 'Reports Sent', value: stats.reports_sent, icon: FileText },
          { label: 'Avg Client Score', value: stats.avg_score, icon: TrendingUp },
        ].map(({ label, value, icon: Icon }, i) => (
          <motion.div key={label} {...stagger(i)}>
            {isLoading ? (
              <div className="h-32 rounded-lg bg-surface border border-border animate-pulse" />
            ) : (
              <StatCard label={label} value={value} />
            )}
          </motion.div>
        ))}
      </div>

      {/* Client Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-52 rounded-xl bg-surface border border-border animate-pulse" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No clients yet"
          description="Add your first client to get started managing their brands and reports."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Client
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {clients.map((client, i) => (
            <ClientCard
              key={client.id}
              client={client}
              index={i}
              onView={setViewClient}
              onRemove={setRemoveClient}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <AddClientModal open={addOpen} onOpenChange={setAddOpen} slug={slug} />
      <RemoveModal client={removeClient} onClose={() => setRemoveClient(null)} slug={slug} />

      {/* Slide-over */}
      <ClientSummary client={viewClient} slug={slug} onClose={() => setViewClient(null)} />
    </div>
  )
}
