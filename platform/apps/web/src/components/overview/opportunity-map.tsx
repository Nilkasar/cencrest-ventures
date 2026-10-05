"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "framer-motion";
import { Target } from "lucide-react";
import { Badge, cn, easings } from "@bebest/ui";
import { useAsyncData } from "@/lib/use-async-data";
import { listOpportunities } from "@/data/opportunities/client";
import type { Opportunity } from "@/data/opportunities/types";
import { OPPORTUNITY_TYPE_BADGE_VARIANT, OPPORTUNITY_TYPE_LABEL } from "@/data/opportunities/labels";
import { linearScale, r2 } from "./chart-math";
import { Panel, PanelEmpty, PanelError, PanelSkeleton, SrTable } from "./primitives";

/**
 * "What should I do next?" as a map — every open opportunity (new + in
 * progress, the API's own top-by-`opportunityScore` ordering) placed by its
 * real `impactScore` (up) against its real `effortScore` (right). The
 * top-left quadrant is where quick wins live. Dot size is the composite
 * `opportunityScore`; dot strength is priority (P1 solid -> P3 faint), a
 * single-hue ordinal ramp so colour never competes with position.
 *
 * Hover or arrow-key through the dots for the tooltip; Enter (or click)
 * opens Opportunities. The top three are also listed as plain links below
 * the plot, and the full plotted set is in a visually hidden table.
 */

const H = 260;
const M = { top: 12, right: 12, bottom: 28, left: 34 };
const PRIORITY_OPACITY = { 1: 0.92, 2: 0.58, 3: 0.3 } as const;

export function OpportunityMap({ className }: { className?: string }) {
  const state = useAsyncData(async () => {
    const [fresh, doing] = await Promise.all([listOpportunities({ status: "new", limit: 60 }), listOpportunities({ status: "in_progress", limit: 40 })]);
    const items = [...fresh.opportunities, ...doing.opportunities].sort((a, b) => b.opportunityScore - a.opportunityScore);
    return { items, total: fresh.pagination.total + doing.pagination.total };
  }, []);

  return (
    <Panel eyebrow="Opportunities" title="Impact vs. effort" icon={<Target size={14} />} href="/opportunities" hrefLabel="All" className={className}>
      {state.status === "loading" && <PanelSkeleton height={340} />}
      {state.status === "error" && <PanelError onRetry={state.reload} height={340} />}
      {state.status === "success" &&
        (state.data.items.length === 0 ? (
          <PanelEmpty
            icon={<Target size={16} />}
            height={340}
            title="No open opportunities"
            body="We’re still analyzing your brand. Recompute once your baseline is ready, or add more competitors to find more gaps."
            action={{ href: "/opportunities", label: "Open Opportunities" }}
          />
        ) : (
          <Scatter items={state.data.items} total={state.data.total} />
        ))}
    </Panel>
  );
}

function Scatter({ items, total }: { items: Opportunity[]; total: number }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => {
    if (!width) return [];
    const x = linearScale(0, 100, M.left, width - M.right);
    const y = linearScale(0, 100, H - M.bottom, M.top);
    return items.map((o) => ({ o, x: r2(x(Math.min(Math.max(o.effortScore, 0), 100))), y: r2(y(Math.min(Math.max(o.impactScore, 0), 100))), r: r2(4 + (o.opportunityScore / 100) * 7) }));
  }, [items, width]);

  const midX = M.left + (width - M.left - M.right) / 2;
  const midY = M.top + (H - M.top - M.bottom) / 2;
  const quickWins = items.filter((o) => o.impactScore >= 50 && o.effortScore < 50).length;

  function onPointerMove(e: PointerEvent) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: number | null = null;
    let bestD = 24 * 24;
    pts.forEach((p, i) => {
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
  }

  function onKey(e: KeyboardEvent) {
    const last = items.length - 1;
    const cur = active ?? -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") setActive(Math.min(last, cur + 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setActive(Math.max(0, cur - 1));
    else if (e.key === "Escape") setActive(null);
    else if (e.key === "Enter") router.push("/opportunities");
    else return;
    e.preventDefault();
  }

  const ap = active !== null ? pts[active] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap text-[12px] text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{total}</span> open
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <span className="font-semibold text-foreground">{quickWins}</span> quick win{quickWins === 1 ? "" : "s"}
        </span>
        {total > items.length && <span className="text-subtle-foreground">(top {items.length} plotted)</span>}
        <span className="ml-auto flex items-center gap-2.5 text-[11px]">
          {([1, 2, 3] as const).map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-accent" style={{ opacity: PRIORITY_OPACITY[p] }} aria-hidden="true" />P{p}
            </span>
          ))}
        </span>
      </div>

      <div
        ref={wrapRef}
        className="relative w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised cursor-pointer"
        style={{ height: H }}
        tabIndex={0}
        role="group"
        aria-roledescription="scatter plot"
        aria-label={`${items.length} open opportunities plotted by impact and effort; ${quickWins} are quick wins (high impact, low effort). Arrow keys step through them by score, Enter opens Opportunities.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onClick={() => router.push("/opportunities")}
      >
        {width > 0 && (
          <svg width={width} height={H} className="block" aria-hidden="true">
            {/* quick-win quadrant wash */}
            <rect x={M.left} y={M.top} width={Math.max(midX - M.left, 0)} height={Math.max(midY - M.top, 0)} rx={6} style={{ fill: "var(--accent)" }} opacity={0.06} />
            <rect x={M.left} y={M.top} width={Math.max(width - M.left - M.right, 0)} height={H - M.top - M.bottom} rx={6} fill="none" className="stroke-border" />
            <line x1={midX} x2={midX} y1={M.top} y2={H - M.bottom} className="stroke-border" />
            <line x1={M.left} x2={width - M.right} y1={midY} y2={midY} className="stroke-border" />
            <QuadLabel x={M.left + 8} y={M.top + 16} anchor="start" accent>
              Quick wins
            </QuadLabel>
            <QuadLabel x={width - M.right - 8} y={M.top + 16} anchor="end">
              Big bets
            </QuadLabel>
            <QuadLabel x={M.left + 8} y={H - M.bottom - 8} anchor="start">
              Fill-ins
            </QuadLabel>
            <QuadLabel x={width - M.right - 8} y={H - M.bottom - 8} anchor="end">
              Deprioritize
            </QuadLabel>
            <text x={(M.left + width - M.right) / 2} y={H - 8} textAnchor="middle" className="fill-subtle-foreground font-mono" fontSize={10}>
              EFFORT →
            </text>
            <text x={12} y={(M.top + H - M.bottom) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(M.top + H - M.bottom) / 2})`} className="fill-subtle-foreground font-mono" fontSize={10}>
              IMPACT →
            </text>

            {/* dots — largest first so small ones stay on top and reachable */}
            {[...pts.keys()]
              .sort((a, b) => pts[b]!.r - pts[a]!.r)
              .map((i) => {
                const p = pts[i]!;
                return (
                  <motion.circle
                    key={p.o.id}
                    cx={p.x}
                    cy={p.y}
                    r={p.r}
                    style={{ fill: "var(--accent)", stroke: "var(--surface-raised)", transformOrigin: `${p.x}px ${p.y}px` }}
                    fillOpacity={PRIORITY_OPACITY[p.o.priority]}
                    strokeWidth={2}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 + Math.min(i, 40) * 0.02, ease: easings.emphasized }}
                  />
                );
              })}
            {ap && <circle cx={ap.x} cy={ap.y} r={ap.r + 4} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={2} />}
          </svg>
        )}

        {ap && (
          <div
            className="pointer-events-none absolute z-10 w-[240px] rounded-lg border border-border bg-surface-raised px-3 py-2.5 shadow-lg"
            style={{ left: Math.min(Math.max(ap.x - 120, 0), Math.max(width - 240, 0)), top: ap.y > H / 2 ? ap.y - ap.r - 104 : ap.y + ap.r + 10 }}
          >
            <p className="text-[12.5px] font-medium text-foreground leading-snug line-clamp-2">{ap.o.title}</p>
            <dl className="mt-1.5 grid grid-cols-3 gap-1 font-mono text-[10.5px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
              <div>
                <dt className="text-subtle-foreground">Score</dt>
                <dd className="text-foreground">{ap.o.opportunityScore.toFixed(0)}</dd>
              </div>
              <div>
                <dt className="text-subtle-foreground">Impact</dt>
                <dd>{ap.o.impactScore.toFixed(0)}</dd>
              </div>
              <div>
                <dt className="text-subtle-foreground">Effort</dt>
                <dd>{ap.o.effortScore.toFixed(0)}</dd>
              </div>
            </dl>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {ap ? `${ap.o.title}: score ${ap.o.opportunityScore.toFixed(0)}, impact ${ap.o.impactScore.toFixed(0)}, effort ${ap.o.effortScore.toFixed(0)}, priority ${ap.o.priority}.` : ""}
        </p>
      </div>

      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {items.slice(0, 3).map((o, i) => (
          <li key={o.id}>
            <Link
              href="/opportunities"
              className="group flex items-center gap-3 px-3 min-h-[48px] py-2 hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="font-mono text-[11px] text-subtle-foreground w-4 shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0 text-[12.5px] text-foreground truncate group-hover:text-accent transition-colors">{o.title}</span>
              <Badge variant={OPPORTUNITY_TYPE_BADGE_VARIANT[o.type]} size="sm" className="hidden sm:inline-flex">
                {OPPORTUNITY_TYPE_LABEL[o.type]}
              </Badge>
              <span className="font-mono text-[12px] font-semibold text-foreground w-8 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                {o.opportunityScore.toFixed(0)}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <SrTable
        caption="Open opportunities by score"
        head={["Opportunity", "Score", "Impact", "Effort", "Priority"]}
        rows={items.map((o) => [o.title, o.opportunityScore.toFixed(0), o.impactScore.toFixed(0), o.effortScore.toFixed(0), `P${o.priority}`])}
      />
    </div>
  );
}

function QuadLabel({ x, y, anchor, accent, children }: { x: number; y: number; anchor: "start" | "end"; accent?: boolean; children: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className={cn("font-mono uppercase", accent ? "fill-accent" : "fill-subtle-foreground")} fontSize={9.5} letterSpacing="0.1em">
      {children}
    </text>
  );
}
