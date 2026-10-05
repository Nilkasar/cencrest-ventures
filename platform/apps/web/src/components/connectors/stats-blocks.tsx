"use client";

import type { ReactNode } from "react";
import { Button, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { Section } from "@/components/patterns/section";
import { TableEmptyRow } from "@/components/patterns/data-table";
import { typography } from "@/components/patterns/typography";
import { Notice } from "@/components/settings/form-controls";
import { ConnectorNotConnectedError, OAuthNotConfiguredError, TokenExpiredError } from "@/data/connectors/client";

/**
 * Shared pieces of the two connector stat blocks (Search Console, GA4) so
 * both read as one system: a 4-up metric strip, one trend chart with a
 * metric switch, and ranked "top" tables. Real API values only — a missing
 * value is an em dash, never 0.
 */

export const PERIOD_DAYS = 28;

/** 0–1 ratio → "4.2%". The API sends CTR / engagement / bounce as ratios. */
export function ratioPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatPosition(value: number): string {
  return value.toFixed(1);
}

export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** "https://acme.com/pricing?x=1" → "/pricing?x=1"; non-URLs pass through. */
export function displayPath(page: string): string {
  try {
    const url = new URL(page);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return page;
  }
}

export const toTime = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

// ---------------------------------------------------------------------------

export interface Metric {
  label: string;
  value: string;
  hint?: ReactNode;
}

/** Four headline numbers for the period, divided by hairlines. */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-surface/60 sm:grid-cols-4">
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className={cn(
            "flex min-w-0 flex-col gap-1.5 px-4 py-3",
            i % 2 === 1 && "border-l border-border",
            i >= 2 && "border-t border-border sm:border-t-0",
            i === 2 && "sm:border-l",
          )}
        >
          <dt className={typography.eyebrow}>{m.label}</dt>
          <dd className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">{m.value}</dd>
          {m.hint && <dd className="truncate text-[12px] text-muted-foreground">{m.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * The in-panel metric switch (README §10: an in-panel view switch is a
 * segmented control in the Section's actions). Toggle buttons rather than
 * Radix tabs because there's no tab panel per option — one chart re-renders.
 */
export function MetricSwitch<K extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: K;
  onChange: (value: K) => void;
  options: { key: K; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1 rounded-lg bg-surface p-1 shadow-xs">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={cn(
              "inline-flex h-7 items-center rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border border-border bg-surface-raised text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface TopColumn<T> {
  header: string;
  numeric?: boolean;
  cell: (row: T) => ReactNode;
}

/** A ranked top-N table inside a flush Section. Up to 10 rows. */
export function TopTable<T>({
  title,
  description,
  rows,
  columns,
  rowKey,
  emptyLabel,
}: {
  title: string;
  description: string;
  rows: T[];
  columns: TopColumn<T>[];
  rowKey: (row: T, index: number) => string;
  emptyLabel: string;
}) {
  return (
    <Section title={title} description={description} flush>
      <Table framed={false}>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.header} className={col.numeric ? "text-right" : undefined}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmptyRow colSpan={columns.length}>{emptyLabel}</TableEmptyRow>
          ) : (
            rows.slice(0, 10).map((row, i) => (
              <TableRow key={rowKey(row, i)}>
                {columns.map((col, j) => (
                  <TableCell
                    key={col.header}
                    className={cn(col.numeric ? cn("text-right", typography.numeric) : "max-w-[260px]", j === 0 && "font-medium")}
                  >
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Section>
  );
}

/** A truncated first-column label that keeps its full text available. */
export function TruncatedLabel({ text, full }: { text: string; full?: string }) {
  return (
    <span className="block truncate" title={full ?? text}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------

/** Loading shape for a source block: strip + chart. */
export function StatsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[200px] w-full rounded-lg" aria-hidden="true" />
    </div>
  );
}

/**
 * What a source block shows when its stats call fails — the three typed
 * connector failures each get a specific, actionable message; anything else
 * is a compact retryable error.
 */
export function StatsError({
  error,
  source,
  onRetry,
  onReconnect,
  canManage,
}: {
  error: Error;
  source: string;
  onRetry: () => void;
  onReconnect: () => void;
  canManage: boolean;
}) {
  const reconnect = canManage ? (
    <Button variant="primary" size="sm" onClick={onReconnect}>
      Reconnect
    </Button>
  ) : undefined;

  if (error instanceof TokenExpiredError) {
    return (
      <Notice tone="warning" title="Connection expired" action={reconnect}>
        Google&apos;s access for {source} has expired, so these numbers can&apos;t refresh. Reconnect to resume the feed.
      </Notice>
    );
  }
  if (error instanceof ConnectorNotConnectedError) {
    return (
      <Notice tone="warning" title={`${source} isn't fully connected`} action={reconnect}>
        The connection record exists but Google isn&apos;t returning data for it. Reconnect to re-authorize.
      </Notice>
    );
  }
  if (error instanceof OAuthNotConfiguredError) {
    return <Notice tone="warning" title="Google sign-in isn't configured">{error.message}</Notice>;
  }
  return <ErrorPanel compact title={`${source} data didn't load`} message={error.message} onRetry={onRetry} />;
}
