"use client";

import type { ReactNode } from "react";
import { Info, Lock, TriangleAlert } from "lucide-react";
import { cn } from "@bebest/ui";

/**
 * Small controls the Data & admin pages need that `@bebest/ui` doesn't ship
 * yet. Both are candidates for the design system; they live here because
 * `packages/ui` and `components/patterns` are outside this group's scope.
 */

/**
 * On/off switch — a real `role="switch"` button (Space/Enter toggle it,
 * `aria-checked` carries state), 44×24 visual with the label supplied by
 * the surrounding `FormRow` via `id`/`aria-labelledby`, or `aria-label`.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-transparent bg-accent" : "border-border-strong bg-surface",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-[18px] rounded-full bg-surface-raised shadow-sm transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

const NOTICE_TONE = {
  info: { icon: Info, className: "border-border bg-surface", iconClass: "text-muted-foreground" },
  locked: { icon: Lock, className: "border-border bg-surface", iconClass: "text-muted-foreground" },
  warning: { icon: TriangleAlert, className: "border-warning/30 bg-warning-muted", iconClass: "text-warning" },
} as const;

/**
 * A one-line, page-level note: read-only access ("locked"), an upsell or
 * at-risk state ("warning"), or context ("info"). Status is carried by the
 * icon *and* the text, never by color alone.
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof NOTICE_TONE;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = NOTICE_TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === "warning" ? "status" : undefined}
      className={cn("flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center", t.className, className)}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon size={15} className={cn("mt-0.5 shrink-0", t.iconClass)} aria-hidden="true" />
        <div className="min-w-0">
          {title && <p className="text-[13px] font-medium text-foreground">{title}</p>}
          {children && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{children}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 sm:ml-auto">{action}</div>}
    </div>
  );
}
