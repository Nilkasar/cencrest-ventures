"use client";

import { motion } from "framer-motion";
import { cn, easings } from "@bebest/ui";

function clamp(v: number) {
  return Math.max(0, Math.min(100, v));
}

/**
 * Before → after on one 0–100 track (a dumbbell): a hollow marker where
 * the score was, a solid one where it is now, and the segment between
 * them tinted by direction. Shows the size of a change against the whole
 * scale, which a bare "+3.2" can't. Real values only; the numbers are
 * also printed beside the track so it never relies on the drawing.
 *
 * Motion: the segment grows from the "before" marker once (transform
 * only). Reduced motion is handled by the app's `MotionConfig`.
 */
export function ScoreShift({
  before,
  after,
  beforeLabel = "Before",
  afterLabel = "After",
  upIsGood = true,
  compact = false,
  className,
}: {
  before: number;
  after: number;
  beforeLabel?: string;
  afterLabel?: string;
  /** False for a competitor's score, where their gain is your loss. */
  upIsGood?: boolean;
  /** Hide the 0/50/100 scale labels (dense lists). */
  compact?: boolean;
  className?: string;
}) {
  const b = clamp(before);
  const a = clamp(after);
  const lo = Math.min(a, b);
  const width = Math.abs(a - b);
  const up = a > b;
  const flat = a === b;
  const good = up === upIsGood;
  const tone = flat ? "bg-muted-foreground" : good ? "bg-success" : "bg-danger";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative h-5" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface" />
        {[25, 50, 75].map((t) => (
          <span key={t} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-border-strong/50" style={{ left: `${t}%` }} />
        ))}
        {!flat && (
          <motion.div
            className={cn("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-70", tone)}
            style={{ left: `${lo}%`, width: `${width}%`, transformOrigin: up ? "left center" : "right center" }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: easings.emphasized }}
          />
        )}
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground bg-surface-raised"
          style={{ left: `${b}%` }}
        />
        <span
          className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-raised shadow-sm", tone)}
          style={{ left: `${a}%` }}
        />
      </div>
      {!compact && (
        <div className="flex items-center justify-between font-mono text-[10.5px] tabular-nums text-subtle-foreground" aria-hidden="true">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
      )}
      <p className="sr-only">
        {beforeLabel} {before.toFixed(1)}, {afterLabel} {after.toFixed(1)}, on a 0 to 100 scale.
      </p>
    </div>
  );
}
