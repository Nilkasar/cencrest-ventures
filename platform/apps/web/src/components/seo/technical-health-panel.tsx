"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, FileSearch, ShieldCheck, UserRoundCog } from "lucide-react";
import { Badge, Button, EmptyState, Skeleton, cn, easings } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { SectionSkeleton } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { SrTable } from "@/components/overview/primitives";
import {
  AnalyzeBlockedError,
  NoBrandProfileError,
  listPageSummariesForCrawlJob,
  runSeoAnalysis,
  type PageSummary,
} from "@/data/seo/client";
import type { SeoAnalyzeResult, TechnicalAnalysis } from "@/data/seo/types";
import { CHECK_SEVERITY_BADGE_VARIANT, checkLabel, scoreTone, type ScoreTone } from "@/data/seo/labels";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { Meter, TONE_FILL, TONE_LABEL, TONE_TEXT } from "./status-badges";

export type SeoAnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "blocked"; message: string }
  | { status: "no_brand" }
  | { status: "error"; message: string }
  | { status: "ready"; result: SeoAnalyzeResult; pages: Map<string, PageSummary> };

/**
 * `POST /brands/me/seo/analyze` — always computes fresh. There is no `GET`
 * history route for `seo_analyses`, so "ready" is whatever the last run in
 * THIS session returned; a reload goes back to "idle". Lifted into a hook
 * so the page header can own the Re-run action.
 */
export function useSeoAnalysis() {
  const [state, setState] = useState<SeoAnalysisState>({ status: "idle" });
  const [running, setRunning] = useState(false);

  async function run() {
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

  return { state, running, run };
}

const TONES: ScoreTone[] = ["success", "warning", "danger"];
const TONE_RANGE: Record<ScoreTone, string> = { success: "80–100", warning: "50–79", danger: "0–49" };
const PAGES_PREVIEW = 10;

/**
 * Technical health — the page's hero. Everything here comes from one
 * analyze response: the brand-level content score with the content
 * findings that produced it, how page scores are distributed, which
 * checks fail most often, and every page worst-first with its checklist
 * one click away. The score always shows its work.
 */
export function TechnicalHealthSections({ state, running, onRun }: { state: SeoAnalysisState; running: boolean; onRun: () => void }) {
  if (state.status === "loading") {
    return (
      <>
        <Reveal>
          <div className="rounded-xl border border-border bg-surface-raised p-5" aria-busy="true">
            <span className="sr-only">Running SEO analysis…</span>
            <div className="flex flex-col gap-6 md:flex-row md:items-center" aria-hidden="true">
              <Skeleton className="size-[148px] shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
        <Reveal className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <SectionSkeleton lines={6} className="lg:col-span-7" />
          <SectionSkeleton lines={5} className="lg:col-span-5" />
        </Reveal>
      </>
    );
  }

  if (state.status !== "ready") {
    return (
      <Section title="Technical health" description="How well your crawled pages meet the Page Analysis Checklist." icon={<ShieldCheck size={14} />}>
        {state.status === "idle" && (
          <EmptyState
            compact
            icon={<ShieldCheck size={18} />}
            title="Run an SEO analysis"
            description="Scores every crawled page for title, meta, H1, HTTPS, schema markup and thin content, then rolls up a brand-level content score. Results aren't saved between visits, so run it whenever you want a fresh read."
            action={
              <Button variant="primary" size="sm" loading={running} onClick={onRun}>
                Run analysis
              </Button>
            }
          />
        )}
        {state.status === "no_brand" && (
          <EmptyState
            compact
            icon={<UserRoundCog size={18} />}
            title="Complete your brand profile first"
            description="The analysis scores your brand's crawled pages, so it needs a brand profile with a website."
            action={
              <Button variant="primary" size="sm" asChild>
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
              <Button variant="primary" size="sm" asChild>
                <Link href="/website-intelligence">Go to Website Intelligence</Link>
              </Button>
            }
          />
        )}
        {state.status === "error" && <ErrorPanel compact title="The analysis didn't finish" message={state.message} onRetry={onRun} />}
      </Section>
    );
  }

  return <ReadyView result={state.result} pages={state.pages} />;
}

function ReadyView({ result, pages }: { result: SeoAnalyzeResult; pages: Map<string, PageSummary> }) {
  const { contentAnalysis } = result;
  const findings = contentAnalysis.findings;
  const [showAllPages, setShowAllPages] = useState(false);

  const sorted = useMemo(() => [...result.technicalAnalyses].sort((a, b) => a.score - b.score), [result.technicalAnalyses]);

  const distribution = useMemo(() => {
    const d: Record<ScoreTone, number> = { success: 0, warning: 0, danger: 0 };
    for (const a of result.technicalAnalyses) d[scoreTone(a.score)]++;
    return d;
  }, [result.technicalAnalyses]);

  const failedChecks = useMemo(() => {
    const map = new Map<string, { id: string; count: number; severity: "low" | "medium" | "high" | null }>();
    for (const a of result.technicalAnalyses) {
      for (const c of a.findings.checks) {
        if (c.passed) continue;
        const row = map.get(c.id) ?? { id: c.id, count: 0, severity: c.severity };
        row.count++;
        map.set(c.id, row);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [result.technicalAnalyses]);

  const analyzed = result.technicalAnalyses.length;
  const schemaPct = findings.pagesAnalyzed > 0 ? (findings.pagesWithSchemaMarkup / findings.pagesAnalyzed) * 100 : null;
  const visiblePages = showAllPages ? sorted : sorted.slice(0, PAGES_PREVIEW);

  return (
    <>
      <Section
        title="Technical health"
        description={`Analyzed ${formatDateTime(contentAnalysis.analyzedAt)} · ${formatNumber(result.pagesAnalyzed)} pages from your latest crawl`}
        icon={<ShieldCheck size={14} />}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-8">
          <ScoreGauge score={contentAnalysis.score} />

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className={typography.eyebrow}>Page scores</p>
                <p className={typography.meta}>{formatNumber(analyzed)} pages</p>
              </div>
              <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                {TONES.map((t, i) =>
                  distribution[t] > 0 ? (
                    <motion.span
                      key={t}
                      className={cn("h-full first:rounded-l-full last:rounded-r-full", TONE_FILL[t])}
                      style={{ width: `${(distribution[t] / Math.max(analyzed, 1)) * 100}%`, originX: 0 }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.6, delay: 0.25 + i * 0.08, ease: easings.emphasized }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {TONES.map((t) => (
                  <li key={t} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className={cn("size-2 rounded-full", TONE_FILL[t])} aria-hidden="true" />
                    <span className="text-foreground">{TONE_LABEL[t]}</span>
                    <span className="font-mono tabular-nums">{TONE_RANGE[t]}</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">· {formatNumber(distribution[t])}</span>
                  </li>
                ))}
              </ul>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4 sm:grid-cols-4">
              <Fact label="Avg word count" value={formatNumber(findings.averageWordCount)} />
              <Fact label="Thin-content pages" value={formatNumber(findings.thinContentPages)} />
              <Fact
                label="Schema markup"
                value={schemaPct !== null ? formatPercent(schemaPct) : "—"}
                hint={`${formatNumber(findings.pagesWithSchemaMarkup)} of ${formatNumber(findings.pagesAnalyzed)} pages`}
              />
              <Fact
                label="New issues logged"
                value={formatNumber(result.issuesCreated)}
                hint={
                  result.issuesCreated > 0 ? (
                    <Link href="/website-intelligence" className="text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                      See them
                    </Link>
                  ) : undefined
                }
              />
            </dl>
          </div>
        </div>
        <SrTable
          caption="Page score distribution"
          head={["Band", "Range", "Pages"]}
          rows={TONES.map((t) => [TONE_LABEL[t], TONE_RANGE[t], distribution[t]])}
        />
      </Section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <Section
          className="lg:col-span-7"
          title="Pages, worst score first"
          description="Open a page to see every check it passed and failed."
          flush
        >
          <ul className="divide-y divide-border">
            {visiblePages.map((analysis) => (
              <PageRow key={analysis.id} analysis={analysis} page={pages.get(analysis.pageId)} />
            ))}
          </ul>
          {sorted.length > PAGES_PREVIEW && (
            <div className="border-t border-border px-5 py-2.5">
              <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setShowAllPages((v) => !v)} aria-expanded={showAllPages}>
                {showAllPages ? "Show fewer pages" : `Show all ${formatNumber(sorted.length)} pages`}
              </Button>
            </div>
          )}
        </Section>

        <Section className="lg:col-span-5" title="Most failed checks" description="Fix the top of this list to lift the most pages at once.">
          {failedChecks.length === 0 ? (
            <EmptyState
              compact
              icon={<ShieldCheck size={18} />}
              title="Every check passed"
              description="No page failed a checklist item in this analysis. Re-run after your next crawl to keep it that way."
            />
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {failedChecks.slice(0, 8).map((c, i) => (
                  <li key={c.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] text-foreground">{checkLabel(c.id)}</span>
                      <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                        <span className="font-medium text-foreground">{formatNumber(c.count)}</span> / {formatNumber(analyzed)}
                      </span>
                    </div>
                    <Meter
                      value={c.count}
                      max={Math.max(analyzed, 1)}
                      delay={0.2 + i * 0.05}
                      fillClassName={c.severity === "high" ? "bg-danger" : c.severity === "medium" ? "bg-warning" : "bg-info"}
                    />
                  </li>
                ))}
              </ul>
              <SrTable
                caption="Checks failed, by number of pages"
                head={["Check", "Pages failing", "Severity"]}
                rows={failedChecks.map((c) => [checkLabel(c.id), c.count, c.severity ?? "—"])}
              />
            </>
          )}
        </Section>
      </div>
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={typography.eyebrow}>{label}</dt>
      <dd className="mt-1 text-[18px] font-semibold tabular-nums leading-none text-foreground">{value}</dd>
      {hint && <dd className="mt-1 text-[11.5px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** 270° arc gauge for the brand-level content score. */
function ScoreGauge({ score }: { score: number }) {
  const tone = scoreTone(score);
  const size = 148;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.75;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const labelId = useId();

  return (
    <figure className="flex shrink-0 flex-col items-center gap-2 self-center" aria-labelledby={labelId}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[135deg]" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className="stroke-surface" strokeDasharray={`${arc} ${circumference}`} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className={tone === "success" ? "stroke-success" : tone === "warning" ? "stroke-warning" : "stroke-danger"}
            strokeDasharray={`${arc} ${circumference}`}
            initial={{ strokeDashoffset: arc }}
            animate={{ strokeDashoffset: arc * (1 - pct) }}
            transition={{ duration: 1.1, delay: 0.15, ease: easings.emphasized }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">{score}</span>
          <span className="mt-1 font-mono text-[11px] text-subtle-foreground">/100</span>
        </div>
      </div>
      <figcaption id={labelId} className="flex flex-col items-center gap-1 text-center">
        <span className={typography.eyebrow}>Content score</span>
        <span className={cn("text-[12.5px] font-medium", TONE_TEXT[tone])}>
          {TONE_LABEL[tone]}
          <span className="sr-only">: {score} out of 100</span>
        </span>
      </figcaption>
    </figure>
  );
}

function PageRow({ analysis, page }: { analysis: TechnicalAnalysis; page: PageSummary | undefined }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const failing = analysis.findings.checks.filter((c) => !c.passed);
  const tone = scoreTone(analysis.score);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-[56px] w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRight
          size={14}
          className={cn("shrink-0 text-subtle-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-foreground">{page?.title || "Untitled page"}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{(page?.url ?? analysis.pageId).replace(/^https?:\/\//, "")}</p>
        </div>
        {failing.length > 0 ? (
          <Badge variant="warning" size="sm" className="hidden shrink-0 sm:inline-flex">
            {failing.length} failing
          </Badge>
        ) : (
          <Badge variant="success" size="sm" className="hidden shrink-0 sm:inline-flex">
            All pass
          </Badge>
        )}
        <span className={cn("w-9 shrink-0 text-right font-mono text-[15px] font-semibold tabular-nums", TONE_TEXT[tone])}>
          {analysis.score}
          <span className="sr-only"> out of 100, {TONE_LABEL[tone]}</span>
        </span>
      </button>
      {open && (
        <div id={panelId} className="border-t border-border bg-surface/50 px-5 py-3 pl-12">
          <ul className="flex flex-col gap-2">
            {[...analysis.findings.checks]
              .sort((a, b) => Number(a.passed) - Number(b.passed))
              .map((check, i) => (
                <li key={`${check.id}-${i}`} className="flex items-start gap-2.5 text-[12.5px]">
                  {check.passed ? (
                    <Badge variant="success" size="sm" className="mt-px w-12 shrink-0 justify-center">
                      Pass
                    </Badge>
                  ) : (
                    <Badge variant={check.severity ? CHECK_SEVERITY_BADGE_VARIANT[check.severity] : "outline"} size="sm" className="mt-px w-12 shrink-0 justify-center">
                      Fail
                    </Badge>
                  )}
                  <span className={check.passed ? "text-muted-foreground" : "text-foreground"}>
                    {checkLabel(check.id)}
                    {check.detail && <span className="text-muted-foreground"> — {check.detail}</span>}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </li>
  );
}
