'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, Plus, RefreshCw, Play, Trash2 } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTable } from '@/components/ui/data-table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'

interface Brand {
  id: string
  name: string
  industry?: string
  website?: string
  crawl_status?: 'idle' | 'running' | 'completed' | 'failed'
  last_crawled_at?: string
  pages_crawled?: number
  visibility_score?: number
  queries_tracked?: number
  gaps_identified?: number
  actions_pending?: number
}

interface Run extends Record<string, unknown> {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  provider?: string
}

interface CrawlPage extends Record<string, unknown> {
  id: string
  url: string
  word_count?: number
  status_code?: number
  crawled_at?: string
}

interface Journey {
  id: string
  stage: 'Awareness' | 'Consideration' | 'Evaluation' | 'Purchase'
  query: string
  intent?: string
}

type JourneyStage = Journey['stage']
const STAGES: JourneyStage[] = ['Awareness', 'Consideration', 'Evaluation', 'Purchase']

const intentVariant = (intent?: string) => {
  switch (intent) {
    case 'informational': return 'info'
    case 'commercial': return 'warning'
    case 'transactional': return 'success'
    default: return 'outline'
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const runStatusVariant = (status: string): 'success' | 'info' | 'danger' | 'warning' | 'outline' => {
  switch (status) {
    case 'completed': return 'success'
    case 'running': return 'info'
    case 'failed': return 'danger'
    case 'pending': return 'warning'
    default: return 'outline'
  }
}

const crawlBadgeVariant = (status?: string): 'success' | 'info' | 'danger' | 'outline' => {
  switch (status) {
    case 'completed': return 'success'
    case 'running': return 'info'
    case 'failed': return 'danger'
    default: return 'outline'
  }
}

const SPRING = [0.16, 1, 0.3, 1] as [number, number, number, number]

const fadeUp = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: SPRING, delay: i * 0.08 },
})

// ─── Runs Table ───────────────────────────────────────────────────────────────

function RunsTable({ slug, brandId, limit }: { slug: string; brandId: string; limit?: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['runs', slug, brandId],
    queryFn: () => api.get<{ runs: Run[] }>(routes.runs(slug, brandId)),
  })

  const runs = (data as { runs?: Run[] } | undefined)?.runs ?? []
  const displayed = limit ? runs.slice(0, limit) : runs

  const columns = [
    {
      key: 'created_at',
      header: 'Date',
      render: (v: unknown) => (
        <span className="text-sm text-[var(--ink)] font-sans">{relativeTime(v as string)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (v: unknown) => (
        <Badge variant={runStatusVariant(v as string)} size="sm" dot>
          {v as string}
        </Badge>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      render: (v: unknown) => (
        <span className="text-sm text-[var(--dim)] font-sans">{(v as string) ?? '—'}</span>
      ),
    },
    {
      key: 'completed_at',
      header: 'Duration',
      render: (v: unknown, row: Run) => {
        if (!v || !row.created_at) return <span className="text-sm text-[var(--dim)]">—</span>
        const ms = new Date(v as string).getTime() - new Date(row.created_at).getTime()
        const s = Math.round(ms / 1000)
        return <span className="font-mono text-xs text-[var(--dim)]">{s}s</span>
      },
    },
    {
      key: 'id',
      header: '',
      render: (v: unknown) => (
        <a
          href={`/${slug}/brands/${brandId}/visibility/runs/${v as string}`}
          className="text-xs text-[var(--ember)] hover:underline font-sans"
        >
          View →
        </a>
      ),
    },
  ]

  return (
    <DataTable
      data={displayed as unknown as Record<string, unknown>[]}
      columns={columns as unknown as import('@/components/ui/data-table').Column<Record<string, unknown>>[]}
      loading={isLoading}
      rowKey={(r) => String(r.id)}
      emptyMessage="No runs yet. Start an analysis to populate this list."
      pageSize={limit ?? 10}
    />
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ brand, slug, brandId }: { brand: Brand; slug: string; brandId: string }) {
  const qc = useQueryClient()
  const [crawlSuccess, setCrawlSuccess] = useState(false)

  const crawlMutation = useMutation({
    mutationFn: () => api.post(`/api/orgs/${slug}/brands/${brandId}/crawl/start`),
    onSuccess: () => {
      setCrawlSuccess(true)
      qc.invalidateQueries({ queryKey: ['brand', slug, brandId] })
      setTimeout(() => setCrawlSuccess(false), 3000)
    },
  })

  const isRunning = brand.crawl_status === 'running'

  return (
    <div className="space-y-6">
      {/* Stat cards row */}
      <motion.div {...fadeUp(0)} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Visibility Score', value: brand.visibility_score ?? 0 },
          { label: 'Keywords', value: brand.queries_tracked ?? 0 },
          { label: 'GEO Gaps', value: brand.gaps_identified ?? 0 },
          { label: 'Actions', value: brand.actions_pending ?? 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[var(--border)] bg-white/60 px-4 py-4"
          >
            <p className="text-xs font-sans text-[var(--dim)] uppercase tracking-wider mb-1">{stat.label}</p>
            <p className="font-display text-2xl font-semibold text-[var(--ink)]">{stat.value}</p>
          </div>
        ))}
      </motion.div>

      {/* Crawl card */}
      <motion.div {...fadeUp(1)}>
        <Card>
          <CardHeader>
            <CardTitle>Crawl Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={crawlBadgeVariant(brand.crawl_status)}
                    size="sm"
                    dot
                  >
                    {isRunning ? (
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--ember)] animate-pulse" />
                        Running
                      </span>
                    ) : (
                      brand.crawl_status ?? 'idle'
                    )}
                  </Badge>
                  {isRunning && <Spinner size="sm" />}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-[var(--dim)]">Pages crawled</p>
                    <p className="font-display text-2xl font-semibold text-[var(--ink)]">
                      {brand.pages_crawled ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--dim)]">Last crawled</p>
                    <p className="text-sm text-[var(--ink)]">{relativeTime(brand.last_crawled_at)}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => crawlMutation.mutate()}
                  loading={crawlMutation.isPending || isRunning}
                  variant="outline"
                >
                  <RefreshCw className="h-4 w-4" />
                  Crawl Now
                </Button>
                <AnimatePresence>
                  {crawlSuccess && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-xs text-[var(--success)] text-center"
                    >
                      Crawl started
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent runs */}
      <motion.div {...fadeUp(2)}>
        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <RunsTable slug={slug} brandId={brandId} limit={5} />
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}

// ─── Pages Tab ────────────────────────────────────────────────────────────────

function PagesTab({ slug, brandId }: { slug: string; brandId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['crawl-pages', slug, brandId],
    queryFn: () =>
      api.get<{ pages: CrawlPage[] }>(`/api/orgs/${slug}/brands/${brandId}/crawl/pages`),
  })

  const pages = (data as { pages?: CrawlPage[] } | undefined)?.pages ?? []

  const columns = [
    {
      key: 'url',
      header: 'URL',
      render: (_: unknown, row: CrawlPage) => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--ember)] hover:underline font-mono text-xs truncate block max-w-xs"
        >
          {row.url}
        </a>
      ),
    },
    {
      key: 'word_count',
      header: 'Words',
      className: 'text-right',
      render: (v: unknown) => <span className="font-mono text-xs">{String(v ?? '—')}</span>,
    },
    {
      key: 'status_code',
      header: 'Status',
      render: (v: unknown) => {
        const code = Number(v)
        return (
          <Badge
            variant={code >= 200 && code < 300 ? 'success' : code >= 400 ? 'danger' : 'outline'}
            size="sm"
          >
            {code || '—'}
          </Badge>
        )
      },
    },
    {
      key: 'crawled_at',
      header: 'Crawled',
      render: (v: unknown) => <span className="text-xs text-[var(--dim)]">{relativeTime(v as string)}</span>,
    },
  ]

  return (
    <motion.div {...fadeUp(0)}>
      <Card>
        <CardContent className="pt-6">
          <DataTable
            data={pages}
            columns={columns}
            loading={isLoading}
            rowKey={(r) => String(r.id)}
            emptyMessage="No pages crawled yet. Run a crawl to populate this list."
            pageSize={15}
          />
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Journeys Tab ─────────────────────────────────────────────────────────────

function JourneysTab({ slug, brandId }: { slug: string; brandId: string }) {
  const qc = useQueryClient()
  const [addingStage, setAddingStage] = useState<JourneyStage | null>(null)
  const [newQuery, setNewQuery] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['journeys', slug, brandId],
    queryFn: () => api.get<{ journeys: Journey[] }>(routes.journeys(slug, brandId)),
  })

  const generateMutation = useMutation({
    mutationFn: () => api.post(`${routes.journeys(slug, brandId)}/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journeys', slug, brandId] }),
  })

  const addQueryMutation = useMutation({
    mutationFn: ({ stage, query }: { stage: JourneyStage; query: string }) =>
      api.post(routes.journeys(slug, brandId), { stage, query }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journeys', slug, brandId] })
      setAddingStage(null)
      setNewQuery('')
    },
  })

  const journeys = (data as { journeys?: Journey[] } | undefined)?.journeys ?? []
  const byStage = STAGES.reduce<Record<JourneyStage, Journey[]>>(
    (acc, s) => ({ ...acc, [s]: journeys.filter((j) => j.stage === s) }),
    {} as Record<JourneyStage, Journey[]>
  )

  if (isLoading) return <SkeletonCard />

  return (
    <div className="space-y-6">
      <motion.div {...fadeUp(0)} className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => generateMutation.mutate()}
          loading={generateMutation.isPending}
        >
          Generate Queries
        </Button>
      </motion.div>

      {STAGES.map((stage, i) => (
        <motion.div key={stage} {...fadeUp(i + 1)}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{stage}</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingStage(addingStage === stage ? null : stage)}
                >
                  <Plus className="h-4 w-4" />
                  Add Query
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <AnimatePresence>
                {addingStage === stage && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mb-4"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (newQuery.trim()) addQueryMutation.mutate({ stage, query: newQuery.trim() })
                    }}
                  >
                    <div className="flex gap-2 pt-1">
                      <input
                        autoFocus
                        value={newQuery}
                        onChange={(e) => setNewQuery(e.target.value)}
                        placeholder="Enter a buyer query…"
                        className="flex-1 h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--paper)] text-sm font-sans focus:outline-none focus:ring-2 focus:ring-[var(--ember)]"
                      />
                      <Button type="submit" size="sm" loading={addQueryMutation.isPending}>Add</Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => { setAddingStage(null); setNewQuery('') }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              {byStage[stage].length === 0 ? (
                <p className="text-sm text-[var(--dim)]">No queries yet for this stage.</p>
              ) : (
                <div className="space-y-2">
                  {byStage[stage].map((j) => (
                    <div key={j.id} className="flex items-center gap-3 py-2 border-b border-[var(--border)] last:border-0">
                      {j.intent && (
                        <Badge
                          variant={intentVariant(j.intent) as 'info' | 'warning' | 'success' | 'outline'}
                          size="sm"
                        >
                          {j.intent}
                        </Badge>
                      )}
                      <span className="text-sm text-[var(--ink)]">{j.query}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Runs Tab ─────────────────────────────────────────────────────────────────

function RunsTab({ slug, brandId }: { slug: string; brandId: string }) {
  return (
    <motion.div {...fadeUp(0)}>
      <Card>
        <CardContent className="pt-6 p-0">
          <RunsTable slug={slug} brandId={brandId} />
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ brand, slug, brandId }: { brand: Brand; slug: string; brandId: string }) {
  const [name, setName] = useState(brand.name)
  const [website, setWebsite] = useState(brand.website ?? '')
  const qc = useQueryClient()
  const { toast } = useToast()

  const saveMutation = useMutation({
    mutationFn: () => api.patch(routes.brand(slug, brandId), { name, website }),
    onSuccess: () => {
      toast({ title: 'Brand saved', variant: 'success' })
      qc.invalidateQueries({ queryKey: ['brand', slug, brandId] })
    },
    onError: () => toast({ title: 'Failed to save', variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(routes.brand(slug, brandId)),
    onSuccess: () => {
      window.location.href = `/${slug}/brands`
    },
    onError: () => toast({ title: 'Failed to delete brand', variant: 'error' }),
  })

  return (
    <div className="space-y-6 max-w-lg">
      <motion.div {...fadeUp(0)}>
        <Card>
          <CardHeader><CardTitle>Brand Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Brand Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label="Website URL"
              type="url"
              placeholder="https://example.com"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <Button
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
            >
              Save Changes
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div {...fadeUp(1)}>
        <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-6">
          <h3 className="font-display font-semibold text-[var(--danger)] mb-2">Danger Zone</h3>
          <p className="text-sm text-[var(--dim)] font-sans mb-4">
            Permanently delete this brand and all its data. This action cannot be undone.
          </p>
          <Button
            variant="danger"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
            Delete Brand
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BrandDetailPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()

  const { data, isLoading } = useQuery({
    queryKey: ['brand', slug, brandId],
    queryFn: () => api.get<Brand>(routes.brand(slug, brandId)),
  })

  const brand = data as Brand | undefined

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  if (!brand) {
    return (
      <div className="max-w-5xl mx-auto">
        <EmptyState title="Brand not found" description="This brand does not exist or you do not have access." />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="flex items-center justify-between gap-4 mb-8"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-3xl font-semibold text-[var(--ink)]">{brand.name}</h1>
          {brand.website && (
            <span className="font-mono text-sm bg-[var(--surface)] border border-[var(--border)] rounded-full px-3 py-1 flex items-center gap-1.5 text-[var(--dim)]">
              <Globe className="h-3 w-3" />
              {brand.website.replace(/^https?:\/\//, '')}
            </span>
          )}
        </div>
        <Button>
          <Play className="h-4 w-4" />
          Run Analysis
        </Button>
      </motion.div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="journeys">Journeys</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab brand={brand} slug={slug} brandId={brandId} />
        </TabsContent>

        <TabsContent value="pages">
          <PagesTab slug={slug} brandId={brandId} />
        </TabsContent>

        <TabsContent value="journeys">
          <JourneysTab slug={slug} brandId={brandId} />
        </TabsContent>

        <TabsContent value="runs">
          <RunsTab slug={slug} brandId={brandId} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab brand={brand} slug={slug} brandId={brandId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
