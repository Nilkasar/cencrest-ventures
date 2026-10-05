/**
 * The app's type scale as class strings, so every page uses the same exact
 * sizes instead of re-deriving them. Use these (or the components that
 * already apply them) rather than hand-picking a `text-[Npx]`.
 *
 * Fraunces (`font-display`) is for titles only; Inter for UI and prose;
 * JetBrains Mono (`font-mono`) for eyebrows and for measured values in
 * dense contexts (table cells, timestamps, IDs). See README.md.
 */
export const typography = {
  /** Page and entity titles (one `<h1>` per page). */
  pageTitle: "font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.015em] text-foreground",
  /** Section / card titles (`<h2>`). */
  sectionTitle: "font-display text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground",
  /** Small label above a title or value. Never a sentence. */
  eyebrow: "font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground",
  /** Primary reading text. */
  body: "text-[13.5px] leading-relaxed text-foreground",
  /** Secondary text: descriptions, helper copy, empty-state bodies. */
  secondary: "text-[13px] leading-relaxed text-muted-foreground",
  /** Meta: timestamps, counts, "Created 3 days ago". */
  meta: "text-[12px] text-muted-foreground",
  /** Measured value inside a table cell or inline readout. */
  numeric: "font-mono text-[12.5px] tabular-nums text-foreground",
  /** Headline number on a stat tile. */
  statValue: "text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground",
} as const;
