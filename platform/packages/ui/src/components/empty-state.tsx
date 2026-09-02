import * as React from "react";
import { cn } from "../lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  /** Primary call to action — should always be reachable per the empty-state
   *  principle: explain why it's empty, say what to do, make it easy to do. */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon,
  eyebrow,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border",
        compact ? "py-10 px-6" : "py-20 px-8",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full border border-border bg-surface text-muted-foreground mb-5",
            compact ? "size-10" : "size-12",
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      {eyebrow && (
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground mb-2">
          {eyebrow}
        </p>
      )}
      <p
        className={cn(
          "font-display font-semibold text-foreground tracking-[-0.01em]",
          compact ? "text-[16px]" : "text-[19px]",
        )}
      >
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "text-muted-foreground leading-relaxed mt-2 max-w-[420px] text-balance",
            compact ? "text-[13px]" : "text-[14px]",
          )}
        >
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
