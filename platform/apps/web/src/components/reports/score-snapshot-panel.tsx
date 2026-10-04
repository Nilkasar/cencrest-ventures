"use client";

import { motion } from "framer-motion";
import { easings } from "@bebest/ui";
import { SCORE_COMPONENT_LABEL } from "@/data/ai-visibility/labels";
import type { ScoreComponentKey } from "@/data/ai-visibility/types";
import type { ScoreSnapshot } from "@/data/reporting/types";
import { SrTable } from "@/components/overview/primitives";
import { formatDate, formatDelta } from "@/lib/format";

const COMPONENT_ORDER: ScoreComponentKey[] = ["mentionScore", "recommendationScore", "positionScore", "coverageScore"];

interface Row {
  label: string;
  before: number | null;
  after: number | null;
  strong?: boolean;
}

/**
 * Baseline vs current, component by component — the "show your work"
 * half of a baseline comparison. Each score (the composite, its four GEO
 * components, and SEO's technical/content split) is a pair of bars on a
 * shared 0–100 scale: muted for the baseline, accent for today (the "you"
 * series). Missing sides render "—", never a misleading 0. Ships a
 * visually hidden table with the same numbers.
 */
export function ScoreComparison({ baseline, current }: { baseline: ScoreSnapshot; current: ScoreSnapshot }) {
  const geoRows: Row[] =
    baseline.geo || current.geo
      ? [
          { label: "AI Visibility Score", before: baseline.geo?.aiVisibilityScore ?? null, after: current.geo?.aiVisibilityScore ?? null, strong: true },
          ...COMPONENT_ORDER.map((key) => ({
            label: SCORE_COMPONENT_LABEL[key],
            before: baseline.geo ? baseline.geo[key] : null,
            after: current.geo ? current.geo[key] : null,
          })),
        ]
      : [];
  const seoRows: Row[] =
    baseline.seo || current.seo
      ? [
          { label: "SEO Health Score", before: baseline.seo?.overallScore ?? null, after: current.seo?.overallScore ?? null, strong: true },
          { label: "Technical", before: baseline.seo?.technicalScore ?? null, after: current.seo?.technicalScore ?? null },
          { label: "Content", before: baseline.seo?.contentScore ?? null, after: current.seo?.contentScore ?? null },
        ]
      : [];

  if (geoRows.length === 0 && seoRows.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No score data was captured at either point in time.</p>;
  }

  const versions = [
    baseline.geo && current.geo && baseline.geo.formulaVersion !== current.geo.formulaVersion
      ? `AI Visibility formula v${baseline.geo.formulaVersion} → v${current.geo.formulaVersion}`
      : current.geo
        ? `AI Visibility formula v${current.geo.formulaVersion}`
        : null,
    current.seo ? `SEO formula v${current.seo.formulaVersion} · ${current.seo.pagesAnalyzed} pages analyzed now` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-muted-foreground/40" /> Baseline · {formatDate(baseline.capturedAt)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-accent" /> Now · {formatDate(current.capturedAt)}
        </span>
      </div>

      {[geoRows, seoRows]
        .filter((rows) => rows.length > 0)
        .map((rows) => (
          <dl key={rows[0]!.label} className="flex flex-col gap-3.5">
            {rows.map((row, i) => (
              <ComparisonRow key={row.label} row={row} index={i} />
            ))}
          </dl>
        ))}

      {versions.length > 0 && <p className="font-mono text-[11px] text-subtle-foreground">{versions.join(" · ")}</p>}

      <SrTable
        caption="Scores at baseline and now"
        head={["Score", "Baseline", "Now", "Change"]}
        rows={[...geoRows, ...seoRows].map((r) => [
          r.label,
          r.before !== null ? r.before.toFixed(1) : "—",
          r.after !== null ? r.after.toFixed(1) : "—",
          r.before !== null && r.after !== null ? formatDelta(r.after - r.before, 1) : "—",
        ])}
      />
    </div>
  );
}

function ComparisonRow({ row, index }: { row: Row; index: number }) {
  const delta = row.before !== null && row.after !== null ? row.after - row.before : null;
  const tone = delta === null || Math.abs(delta) < 0.05 ? "text-muted-foreground" : delta > 0 ? "text-success" : "text-danger";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[170px_minmax(0,1fr)_120px]" aria-hidden="true">
      <dt className={row.strong ? "text-[13px] font-medium text-foreground" : "text-[12.5px] text-muted-foreground"}>{row.label}</dt>
      <dd className="col-span-2 row-start-2 flex flex-col gap-1 sm:col-span-1 sm:row-start-auto">
        <Bar value={row.before} className="bg-muted-foreground/40" index={index} />
        <Bar value={row.after} className="bg-accent" index={index} delay={0.08} />
      </dd>
      <dd className="flex items-baseline justify-end gap-2 font-mono text-[12.5px] tabular-nums">
        <span className="text-muted-foreground">{row.before !== null ? row.before.toFixed(1) : "—"}</span>
        <span className="text-subtle-foreground">→</span>
        <span className="font-semibold text-foreground">{row.after !== null ? row.after.toFixed(1) : "—"}</span>
        <span className={`w-11 text-right ${tone}`}>{delta !== null ? formatDelta(delta, 1) : ""}</span>
      </dd>
    </div>
  );
}

function Bar({ value, className, index, delay = 0 }: { value: number | null; className: string; index: number; delay?: number }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
      {value !== null && (
        <motion.div
          className={`h-full rounded-full ${className}`}
          style={{ width: `${pct}%`, transformOrigin: "left center" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, delay: 0.1 + index * 0.05 + delay, ease: easings.emphasized }}
        />
      )}
    </div>
  );
}
