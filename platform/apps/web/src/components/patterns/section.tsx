"use client";

import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Card, cn } from "@bebest/ui";
import { revealVariants } from "./motion";
import { typography } from "./typography";

/**
 * The one card-with-a-header every page block uses — the same chrome as
 * the Overview's `Panel` (padding, title size, eyebrow), title-first
 * instead of eyebrow-first. Participates in `PageStack`'s stagger.
 *
 * `flush`: the body has no padding and starts with a hairline, for a
 * `<Table framed={false}>` or a divided list that should run edge to edge.
 */
export function Section({
  title,
  description,
  eyebrow,
  icon,
  actions,
  footer,
  flush = false,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  /** 14px lucide icon, shown in a 28px accent tile. Use sparingly. */
  icon?: ReactNode;
  /** Section-level controls, right-aligned in the header (≤2 buttons). */
  actions?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = useId();
  const hasHeader = Boolean(title || eyebrow || actions);
  return (
    <motion.section
      id={id}
      variants={revealVariants}
      aria-labelledby={title ? headingId : undefined}
      className={cn("min-w-0", className)}
    >
      <Card className="flex h-full flex-col overflow-hidden">
        {hasHeader && (
          <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {icon && (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent" aria-hidden="true">
                  {icon}
                </span>
              )}
              <div className="min-w-0">
                {eyebrow && <p className={cn(typography.eyebrow, "truncate")}>{eyebrow}</p>}
                {title && (
                  <h2 id={headingId} className={typography.sectionTitle}>
                    {title}
                  </h2>
                )}
                {description && <p className={cn(typography.meta, "mt-0.5 leading-relaxed")}>{description}</p>}
              </div>
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </header>
        )}
        <div
          className={cn(
            "min-h-0 flex-1",
            flush ? (hasHeader ? "border-t border-border" : "") : hasHeader ? "px-5 pb-5" : "p-5",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/60 px-5 py-3">{footer}</div>}
      </Card>
    </motion.section>
  );
}

export interface PropertyItem {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}

/**
 * Label/value pairs for a detail page's side rail ("Contact", "Details").
 * Real `<dl>` semantics. Values that are missing should be passed as
 * `null` and render an em dash, never be dropped silently.
 */
export function PropertyList({ items, className }: { items: PropertyItem[]; className?: string }) {
  return (
    <dl className={cn("flex flex-col gap-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-3">
          <dt className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {item.icon && (
              <span className="shrink-0 text-subtle-foreground" aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
          </dt>
          <dd className="min-w-0 break-words text-[13px] text-foreground">
            {item.value ?? <span className="text-subtle-foreground">&mdash;</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
