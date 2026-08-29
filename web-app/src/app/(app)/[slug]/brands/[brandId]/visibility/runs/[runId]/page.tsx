'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, ExternalLink, Zap, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { cn, relativeTime } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, SkeletonCard, EmptyState,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui'

// ── Types ──────────────────────────────────────────────────────────────────────

type Intent = 'informational' | 'commercial' | 'transactional'
type Stage = 'Awareness' | 'Consideration' | 'Evaluation' | 'Purchase'
type Provider = 'chatgpt' | 'gemini' | 'claude' | 'perplexity'

interface Citation { url: string; title?: string }

interface ProviderResponse {
  provider: Provider
  response_text: string
  tokens_in: number
  tokens_out: number
  latency_ms: number
  citations: Citation[]
  visibility_score: number
}

interface Query {
  id: string
  text: string
  stage: Stage
  intent: Intent
  responses: ProviderResponse[]
}

interface RunDetail {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  queries_total: number
  providers: Provider[]
  queries: Query[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES: Stage[] = ['Awareness', 'Consideration', 'Evaluation', 'Purchase']

const PROVIDER_META: Record<Provider, { label: string; color: string }> = {
  chatgpt:    { label: 'ChatGPT',    color: '#10A37F' },
  gemini:     { label: 'Gemini',     color: '#4285F4' },
  claude:     { label: 'Claude',     color: '#D4A27F' },
  perplexity: { label: 'Perplexity', color: '#6366F1' },
}

const INTENT_VARIANT: Record<Intent, 'info' | 'warning' | 'success'> = {
  informational: 'info',
  commercial:    'warning',
  transactional: 'success',
}

const STATUS_VARIANT: Record<RunDetail['status'], 'success' | 'danger' | 'info' | 'outline'> = {
  pending:   'outline',
  running:   'info',
  completed: 'success',
  failed:    'danger',
}

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

// ── Word-by-word reveal ───────────────────────────────────────────────────────

function HighlightedResponse({
  text,
  brandName,
  key: animKey,
}: {
  text: string
  brandName: string
  key?: string
}) {
  const words = text.split(' ')
  const lowerBrand = brandName.toLowerCase()

  return (
    <p className="font-sans text-sm text-ink leading-relaxed">
      {words.map((word, i) => {
        const isMatch = word.toLowerCase().includes(lowerBrand)
        return (
          <motion.span
            key={`${animKey ?? ''}-${i}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.02, duration: 0.1 }}
            className={cn(
              'inline-block mr-[0.25em]',
              isMatch && 'font-semibold text-ember'
            )}
          >
            {word}
          </motion.span>
        )
      })}
    </p>
  )
}

// ── Provider tab content ──────────────────────────────────────────────────────

function ProviderTabContent({
  response,
  brandName,
  animKey,
}: {
  response: ProviderResponse
  brandName: string
  animKey: string
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Response text */}
      <AnimatePresence mode="wait">
        <motion.div
          key={animKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <HighlightedResponse text={response.response_text} brandName={brandName} key={animKey} />
        </motion.div>
      </AnimatePresence>

      {/* Metrics row */}
      <div className="flex flex-wrap gap-4 pt-2 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs font-sans text-dim">
          <Zap className="h-3.5 w-3.5" />
          <span>{response.latency_ms}ms</span>
        </div>
        <div className="text-xs font-mono text-dim">
          {response.tokens_in} in / {response.tokens_out} out
        </div>
        <div className="ml-auto">
          <Badge variant="outline" size="sm">
            Score: <span className="font-semibold text-ink ml-1">{Math.round(response.visibility_score)}</span>
          </Badge>
        </div>
      </div>

      {/* Citations */}
      {response.citations.length > 0 && (
        <div>
          <p className="text-xs font-sans font-medium text-dim uppercase tracking-wide mb-2">Citations</p>
          <ul className="flex flex-col gap-1.5">
            {response.citations.map((c, i) => (
              <li key={i}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-sans text-ink hover:text-ember transition-colors truncate"
                >
                  <ExternalLink className="h-3 w-3 shrink-0 text-dim" />
                  {c.title ?? c.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const { slug, brandId, runId } = useParams<{ slug: string; brandId: string; runId: string }>()
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<{ run: RunDetail }>(`/api/orgs/${slug}/brands/${brandId}/runs/${runId}`),
  })

  const run = (data as { run?: RunDetail } | undefined)?.run
  const queries = run?.queries ?? []

  // Derive brand name from URL for highlight — slug may be org, use brand query or fallback
  const brandName = brandId

  const selectedQuery = queries.find((q) => q.id === selectedQueryId) ?? queries[0] ?? null
  const effectiveQueryId = selectedQuery?.id ?? null

  const handleSelect = useCallback((id: string) => {
    setSelectedQueryId(id)
  }, [])

  const grouped = STAGES.reduce<Record<Stage, Query[]>>((acc, stage) => {
    acc[stage] = queries.filter((q) => q.stage === stage)
    return acc
  }, { Awareness: [], Consideration: [], Evaluation: [], Purchase: [] })

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-sm text-dim font-sans">Failed to load run.</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    )
  }

  if (!run) {
    return (
      <EmptyState
        title="Run not found"
        description="This run may have been deleted or doesn't exist."
      />
    )
  }

  const activeProviders = (run.providers ?? []).filter((p) =>
    selectedQuery?.responses?.some((r) => r.provider === p)
  )

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Back link */}
      <div className="mb-4">
        <Link
          href={`/${slug}/brands/${brandId}/visibility/runs`}
          className="inline-flex items-center gap-1.5 text-sm font-sans text-dim hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All runs
        </Link>
      </div>

      {/* Run metadata bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
        className="flex flex-wrap items-center gap-3 mb-6 pb-5 border-b border-border"
      >
        <Badge variant={STATUS_VARIANT[run.status]} size="sm" dot>
          {run.status}
        </Badge>
        <span className="text-sm font-sans text-dim">{relativeTime(run.created_at)}</span>
        <span className="text-sm font-sans text-dim">{run.queries_total ?? queries.length} queries</span>
        <div className="flex items-center gap-1.5">
          {(run.providers ?? []).map((p) => (
            <span
              key={p}
              className="text-xs font-sans px-2 py-0.5 rounded-full border border-border text-dim"
            >
              {PROVIDER_META[p]?.label ?? p}
            </span>
          ))}
        </div>
        <span className="font-mono text-xs text-dim ml-auto">#{run.id.slice(0, 8)}</span>
      </motion.div>

      {queries.length === 0 ? (
        <EmptyState
          title="No queries in this run"
          description="The run completed with no query data."
        />
      ) : (
        <div className="flex gap-6 min-h-0 flex-1">
          {/* Left panel — query list */}
          <motion.aside
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="w-80 shrink-0 flex flex-col gap-4 overflow-y-auto pr-1"
            style={{ maxHeight: 'calc(100vh - 220px)' }}
          >
            {STAGES.map((stage) => {
              const stageQueries = grouped[stage]
              if (stageQueries.length === 0) return null
              return (
                <div key={stage}>
                  <p className="text-xs font-sans font-medium text-dim uppercase tracking-wide mb-2 px-1">
                    {stage}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {stageQueries.map((q) => {
                      const isActive = q.id === effectiveQueryId
                      return (
                        <button
                          key={q.id}
                          onClick={() => handleSelect(q.id)}
                          className={cn(
                            'text-left w-full rounded-md px-3 py-2.5 transition-colors duration-100 relative',
                            'border-l-2',
                            isActive
                              ? 'border-ember bg-surface text-ink'
                              : 'border-transparent hover:bg-surface text-dim hover:text-ink'
                          )}
                        >
                          <p className="text-xs font-sans leading-snug line-clamp-2">{q.text}</p>
                          <div className="mt-1">
                            <Badge variant={INTENT_VARIANT[q.intent]} size="sm">
                              {q.intent}
                            </Badge>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </motion.aside>

          {/* Right panel — response viewer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.35, ease: EASE }}
            className="flex-1 min-w-0"
          >
            {selectedQuery ? (
              <Card className="h-full flex flex-col">
                <div className="px-5 pt-5 pb-3 border-b border-border">
                  <p className="font-sans text-sm font-medium text-ink">{selectedQuery.text}</p>
                  <Badge variant={INTENT_VARIANT[selectedQuery.intent]} size="sm" className="mt-2">
                    {selectedQuery.intent}
                  </Badge>
                </div>

                <CardContent className="flex-1 overflow-y-auto pt-0">
                  {activeProviders.length === 0 ? (
                    <EmptyState
                      title="No responses"
                      description="This query has no provider responses yet."
                    />
                  ) : (
                    <Tabs defaultValue={activeProviders[0]}>
                      <TabsList className="mt-4">
                        {activeProviders.map((p) => (
                          <TabsTrigger key={p} value={p}>
                            <span className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ background: PROVIDER_META[p]?.color }}
                              />
                              {PROVIDER_META[p]?.label ?? p}
                            </span>
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      {activeProviders.map((p) => {
                        const resp = selectedQuery.responses.find((r) => r.provider === p)
                        if (!resp) return null
                        return (
                          <TabsContent key={p} value={p}>
                            <ProviderTabContent
                              response={resp}
                              brandName={brandName}
                              animKey={`${effectiveQueryId}-${p}`}
                            />
                          </TabsContent>
                        )
                      })}
                    </Tabs>
                  )}
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                title="Select a query"
                description="Choose a query from the left to view AI responses."
              />
            )}
          </motion.div>
        </div>
      )}
    </div>
  )
}
