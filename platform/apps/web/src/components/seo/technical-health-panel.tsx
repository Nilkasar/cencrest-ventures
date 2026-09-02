"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FileSearch, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import {
  AnalyzeBlockedError,
  NoBrandProfileError,
  listPageSummariesForCrawlJob,
  runSeoAnalysis,
  type PageSummary,
} from "@/data/seo/client";
import type { SeoAnalyzeResult, TechnicalAnalysis } from "@/data/seo/types";
import { CHECK_SEVERITY_BADGE_VARIANT, checkLabel, scoreTone } from "@/data/seo/labels";
import { formatDateTime } from "@/lib/format";

type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "blocked"; message: string }
  | { status: "no_brand" }
  | { status: "error"; message: string }
  | { status: "ready"; result: SeoAnalyzeResult; pages: Map<string, PageSummary> };

const SCORE_TONE_CLASS: Record<ReturnType<typeof scoreTone>, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

function ScoreTile({ label, score, sub }: { label: string; score: number; sub?: string }) {
  const tone = scoreTone(score);
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground">{label}</p>
        <p className={`font-mono text-[28px] font-semibold mt-1 ${SCORE_TONE_CLASS[tone]}`}>{score}</p>
        {sub && <p className="text-[11.5px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex flex-col gap-2">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

function PageRow({ analysis, page }: { analysis: TechnicalAnalysis; page: PageSummary | undefined }) {
  const [open, setOpen] = useState(false);
  const failing = analysis.findings.checks.filter((c) => !c.passed);
  const tone = scoreTone(analysis.score);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface transition-colors duration-150"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={14} className="text-subtle-foreground shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-subtle-foreground shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-foreground truncate">{page?.title || "(untitled)"}</p>
          <p className="font-mono text-[11px] text-subtle-foreground truncate">{page?.url ?? analysis.pageId}</p>
        </div>
        {failing.length > 0 ? (
          <Badge variant="warning" size="sm" className="shrink-0">
            {failing.length} issue{failing.length === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge variant="success" size="sm" className="shrink-0">
            Clean
          </Badge>
        )}
        <span className={`font-mono text-[15px] font-semibold shrink-0 w-9 text-right ${SCORE_TONE_CLASS[tone]}`}>
          {analysis.score}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 pl-[30px]">
          <ul className="flex flex-col gap-1.5">
            {analysis.findings.checks.map((check, i) => (
              <li key={`${check.id}-${i}`} className="flex items-start gap-2 text-[12.5px]">
                {check.passed ? (
                  <Badge variant="outline" size="sm" className="shrink-0 mt-px">
                    Pass
                  </Badge>
                ) : (
                  <Badge variant={check.severity ? CHECK_SEVERITY_BADGE_VARIANT[check.severity] : "outline"} size="sm" className="shrink-0 mt-px">
                    Fail
                  </Badge>
                )}
                <span className="text-foreground">
                  {checkLabel(check.id)}
                  {check.detail && <span className="text-muted-foreground"> — {check.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Technical health score with drill-down to specific page issues, per the
 * epic's UI surface. There is no `GET` history route for `seo_analyses`
 * (only `POST /analyze`, which always computes fresh — see
 * `data/seo/client.ts`'s header) so this panel's "ready" state is whatever
 * the last analyze call in THIS session returned, not a persisted view; a
 * page reload goes back to "idle" until analyze is run again. That is a
 * real gap in the backend's literal API surface, not a frontend shortcut —
 * documented in this epic's completion doc.
 */
export function TechnicalHealthPanel() {
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const [running, setRunning] = useState(false);

  async function handleRun() {
    setRunning(true);
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    try {
      const result = await runSeoAnalysis();
      const pages = await listPageSummariesForCrawlJob(result.crawlJobId);
      setState({ status: "ready", result, pages });
    } catch (err) {
      if (err instanceof NoBrandProfileError) {
        setState({ status: "no_brand" });
      } else if (err instanceof AnalyzeBlockedError) {
        setState({ status: "blocked", message: err.message });
      } else {
        setState({ status: "error", message: err instanceof Error ? err.message : "Couldn't run SEO analysis." });
      }
    } finally {
      setRunning(false);
    }
  }

  const sorted =
    state.status === "ready" ? [...state.result.technicalAnalyses].sort((a, b) => a.score - b.score) : [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Technical health</CardTitle>
          {state.status === "ready" && (
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              Last analyzed {formatDateTime(state.result.contentAnalysis.analyzedAt)}
            </p>
          )}
        </div>
        {(state.status === "ready" || state.status === "error") && (
          <Button variant="outline" size="sm" loading={running} onClick={handleRun}>
            <RefreshCw size={13} /> Re-run analysis
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status === "idle" && (
          <EmptyState
            compact
            icon={<ShieldCheck size={18} />}
            title="Run your first SEO analysis"
            description="Scores every crawled page against the Page Analysis Checklist — title/meta/H1, HTTPS, schema markup, thin content — and rolls up a brand-level content score."
            action={
              <Button variant="primary" size="sm" loading={running} onClick={handleRun}>
                Run analysis
              </Button>
            }
          />
        )}

        {state.status === "loading" && <PanelSkeleton />}

        {state.status === "no_brand" && (
          <EmptyState
            compact
            title="Complete your brand profile first"
            description="SEO Intelligence scores your brand's crawled pages — set up your brand profile in onboarding first."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings">Go to brand profile</Link>
              </Button>
            }
          />
        )}

        {state.status === "blocked" && (
          <EmptyState
            compact
            icon={<FileSearch size={18} />}
            title="Crawl your website first"
            description={state.message}
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/website-intelligence">Go to Website Intelligence</Link>
              </Button>
            }
          />
        )}

        {state.status === "error" && <ErrorPanel compact message={state.message} onRetry={handleRun} />}

        {state.status === "ready" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ScoreTile
                label="Content score"
                score={state.result.contentAnalysis.score}
                sub={`${state.result.contentAnalysis.findings.pagesAnalyzed} pages`}
              />
              <Card>
                <CardContent className="p-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground">Avg word count</p>
                  <p className="font-mono text-[28px] font-semibold text-foreground mt-1">
                    {state.result.contentAnalysis.findings.averageWordCount}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground">Thin-content pages</p>
                  <p className="font-mono text-[28px] font-semibold text-foreground mt-1">
                    {state.result.contentAnalysis.findings.thinContentPages}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground">New issues found</p>
                  <p className="font-mono text-[28px] font-semibold text-foreground mt-1">{state.result.issuesCreated}</p>
                </CardContent>
              </Card>
            </div>

            <div>
              <p className="text-[12px] font-medium text-foreground mb-2">
                Pages ({state.result.pagesAnalyzed}) — worst score first
              </p>
              <div className="rounded-lg border border-border bg-surface-raised overflow-hidden">
                {sorted.map((analysis) => (
                  <PageRow key={analysis.id} analysis={analysis} page={state.pages.get(analysis.pageId)} />
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
