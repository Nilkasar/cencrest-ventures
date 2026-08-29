'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Upload, Plus, ChevronDown, BarChart2, Layers, AlertTriangle, GitCompare,
  TrendingUp, TrendingDown,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, formatNumber, formatPercent, priorityColor } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal'

// ── Types ──────────────────────────────────────────────────────────────────

interface Keyword extends Record<string, unknown> {
  id: string
  keyword: string
  volume: number
  difficulty: number
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational'
  ranking_position?: number
  cluster_id?: string
}

interface KeywordCluster extends Record<string, unknown> {
  id: string
  name: string
  keyword_count: number
  avg_volume: number
  top_keyword?: string
}

interface GapKeyword extends Record<string, unknown> {
  id: string
  keyword: string
  volume: number
  competitor_name: string
  competitor_ranking: number
  gap_opportunity_score: number
  priority: 'high' | 'medium' | 'low'
}

interface OverlapKeyword extends Record<string, unknown> {
  id: string
  keyword: string
  your_ranking: number
  competitor_name: string
  competitor_ranking: number
  volume: number
}

interface KeywordSummary {
  total: number
  avg_difficulty: number
  tracked: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function intentVariant(intent: string): 'info' | 'warning' | 'success' | 'default' {
  switch (intent) {
    case 'informational': return 'info'
    case 'commercial': return 'warning'
    case 'transactional': return 'success'
    default: return 'default'
  }
}

function difficultyVariant(d: number): 'success' | 'warning' | 'danger' {
  if (d < 40) return 'success'
  if (d < 70) return 'warning'
  return 'danger'
}

function difficultyLabel(d: number) {
  if (d < 40) return 'Low'
  if (d < 70) return 'Medium'
  return 'High'
}

// ── Stat Row ───────────────────────────────────────────────────────────────

function StatRow({ summary, loading }: { summary?: KeywordSummary; loading: boolean }) {
  if (loading) return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
    </div>
  )

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {[
        { label: 'Total Keywords', value: formatNumber(summary?.total ?? 0) },
        { label: 'Tracked', value: formatNumber(summary?.tracked ?? 0) },
      ].map((s) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface border border-border rounded-lg p-4"
        >
          <p className="text-xs text-dim font-sans uppercase tracking-wide mb-1">{s.label}</p>
          <p className="font-display text-2xl font-semibold text-ink">{s.value}</p>
        </motion.div>
      ))}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-surface border border-border rounded-lg p-4"
      >
        <p className="text-xs text-dim font-sans uppercase tracking-wide mb-1">Avg Difficulty</p>
        <div className="flex items-center gap-3">
          <p className="font-display text-2xl font-semibold text-ink">{summary?.avg_difficulty ?? 0}</p>
          <div className="flex-1">
            <Progress value={summary?.avg_difficulty ?? 0} variant={difficultyVariant(summary?.avg_difficulty ?? 0)} />
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Keywords Tab ───────────────────────────────────────────────────────────

function KeywordsTab({ slug, brandId }: { slug: string; brandId: string }) {
  const [search, setSearch] = useState('')
  const [difficulty, setDifficulty] = useState<'all' | 'low' | 'medium' | 'high'>('all')
  const [intent, setIntent] = useState<string>('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newKeyword, setNewKeyword] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data: summary, isLoading: summaryLoading } = useQuery<KeywordSummary>({
    queryKey: ['keywords-summary', slug, brandId],
    queryFn: () => api.get(`${routes.keywords(slug, brandId)}/summary`),
  })

  const { data: keywords = [], isLoading } = useQuery<Keyword[]>({
    queryKey: ['keywords', slug, brandId],
    queryFn: () => api.get(routes.keywords(slug, brandId)),
  })

  const addMutation = useMutation({
    mutationFn: (keyword: string) => api.post(routes.keywords(slug, brandId), { keyword }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keywords', slug, brandId] })
      setNewKeyword('')
      setShowAddModal(false)
    },
  })

  const filtered = keywords.filter((k) => {
    const matchSearch = k.keyword.toLowerCase().includes(search.toLowerCase())
    const matchDiff = difficulty === 'all' || difficultyLabel(k.difficulty).toLowerCase() === difficulty
    const matchIntent = intent === 'all' || k.intent === intent
    return matchSearch && matchDiff && matchIntent
  })

  const columns: Column<Keyword>[] = [
    {
      key: 'keyword',
      header: 'Keyword',
      render: (_, row) => <span className="font-medium text-ink font-sans">{row.keyword}</span>,
    },
    {
      key: 'volume',
      header: 'Volume',
      render: (_, row) => <span className="text-dim">{formatNumber(row.volume)}</span>,
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      render: (_, row) => (
        <div className="flex items-center gap-2 min-w-[120px]">
          <Progress value={row.difficulty} variant={difficultyVariant(row.difficulty)} className="w-16" />
          <span className="text-xs text-dim">{row.difficulty}</span>
        </div>
      ),
    },
    {
      key: 'intent',
      header: 'Intent',
      render: (_, row) => (
        <Badge variant={intentVariant(row.intent)} size="sm">{row.intent}</Badge>
      ),
    },
    {
      key: 'ranking_position',
      header: 'Position',
      render: (_, row) => (
        <span className={cn('font-mono text-sm', row.ranking_position ? 'text-ink' : 'text-dim')}>
          {row.ranking_position ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <div>
      <StatRow summary={summary} loading={summaryLoading} />

      {/* Filter row */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dim" />
          <Input
            placeholder="Search keywords…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border rounded-md p-0.5">
          {(['all', 'low', 'medium', 'high'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={cn(
                'px-3 py-1.5 text-xs font-sans font-medium rounded capitalize transition-colors',
                difficulty === d ? 'bg-ink text-paper' : 'text-dim hover:text-ink'
              )}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border rounded-md p-0.5">
          {(['all', 'informational', 'commercial', 'transactional', 'navigational']).map((i) => (
            <button
              key={i}
              onClick={() => setIntent(i)}
              className={cn(
                'px-3 py-1.5 text-xs font-sans font-medium rounded capitalize transition-colors',
                intent === i ? 'bg-ink text-paper' : 'text-dim hover:text-ink'
              )}
            >
              {i === 'all' ? 'All' : i.slice(0, 4) + '.'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={() => {}} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" /> Import CSV
          </Button>
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Keywords
          </Button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonCard />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          rowKey={(r) => r.id}
          emptyMessage="No keywords match your filters."
          emptyIcon={<Search className="h-6 w-6" />}
        />
      )}

      {/* Add keyword modal */}
      <Modal open={showAddModal} onOpenChange={(o) => !o && setShowAddModal(false)}>
        <ModalContent>
          <ModalHeader><ModalTitle>Add Keyword</ModalTitle></ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                placeholder="Enter keyword…"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newKeyword && addMutation.mutate(newKeyword)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button
                  disabled={!newKeyword || addMutation.isPending}
                  onClick={() => addMutation.mutate(newKeyword)}
                >
                  {addMutation.isPending ? 'Adding…' : 'Add'}
                </Button>
              </div>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  )
}

// ── Clusters Tab ───────────────────────────────────────────────────────────

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06 } }),
}

function ClustersTab({ slug, brandId }: { slug: string; brandId: string }) {
  const [showModal, setShowModal] = useState(false)
  const [clusterName, setClusterName] = useState('')

  const { data: clusters = [], isLoading } = useQuery<KeywordCluster[]>({
    queryKey: ['clusters', slug, brandId],
    queryFn: () => api.get(`${routes.keywords(slug, brandId)}/clusters`),
  })

  if (isLoading) return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
    </div>
  )

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Create Cluster
        </Button>
      </div>
      {clusters.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-6 w-6" />}
          title="No clusters yet"
          description="Group keywords into clusters to track topical authority."
          action={<Button size="sm" onClick={() => setShowModal(true)}>Create Cluster</Button>}
        />
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          initial="hidden"
          animate="visible"
        >
          {clusters.map((c, i) => (
            <motion.div key={c.id} custom={i} variants={cardVariants}>
              <Card className="hover:border-ember/50 transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="text-sm font-sans">{c.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-display text-2xl font-semibold text-ink">{c.keyword_count}</p>
                      <p className="text-xs text-dim">keywords</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg font-medium text-ink">{formatNumber(c.avg_volume)}</p>
                      <p className="text-xs text-dim">avg volume</p>
                    </div>
                  </div>
                  {c.top_keyword && (
                    <p className="text-xs text-dim mt-3 truncate">Top: {c.top_keyword}</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Modal open={showModal} onOpenChange={(o) => !o && setShowModal(false)}>
        <ModalContent>
          <ModalHeader><ModalTitle>Create Cluster</ModalTitle></ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                placeholder="Cluster name…"
                value={clusterName}
                onChange={(e) => setClusterName(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button disabled={!clusterName}>Create</Button>
              </div>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  )
}

// ── Gaps Tab ───────────────────────────────────────────────────────────────

function GapsTab({ slug, brandId }: { slug: string; brandId: string }) {
  const { data: gaps = [], isLoading } = useQuery<GapKeyword[]>({
    queryKey: ['keyword-gaps', slug, brandId],
    queryFn: () => api.get(`${routes.keywords(slug, brandId)}/gaps`),
  })

  const columns: Column<GapKeyword>[] = [
    {
      key: 'keyword',
      header: 'Keyword',
      render: (_, row) => <span className="font-medium text-ink">{row.keyword}</span>,
    },
    {
      key: 'volume',
      header: 'Volume',
      render: (_, row) => <span className="text-dim">{formatNumber(row.volume)}</span>,
    },
    {
      key: 'competitor_name',
      header: 'Competitor',
      render: (_, row) => <span className="text-dim">{row.competitor_name}</span>,
    },
    {
      key: 'competitor_ranking',
      header: 'Comp. Rank',
      render: (_, row) => <span className="font-mono text-sm text-ink">#{row.competitor_ranking}</span>,
    },
    {
      key: 'gap_opportunity_score',
      header: 'Opportunity',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <Progress value={row.gap_opportunity_score} className="w-16" />
          <span className="text-xs text-dim">{row.gap_opportunity_score}</span>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (_, row) => (
        <Badge
          variant={row.priority === 'high' ? 'danger' : row.priority === 'medium' ? 'warning' : 'default'}
          size="sm"
          dot
        >
          {row.priority}
        </Badge>
      ),
    },
  ]

  if (isLoading) return <SkeletonCard />

  return gaps.length === 0 ? (
    <EmptyState
      icon={<AlertTriangle className="h-6 w-6" />}
      title="No keyword gaps found"
      description="Your brand is ranking for all the keywords your competitors rank for."
    />
  ) : (
    <DataTable data={gaps} columns={columns} rowKey={(r) => r.id} />
  )
}

// ── Competitor Overlap Tab ─────────────────────────────────────────────────

function OverlapTab({ slug, brandId }: { slug: string; brandId: string }) {
  const { data: overlap = [], isLoading } = useQuery<OverlapKeyword[]>({
    queryKey: ['keyword-overlap', slug, brandId],
    queryFn: () => api.get(`${routes.keywords(slug, brandId)}/competitor-overlap`),
  })

  const columns: Column<OverlapKeyword>[] = [
    {
      key: 'keyword',
      header: 'Keyword',
      render: (_, row) => <span className="font-medium text-ink">{row.keyword}</span>,
    },
    {
      key: 'your_ranking',
      header: 'Your Rank',
      render: (_, row) => (
        <span className="font-mono text-sm font-semibold text-ember">#{row.your_ranking}</span>
      ),
    },
    {
      key: 'competitor_name',
      header: 'Competitor',
      render: (_, row) => <span className="text-dim">{row.competitor_name}</span>,
    },
    {
      key: 'competitor_ranking',
      header: 'Comp. Rank',
      render: (_, row) => <span className="font-mono text-sm text-ink">#{row.competitor_ranking}</span>,
    },
    {
      key: 'volume',
      header: 'Volume',
      render: (_, row) => <span className="text-dim">{formatNumber(row.volume)}</span>,
    },
    {
      key: 'action',
      header: '',
      render: (_, row) => (
        <Button variant="outline" size="sm">
          {row.your_ranking < row.competitor_ranking ? (
            <><TrendingUp className="h-3 w-3 mr-1 text-success" /> Ahead</>
          ) : (
            <><TrendingDown className="h-3 w-3 mr-1 text-danger" /> Defend</>
          )}
        </Button>
      ),
    },
  ]

  if (isLoading) return <SkeletonCard />

  return overlap.length === 0 ? (
    <EmptyState
      icon={<GitCompare className="h-6 w-6" />}
      title="No overlapping keywords"
      description="No shared keywords with tracked competitors."
    />
  ) : (
    <DataTable data={overlap} columns={columns} rowKey={(r) => r.id} />
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function SEOPage() {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-ember/10 flex items-center justify-center">
          <BarChart2 className="h-5 w-5 text-ember" />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">SEO Intelligence</h1>
          <p className="text-sm text-dim font-sans">Keyword tracking, clusters, gaps & competitive overlap</p>
        </div>
      </div>

      <Tabs defaultValue="keywords">
        <TabsList>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="clusters">Clusters</TabsTrigger>
          <TabsTrigger value="gaps">Gaps</TabsTrigger>
          <TabsTrigger value="overlap">Competitor Overlap</TabsTrigger>
        </TabsList>

        <TabsContent value="keywords">
          <KeywordsTab slug={slug} brandId={brandId} />
        </TabsContent>

        <TabsContent value="clusters">
          <ClustersTab slug={slug} brandId={brandId} />
        </TabsContent>

        <TabsContent value="gaps">
          <GapsTab slug={slug} brandId={brandId} />
        </TabsContent>

        <TabsContent value="overlap">
          <OverlapTab slug={slug} brandId={brandId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
