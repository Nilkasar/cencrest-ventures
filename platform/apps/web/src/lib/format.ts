/** Formatting helpers shared across CRM screens. Numbers render in
 *  JetBrains Mono at the call site per `packages/ui/DESIGN.md` — "a
 *  monospaced numeral is a signal this was measured, not written." */

export function formatCurrency(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatCompactCurrency(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "3 days ago", "just now", etc. Only ever called client-side after a
 *  fetch resolves (every CRM view renders its loading skeleton during
 *  SSR), so there's no server/client text mismatch to worry about. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms || unit === "minute") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return formatDate(iso);
}

/** Integer/decimal with thousands separators: 12,480 · 3.4 */
export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

/** Compact count for tiles and chips: 1.2K · 34M. Use `formatNumber` in tables. */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** A 0–100 value (not a 0–1 ratio) as a percentage: 42% · 42.5% */
export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/** Signed change with a true minus sign: +4 · −2.5 · 0. Pass `unit` for "pts"/"%". */
export function formatDelta(value: number, decimals = 0, unit = ""): string {
  const rounded = Number(value.toFixed(decimals));
  if (rounded === 0) return `0${unit}`;
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(decimals)}${unit}`;
}
