"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn, easings } from "@bebest/ui";
import { SHORT_DATE, linearScale, monotonePath, niceDomain, r2, ticks } from "./chart-math";

export interface TrendPoint {
  /** Epoch ms. */
  t: number;
  v: number;
}

const M = { top: 14, right: 14, bottom: 26, left: 40 };

/**
 * The Overview's single-series time chart — AI Visibility history, GSC
 * clicks, GA4 sessions all render through this one component, so every
 * trend on the page shares the same anatomy: hairline solid grid, a 2px
 * monotone line that draws on once, a soft accent wash beneath it, and a
 * crosshair + tooltip on hover.
 *
 * One series, one axis, always (never a dual-axis overlay — a second
 * measure gets its own chart or a metric switch at the call site).
 *
 * Keyboard: the plot is one tab stop; ←/→ walk the points (Home/End jump),
 * Esc clears. The focused point is announced through a polite live region,
 * and `ariaSummary` + the caller's `SrTable` carry the full series for
 * screen readers — the tooltip never gates a value.
 *
 * Width is measured (ResizeObserver) rather than viewBox-scaled, so tick
 * labels stay crisp 10px text at every container size; the wrapper's
 * height is fixed up-front, so measurement never shifts layout.
 */
export function TrendChart({
  points,
  height = 200,
  domain,
  formatValue,
  formatTime = (t) => SHORT_DATE.format(t),
  ariaSummary,
  tooltipDetail,
  className,
}: {
  points: TrendPoint[];
  height?: number;
  domain?: [number, number];
  formatValue: (v: number) => string;
  formatTime?: (t: number) => string;
  ariaSummary: string;
  tooltipDetail?: (index: number) => ReactNode;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const gradId = `ov-trend-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (width === 0 || points.length === 0) return null;
    const [lo, hi] = domain ?? niceDomain(points.map((p) => p.v), { step: 5, floor: 0 });
    const t0 = points[0]!.t;
    const t1 = points[points.length - 1]!.t;
    const innerW = width - M.left - M.right;
    const x = t1 === t0 ? () => M.left + innerW / 2 : linearScale(t0, t1, M.left, width - M.right);
    const y = linearScale(lo, hi, height - M.bottom, M.top);
    const xy: [number, number][] = points.map((p) => [r2(x(p.t)), r2(y(p.v))]);
    const line = monotonePath(xy);
    const base = height - M.bottom;
    const area = xy.length > 1 ? `${line} L${xy[xy.length - 1]![0]} ${base} L${xy[0]![0]} ${base} Z` : "";
    const xTickIdx = points.length <= 2 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
    return { lo, hi, xy, line, area, base, y, xTickIdx: [...new Set(xTickIdx)] };
  }, [width, points, domain, height]);

  function nearest(clientX: number) {
    if (!geo || !wrapRef.current) return null;
    const left = wrapRef.current.getBoundingClientRect().left;
    const px = clientX - left;
    let best = 0;
    let bestD = Infinity;
    geo.xy.forEach(([x], i) => {
      const d = Math.abs(x - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function onKey(e: KeyboardEvent) {
    const last = points.length - 1;
    const cur = active ?? last;
    let next: number | null = cur;
    if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "ArrowRight") next = Math.min(last, cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setActive(next);
  }

  const ap = active !== null && geo ? geo.xy[active] : null;
  const tooltipLeft = ap ? Math.min(Math.max(ap[0], 70), Math.max(width - 70, 70)) : 0;

  return (
    <div
      ref={wrapRef}
      className={cn("relative w-full select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised", className)}
      style={{ height }}
      tabIndex={points.length > 0 ? 0 : -1}
      role="group"
      aria-roledescription="chart"
      aria-label={`${ariaSummary} Use the left and right arrow keys to read each point.`}
      onKeyDown={onKey}
      onFocus={() => setActive((a) => a ?? points.length - 1)}
      onBlur={() => setActive(null)}
    >
      {geo && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden="true"
          onPointerMove={(e: PointerEvent) => setActive(nearest(e.clientX))}
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.26 }} />
              <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>

          {/* grid + y ticks */}
          {ticks(geo.lo, geo.hi, 4).map((tv) => {
            const ty = r2(geo.y(tv));
            return (
              <g key={tv}>
                <line x1={M.left} x2={width - M.right} y1={ty} y2={ty} className="stroke-border" strokeWidth={1} />
                <text x={M.left - 8} y={ty + 3.5} textAnchor="end" className="fill-subtle-foreground font-mono" fontSize={10} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatValue(tv)}
                </text>
              </g>
            );
          })}
          {/* x ticks */}
          {geo.xTickIdx.map((i) => {
            const [tx] = geo.xy[i]!;
            const anchor = geo.xTickIdx.length > 1 && i === 0 ? "start" : i === points.length - 1 && geo.xTickIdx.length > 1 ? "end" : "middle";
            return (
              <text key={i} x={tx} y={height - 6} textAnchor={anchor} className="fill-subtle-foreground font-mono" fontSize={10}>
                {formatTime(points[i]!.t)}
              </text>
            );
          })}

          {geo.area && (
            <motion.path
              d={geo.area}
              fill={`url(#${gradId})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.5, ease: easings.decelerate }}
            />
          )}
          {geo.xy.length > 1 && (
            <motion.path
              d={geo.line}
              fill="none"
              style={{ stroke: "var(--accent)" }}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.3, ease: easings.emphasized }}
            />
          )}

          {/* points: shown when sparse enough to read; always the last one */}
          {geo.xy.map(([px, py], i) => {
            const isLast = i === geo.xy.length - 1;
            if (!isLast && geo.xy.length > 24) return null;
            return (
              <motion.circle
                key={i}
                cx={px}
                cy={py}
                r={isLast ? 4 : 3}
                className="fill-surface-raised"
                style={{ stroke: "var(--accent)" }}
                strokeWidth={2}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, delay: 0.3 + (i / Math.max(geo.xy.length, 1)) * 1.0 }}
              />
            );
          })}
          {geo.xy.length > 0 && (
            <circle cx={geo.xy[geo.xy.length - 1]![0]} cy={geo.xy[geo.xy.length - 1]![1]} r={8} className="ov-pulse" style={{ fill: "var(--accent)" }} />
          )}

          {/* crosshair */}
          {ap && (
            <g>
              <line x1={ap[0]} x2={ap[0]} y1={M.top} y2={geo.base} className="stroke-border-strong" strokeWidth={1} />
              <circle cx={ap[0]} cy={ap[1]} r={5.5} className="fill-surface-raised" style={{ stroke: "var(--accent)" }} strokeWidth={2.5} />
            </g>
          )}
        </svg>
      )}

      {ap && active !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-lg"
          style={{ left: tooltipLeft, top: Math.max(ap[1] - 70, -8) }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground">{formatTime(points[active]!.t)}</p>
          <p className="text-[14px] font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatValue(points[active]!.v)}
          </p>
          {tooltipDetail?.(active)}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {active !== null && points[active] ? `${formatTime(points[active].t)}: ${formatValue(points[active].v)}` : ""}
      </p>
    </div>
  );
}
