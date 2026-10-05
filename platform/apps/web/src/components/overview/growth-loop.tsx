"use client";

import { motion } from "framer-motion";
import { Workflow } from "lucide-react";
import { cn, easings } from "@bebest/ui";
import type { AsyncState } from "@/lib/use-async-data";
import type { ActionsOverview } from "@/data/actions/types";
import type { MeasurementsListResponse } from "@/data/measurement/types";
import type { OpportunityStatus } from "@/data/opportunities/types";
import { r2 } from "./chart-math";
import { AnimatedNumber, Panel, PanelEmpty, PanelSkeleton, SrTable, useOffscreenPause } from "./primitives";

/**
 * "What have I done and what happened?" as one picture — the product's own
 * loop, left to right: Opportunities found -> Recommendations generated ->
 * Actions taken -> Results measured. Every column is a real server count:
 *
 *   Opportunities    `GET /brands/me/opportunities?status=…` totals
 *   Recommendations  `GET /brands/me/recommendations?status=…` totals
 *   Actions          `GET /brands/me/actions` section lengths
 *   Measured         `GET /brands/me/measurements` total
 *
 * Each column is a stacked bar of its real status mix; the bands between
 * columns are connectors, not a claim of item-level lineage (the API gives
 * stage totals, not per-item paths), so they're drawn as soft funnels with
 * particles drifting through — a stage with nothing in it breaks the band.
 * The bands are the only continuous motion here, CSS-only, paused
 * offscreen.
 */

type Loadable<T> = AsyncState<T> & { reload: () => void };
type Counts = Record<OpportunityStatus, number>;

interface Segment {
  key: string;
  label: string;
  value: number;
  className: string;
}

interface Stage {
  name: string;
  verb: string;
  segments: Segment[] | null; // null = couldn't load
}

const VB_W = 1000;
const VB_H = 220;
const MID = VB_H / 2;
const BAR_W = 16;
const MAX_H = 190;
const CENTERS = [125, 375, 625, 875];

export function GrowthLoop({
  oppCounts,
  recCounts,
  actions,
  measurements,
}: {
  oppCounts: Loadable<Counts>;
  recCounts: Loadable<Counts>;
  actions: Loadable<ActionsOverview>;
  measurements: Loadable<MeasurementsListResponse>;
}) {
  const loading = [oppCounts, recCounts, actions, measurements].some((s) => s.status === "loading");
  const anyError = [oppCounts, recCounts, actions, measurements].some((s) => s.status === "error");

  return (
    <Panel eyebrow="Growth loop" title="From finding to proof" icon={<Workflow size={14} />} href="/actions" hrefLabel="Action Center">
      {loading ? (
        <PanelSkeleton height={280} />
      ) : (
        <Loop
          stages={[
            {
              name: "Opportunities",
              verb: "found",
              segments:
                oppCounts.status === "success"
                  ? [
                      { key: "new", label: "new", value: oppCounts.data.new, className: "fill-accent bg-accent" },
                      { key: "in_progress", label: "in progress", value: oppCounts.data.in_progress, className: "fill-info bg-info" },
                      { key: "completed", label: "done", value: oppCounts.data.completed, className: "fill-success bg-success" },
                    ]
                  : null,
            },
            {
              name: "Recommendations",
              verb: "generated",
              segments:
                recCounts.status === "success"
                  ? [
                      { key: "new", label: "new", value: recCounts.data.new, className: "fill-accent bg-accent" },
                      { key: "in_progress", label: "in progress", value: recCounts.data.in_progress, className: "fill-info bg-info" },
                      { key: "completed", label: "done", value: recCounts.data.completed, className: "fill-success bg-success" },
                    ]
                  : null,
            },
            {
              name: "Actions",
              verb: "taken",
              segments:
                actions.status === "success"
                  ? [
                      { key: "pending", label: "awaiting you", value: actions.data.pending.length, className: "fill-warning bg-warning" },
                      { key: "approved", label: "approved", value: actions.data.inProgress.length, className: "fill-info bg-info" },
                      { key: "completed", label: "shipped", value: actions.data.completed.length, className: "fill-success bg-success" },
                      { key: "rolled_back", label: "rolled back", value: actions.data.rolledBack.length, className: "fill-border-strong bg-border-strong" },
                    ]
                  : null,
            },
            {
              name: "Measured",
              verb: "proven",
              segments:
                measurements.status === "success"
                  ? [{ key: "measured", label: "before/after", value: measurements.data.total, className: "fill-accent bg-accent" }]
                  : null,
            },
          ]}
          anyError={anyError}
          onRetry={() => [oppCounts, recCounts, actions, measurements].forEach((s) => s.status === "error" && s.reload())}
        />
      )}
    </Panel>
  );
}

function Loop({ stages, anyError, onRetry }: { stages: Stage[]; anyError: boolean; onRetry: () => void }) {
  const { ref, paused } = useOffscreenPause<HTMLDivElement>();
  const totals = stages.map((s) => (s.segments ? s.segments.reduce((a, x) => a + x.value, 0) : null));
  const known = totals.filter((t): t is number => t !== null);
  const max = Math.max(1, ...known);

  if (!anyError && known.every((t) => t === 0)) {
    return (
      <PanelEmpty
        icon={<Workflow size={16} />}
        height={240}
        title="Your growth loop starts with opportunities"
        body="Once your baseline lands, recompute opportunities — each one can become a recommendation, an approved action, and a measured result."
        action={{ href: "/opportunities", label: "Open Opportunities" }}
      />
    );
  }

  // sqrt keeps a 3-item stage visible next to a 300-item one without lying
  // about order; the exact counts are always printed above each bar.
  const hFor = (t: number) => (t <= 0 ? 0 : Math.max(8, (Math.sqrt(t) / Math.sqrt(max)) * MAX_H));
  const heights = totals.map((t) => (t === null ? 0 : hFor(t)));

  return (
    <div ref={ref} data-paused={paused} className="flex flex-col gap-2">
      {/* Column headers */}
      <div className="grid grid-cols-4 gap-2">
        {stages.map((s, i) => (
          <div key={s.name} className="flex flex-col items-center text-center min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground truncate max-w-full">{s.name}</p>
            <p className="text-[24px] @3xl:text-[30px] font-semibold leading-tight text-foreground tracking-[-0.02em]">
              {totals[i] === null ? <span className="text-subtle-foreground">—</span> : <AnimatedNumber value={totals[i]!} />}
            </p>
            <p className="text-[11px] text-muted-foreground">{totals[i] === null ? "couldn’t load" : s.verb}</p>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="w-full h-[180px] @3xl:h-[220px]" aria-hidden="true">
        <defs>
          <linearGradient id="ov-band" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.22 }} />
            <stop offset="50%" style={{ stopColor: "var(--accent)", stopOpacity: 0.08 }} />
            <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0.2 }} />
          </linearGradient>
        </defs>

        {/* centre rail */}
        <line x1={CENTERS[0]} x2={CENTERS[3]} y1={MID} y2={MID} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {/* bands */}
        {[0, 1, 2].map((i) => {
          const a = heights[i]!;
          const b = heights[i + 1]!;
          const x0 = CENTERS[i]! + BAR_W / 2;
          const x1 = CENTERS[i + 1]! - BAR_W / 2;
          if (a === 0 || b === 0) {
            return <line key={i} x1={x0} x2={x1} y1={MID} y2={MID} className="stroke-border-strong" strokeDasharray="4 6" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          }
          const cx = (x0 + x1) / 2;
          const d = `M${x0} ${r2(MID - a / 2)} C ${cx} ${r2(MID - a / 2)}, ${cx} ${r2(MID - b / 2)}, ${x1} ${r2(MID - b / 2)} L ${x1} ${r2(MID + b / 2)} C ${cx} ${r2(MID + b / 2)}, ${cx} ${r2(MID + a / 2)}, ${x0} ${r2(MID + a / 2)} Z`;
          const lanes = [-0.28, 0, 0.28];
          return (
            <g key={i}>
              <motion.path
                d={d}
                fill="url(#ov-band)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5 + i * 0.15, ease: easings.decelerate }}
              />
              {lanes.map((k, j) => {
                const ya = r2(MID + a * k);
                const yb = r2(MID + b * k);
                return (
                  <path
                    key={j}
                    d={`M${x0} ${ya} C ${cx} ${ya}, ${cx} ${yb}, ${x1} ${yb}`}
                    pathLength={155}
                    fill="none"
                    className="ov-flow"
                    style={{ stroke: "var(--accent)", ["--ov-dur" as string]: `${5 + j * 1.3}s`, animationDelay: `${-j * 1.7}s` }}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.75}
                  />
                );
              })}
            </g>
          );
        })}

        {/* stacked stage bars */}
        {stages.map((s, i) => {
          const h = heights[i]!;
          const total = totals[i];
          const x = CENTERS[i]! - BAR_W / 2;
          if (!s.segments || !total) {
            return <rect key={s.name} x={x} y={MID - 3} width={BAR_W} height={6} rx={3} className="fill-border" />;
          }
          const visible = s.segments.filter((seg) => seg.value > 0);
          const gap = 2;
          const usable = Math.max(h - gap * (visible.length - 1), visible.length);
          let y = MID - h / 2;
          return (
            <motion.g
              key={s.name}
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.15 + i * 0.12, ease: easings.emphasized }}
              style={{ transformOrigin: `${CENTERS[i]}px ${MID}px` }}
            >
              {visible.map((seg) => {
                const sh = Math.max((seg.value / total) * usable, 1);
                const rect = <rect key={seg.key} x={x} y={r2(y)} width={BAR_W} height={r2(sh)} rx={3} className={seg.className.split(" ")[0]} />;
                y += sh + gap;
                return rect;
              })}
            </motion.g>
          );
        })}
      </svg>

      {/* Status legends under each column */}
      <div className="grid grid-cols-4 gap-2">
        {stages.map((s) => (
          <ul key={s.name} className="flex flex-col items-center gap-0.5 min-w-0">
            {s.segments?.map((seg) => (
              <li key={seg.key} className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0", seg.value === 0 && "opacity-50")}>
                <span className={cn("size-1.5 rounded-full shrink-0", seg.className.split(" ")[1])} aria-hidden="true" />
                <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {seg.value}
                </span>
                <span className="truncate hidden @2xl:inline">{seg.label}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>

      {anyError && (
        <button type="button" onClick={onRetry} className="self-center mt-1 h-9 rounded-md px-3 text-[12px] font-medium text-accent hover:bg-accent-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Some stages couldn’t load — try again
        </button>
      )}

      <SrTable
        caption="Growth loop: counts by stage and status"
        head={["Stage", "Total", "Breakdown"]}
        rows={stages.map((s, i) => [
          s.name,
          totals[i] === null ? "unavailable" : totals[i]!,
          s.segments ? s.segments.map((seg) => `${seg.value} ${seg.label}`).join(", ") : "unavailable",
        ])}
      />
    </div>
  );
}
