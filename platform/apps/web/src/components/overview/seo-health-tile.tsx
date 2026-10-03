"use client";

import { motion } from "framer-motion";
import { Globe } from "lucide-react";
import { easings } from "@bebest/ui";
import { useAsyncData, type AsyncState } from "@/lib/use-async-data";
import { getLatestCrawlJob, getPageIssues } from "@/data/website/client";
import type { IssueSeverity } from "@/data/website/types";
import type { MeasurementsListResponse, SeoScoreComponent } from "@/data/measurement/types";
import { formatRelativeTime } from "@/lib/format";
import { AnimatedNumber, Panel, PanelEmpty, PanelError, PanelSkeleton, SrTable } from "./primitives";

/**
 * "Can AI (and search) read my site?" — the technical half of SEO health.
 *
 *   - Issues by severity from the latest COMPLETED crawl
 *     (`GET /brands/me/crawl-jobs` + `GET /brands/me/pages`, the same
 *     client Website Intelligence uses), drawn as a severity ring.
 *   - The SEO Health Score, only where one was actually persisted: the API
 *     has no read route for `seo_analyses` (see the SEO Intelligence
 *     screen's own note), but every measured action snapshots the SEO
 *     component it compared against (`measurements.after_score.seo`). The
 *     most recent such snapshot is shown with its own timestamp — never a
 *     fresh `/analyze` POST fired just because someone opened a dashboard.
 */

const SEVERITY: { key: IssueSeverity; label: string; className: string; dot: string }[] = [
  { key: "high", label: "High", className: "stroke-danger", dot: "bg-danger" },
  { key: "medium", label: "Medium", className: "stroke-warning", dot: "bg-warning" },
  { key: "low", label: "Low", className: "stroke-info", dot: "bg-info" },
];

export function SeoHealthTile({
  measurements,
  className,
}: {
  measurements: AsyncState<MeasurementsListResponse>;
  className?: string;
}) {
  const state = useAsyncData(async () => {
    const job = await getLatestCrawlJob();
    if (!job) return { job: null, issues: null };
    if (job.status !== "completed") return { job, issues: null };
    return { job, issues: await getPageIssues(job.id) };
  }, []);

  const seo: SeoScoreComponent | null =
    measurements.status === "success"
      ? (measurements.data.items.map((m) => m.afterScore.seo ?? m.beforeScore.seo).find((s): s is SeoScoreComponent => s !== null) ?? null)
      : null;

  const crawling = state.status === "success" && state.data.job && (state.data.job.status === "running" || state.data.job.status === "queued");

  return (
    <Panel eyebrow="Site health" title="Technical SEO" icon={<Globe size={14} />} href="/website-intelligence" hrefLabel="Issues" live={!!crawling} className={className}>
      {state.status === "loading" && <PanelSkeleton height={290} />}
      {state.status === "error" && <PanelError onRetry={state.reload} height={290} />}
      {state.status === "success" && !state.data.job && (
        <PanelEmpty
          icon={<Globe size={16} />}
          height={290}
          title="Your site hasn’t been crawled"
          body="A crawl (about 10–15 minutes) checks every page AI and search engines read. Start one to see your issues here."
          action={{ href: "/website-intelligence", label: "Start a crawl" }}
        />
      )}
      {state.status === "success" && state.data.job && !state.data.issues && (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-6 min-h-[290px]">
          <p className="text-[13.5px] font-medium text-foreground">
            {crawling ? "Crawl in progress" : state.data.job.status === "failed" ? "Latest crawl failed" : "Crawl cancelled"}
          </p>
          <p className="text-[12.5px] text-muted-foreground max-w-[34ch]">
            {crawling
              ? `${state.data.job.pagesCrawled} of ${state.data.job.pagesFound || "?"} pages crawled so far. Issues appear when it completes.`
              : (state.data.job.error ?? "Open Website Intelligence to start a fresh crawl.")}
          </p>
        </div>
      )}
      {state.status === "success" && state.data.job && state.data.issues && (
        <Ring
          bySeverity={state.data.issues.bySeverity}
          pages={state.data.job.pagesCrawled}
          completedAt={state.data.job.completedAt}
          seo={seo}
        />
      )}
    </Panel>
  );
}

function Ring({
  bySeverity,
  pages,
  completedAt,
  seo,
}: {
  bySeverity: Record<IssueSeverity, number>;
  pages: number;
  completedAt: string | null;
  seo: SeoScoreComponent | null;
}) {
  const total = bySeverity.high + bySeverity.medium + bySeverity.low;
  const C = 2 * Math.PI * 44;
  const GAP = total > 0 ? 3 : 0;
  let offset = 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-5">
        <div className="relative size-[132px] shrink-0">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={`${total} issues across ${pages} pages: ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low severity.`}>
            <circle cx={60} cy={60} r={44} fill="none" className="stroke-surface" strokeWidth={10} />
            {total === 0 ? (
              <motion.circle cx={60} cy={60} r={44} fill="none" className="stroke-success" strokeWidth={10} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: easings.emphasized }} />
            ) : (
              SEVERITY.filter((s) => bySeverity[s.key] > 0).map((s, i) => {
                const len = Math.max((bySeverity[s.key] / total) * C - GAP, 1);
                const el = (
                  <motion.circle
                    key={s.key}
                    cx={60}
                    cy={60}
                    r={44}
                    fill="none"
                    className={s.className}
                    strokeWidth={10}
                    strokeLinecap="butt"
                    strokeDashoffset={-offset}
                    initial={{ strokeDasharray: `0 ${C}` }}
                    animate={{ strokeDasharray: `${len} ${C}` }}
                    transition={{ duration: 0.9, delay: 0.2 + i * 0.2, ease: easings.emphasized }}
                  />
                );
                offset += len + GAP;
                return el;
              })
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <AnimatedNumber value={total} className="text-[26px] font-semibold leading-none text-foreground" />
            <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-subtle-foreground">issues</span>
          </div>
        </div>
        <ul className="flex flex-col gap-2 min-w-0">
          {SEVERITY.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-[12.5px]">
              <span className={`size-2 rounded-full ${s.dot}`} aria-hidden="true" />
              <span className="text-muted-foreground w-14">{s.label}</span>
              <span className="font-mono font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                {bySeverity[s.key]}
              </span>
            </li>
          ))}
          <li className="text-[11.5px] text-subtle-foreground pt-1">
            {pages} pages{completedAt ? ` · crawled ${formatRelativeTime(completedAt)}` : ""}
          </li>
        </ul>
      </div>

      <div className="rounded-lg bg-surface px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground">SEO Health Score</p>
          {seo && <p className="font-mono text-[10px] text-subtle-foreground">measured {formatRelativeTime(seo.measuredAt)}</p>}
        </div>
        {seo ? (
          <div className="mt-1.5 flex items-center gap-3">
            <p className="text-[20px] font-semibold text-foreground leading-none">
              <AnimatedNumber value={seo.overallScore} format={(v) => v.toFixed(0)} />
              <span className="text-[12px] font-normal text-subtle-foreground">/100</span>
            </p>
            <div className="flex-1 h-1.5 rounded-full bg-surface-raised overflow-hidden">
              <motion.div className="h-full rounded-full bg-accent origin-left" initial={{ scaleX: 0 }} animate={{ scaleX: seo.overallScore / 100 }} transition={{ duration: 1, ease: easings.emphasized }} />
            </div>
          </div>
        ) : (
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">Run the Page Analysis Checklist in SEO Intelligence to score it.</p>
        )}
      </div>

      <SrTable caption="Site issues by severity" head={["Severity", "Issues"]} rows={SEVERITY.map((s) => [s.label, bySeverity[s.key]])} />
    </div>
  );
}
