"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { Card, Skeleton, cn } from "@bebest/ui";
import { revealVariants, stackVariants } from "./motion";
import { typography } from "./typography";

/**
 * A row of 2–4 one-glance numbers at the top of a list or dashboard page.
 * Every tile's number must come from the API across all matching rows —
 * never a count of the rows the current page happens to hold.
 */
const GRID_COLUMNS = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
} as const;

export function StatGrid({ columns = 4, children, className }: { columns?: 2 | 3 | 4; children: ReactNode; className?: string }) {
  return (
    <motion.div variants={stackVariants} className={cn("grid gap-4", GRID_COLUMNS[columns], className)}>
      {children}
    </motion.div>
  );
}

export type StatTone = "positive" | "negative" | "neutral";

const DELTA_TONE: Record<StatTone, string> = {
  positive: "text-success",
  negative: "text-danger",
  neutral: "text-muted-foreground",
};

export function StatTile({
  label,
  value,
  hint,
  delta,
  icon,
  href,
  loading = false,
  muted = false,
  className,
}: {
  label: string;
  /** Pre-formatted (see `lib/format.ts`). Use "—" when there's no value. */
  value: ReactNode;
  /** One short line under the value: what it means or what it's out of. */
  hint?: ReactNode;
  /** Pre-formatted change, e.g. `formatDelta(4, 0, " pts")`, with its tone. */
  delta?: { value: string; tone: StatTone; label?: string };
  icon?: ReactNode;
  /** Makes the whole tile a link into the screen that owns the number. */
  href?: string;
  loading?: boolean;
  /** Greys the value (e.g. "—" before any data exists). */
  muted?: boolean;
  className?: string;
}) {
  const body = (
    <Card
      className={cn(
        "flex h-full min-h-[112px] flex-col gap-3 p-4",
        href &&
          "transition-[border-color,box-shadow,transform] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:border-accent group-hover:shadow-md motion-reduce:group-hover:translate-y-0",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground",
                href && "transition-colors group-hover:bg-accent-muted group-hover:text-accent",
              )}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <p className={cn(typography.eyebrow, "truncate")}>{label}</p>
        </div>
        {href && (
          <ChevronRight
            size={14}
            className="shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="mt-auto flex flex-col gap-1.5">
        {loading ? (
          <>
            <Skeleton className="h-[26px] w-20" />
            <Skeleton className="h-3 w-28" />
            <span className="sr-only">Loading {label}</span>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <p className={cn(typography.statValue, muted && "text-subtle-foreground")}>{value}</p>
              {delta && (
                <span className={cn("font-mono text-[12px] font-medium tabular-nums", DELTA_TONE[delta.tone])}>
                  {delta.value}
                  {delta.label && <span className="ml-1 font-sans font-normal text-muted-foreground">{delta.label}</span>}
                </span>
              )}
            </div>
            {hint && <p className="text-[12px] leading-snug text-muted-foreground">{hint}</p>}
          </>
        )}
      </div>
    </Card>
  );

  return (
    <motion.div variants={revealVariants} className={cn("min-w-0", className)}>
      {href ? (
        <Link
          href={href}
          className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </motion.div>
  );
}
