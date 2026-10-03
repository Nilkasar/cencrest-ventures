"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform, type Variants } from "framer-motion";
import { AlertTriangle, ArrowUpRight, RotateCw } from "lucide-react";
import { Button, Card, Skeleton, cn, easings } from "@bebest/ui";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * The Overview command center's shared building blocks. Every widget on the
 * dashboard is a `<Panel>` that owns its own loading / error / empty /
 * success states (so one failing endpoint never blanks the screen), and
 * every number that counts up is an `<AnimatedNumber>` driven by a Framer
 * motion value — no React re-render per frame.
 *
 * Motion vocabulary, kept deliberately small:
 *   - entrance: panels rise 10px and fade in, staggered by the view;
 *   - data arrival: numbers count up, bars grow from their baseline, lines
 *     draw on — each once, when the data lands;
 *   - ambient: CSS-only strokes (`.ov-*` in globals.css), paused offscreen
 *     via `useOffscreenPause`.
 * All of it collapses to the final state under `prefers-reduced-motion`
 * (`MotionConfig reducedMotion="user"` in `UIProvider` + the CSS media
 * query), and nothing animates layout — only transform/opacity/stroke.
 */

export const panelVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easings.emphasized } },
};

export const staggerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

// ---------------------------------------------------------------------------
// Panel chrome

export function Panel({
  eyebrow,
  title,
  icon,
  href,
  hrefLabel = "Open",
  live = false,
  aside,
  children,
  className,
  bodyClassName,
}: {
  eyebrow: string;
  title?: string;
  icon?: ReactNode;
  href?: string;
  hrefLabel?: string;
  /** Shows a pulsing "Live" chip — only when something is genuinely in
   *  flight server-side (a running AI run or agent), never decoratively. */
  live?: boolean;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const headingId = useId();
  return (
    <motion.section variants={panelVariants} aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <Card className="h-full flex flex-col overflow-hidden">
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent" aria-hidden="true">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground truncate">{eyebrow}</p>
              {title && (
                <h2 id={headingId} className="font-display text-[15.5px] font-semibold text-foreground tracking-[-0.01em] leading-snug truncate">
                  {title}
                </h2>
              )}
              {!title && (
                <h2 id={headingId} className="sr-only">
                  {eyebrow}
                </h2>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {live && <LiveChip />}
            {aside}
            {href && (
              <Link
                href={href}
                className="group inline-flex items-center gap-1 rounded-md px-2 h-8 -mr-2 text-[12px] font-medium text-muted-foreground hover:text-accent hover:bg-accent-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {hrefLabel}
                <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        </header>
        <div className={cn("flex-1 min-h-0 px-5 pb-5", bodyClassName)}>{children}</div>
      </Card>
    </motion.section>
  );
}

export function LiveChip({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-muted px-2 h-6 text-[10.5px] font-mono font-medium uppercase tracking-[0.1em] text-accent">
      <span className="ov-live size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// States

export function PanelSkeleton({ height = 220, className }: { height?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} style={{ minHeight: height }} aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-48" />
      <Skeleton className="flex-1 w-full rounded-lg" />
    </div>
  );
}

export function PanelError({ message, onRetry, height }: { message?: string; onRetry?: () => void; height?: number }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 text-center py-6" style={height ? { minHeight: height } : undefined}>
      <span className="flex size-9 items-center justify-center rounded-full bg-danger-muted text-danger" aria-hidden="true">
        <AlertTriangle size={16} />
      </span>
      <p className="text-[12.5px] text-muted-foreground max-w-[32ch]">{message ?? "This panel couldn’t load. The rest of your overview is unaffected."}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw size={13} aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}

/** Every empty state on the Overview says (1) why it's empty, (2) what to
 *  do, and (3) puts that action one click away. */
export function PanelEmpty({
  icon,
  title,
  body,
  action,
  height,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: { href: string; label: string };
  height?: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 text-center py-6" style={height ? { minHeight: height } : undefined}>
      {icon && (
        <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-border-strong text-subtle-foreground" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="text-[13.5px] font-medium text-foreground">{title}</p>
      <p className="text-[12.5px] text-muted-foreground max-w-[38ch] leading-relaxed">{body}</p>
      {action && (
        <Button variant="outline" size="sm" asChild className="mt-1">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numbers

/**
 * Counts from the previous value (0 on first mount) to `value` once per
 * change. The animated digits are `aria-hidden`; screen readers get the
 * final formatted value immediately via the sr-only twin, so an announcer
 * never reads a half-counted number.
 */
export function AnimatedNumber({
  value,
  format = (v) => Math.round(v).toLocaleString("en-US"),
  className,
  duration = 1.4,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));

  useEffect(() => {
    const controls = animate(mv, value, { duration: reduce ? 0 : duration, ease: easings.emphasized });
    return () => controls.stop();
  }, [mv, value, reduce, duration]);

  return (
    <span className={className}>
      <motion.span aria-hidden="true">{text}</motion.span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

export function formatPct(v: number, decimals = 0): string {
  return `${v.toFixed(decimals)}%`;
}

// ---------------------------------------------------------------------------
// Hooks

/** Ref + `paused` flag for a widget with continuous CSS motion: anything
 *  more than a screen away from the viewport stops animating. Spread
 *  `data-paused={paused}` onto the widget's root. */
export function useOffscreenPause<T extends Element>() {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { margin: "160px 0px" });
  return { ref, paused: !inView };
}

/**
 * `useAsyncData` plus a polite poll: while `intervalFor(data)` returns a
 * number (e.g. a run is still `running`), the fetch repeats on that
 * interval, skipping ticks while the tab is hidden. Returns to idle the
 * moment the server says the work is done. Refetches never tear down to
 * skeletons — `useAsyncData` keeps the last result on screen.
 *
 * A failed background poll (a 429 from the per-user rate limit, a cold
 * start, a network blip) must not replace good data with an error panel:
 * `useAsyncData` drops its data on any failure, so the last good result is
 * kept here and served — and polling continues — until a poll succeeds.
 * The error state only surfaces when there was never data for these deps.
 */
export function usePolledData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  intervalFor: (data: T) => number | null,
) {
  const state = useAsyncData(fetcher, deps);
  const key = JSON.stringify(deps);
  const [lastGood, setLastGood] = useState<{ key: string; data: T } | null>(null);
  if (state.status === "success" && (lastGood?.key !== key || lastGood.data !== state.data)) {
    setLastGood({ key, data: state.data });
  }
  const fallback = lastGood?.key === key ? lastGood : null;

  const effective: typeof state =
    state.status !== "success" && fallback ? { ...state, status: "success", data: fallback.data } : state;
  const ms = effective.status === "success" ? intervalFor(effective.data) : null;
  const { reload } = state;

  useEffect(() => {
    if (ms === null) return;
    const id = window.setInterval(() => {
      if (!document.hidden) reload();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms, reload]);

  return effective;
}

// ---------------------------------------------------------------------------
// Accessibility

/** The text alternative every chart on the Overview ships with: a real
 *  table, visually hidden, carrying the same numbers the marks encode. */
export function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
