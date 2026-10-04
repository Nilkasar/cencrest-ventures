import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@bebest/ui";

/**
 * Detail-page body: the entity's main content (activity, evidence, the
 * thing itself) on the left, a 320px rail of properties and related
 * records on the right. Stacks main-first below `lg`.
 */
export function DetailLayout({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]", className)}>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
      {aside && <aside className="flex min-w-0 flex-col gap-5">{aside}</aside>}
    </div>
  );
}

/** Two equal columns of Sections on a dashboard or report (stacks below `lg`). */
export function SplitLayout({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 items-start gap-5 lg:grid-cols-2", className)}>{children}</div>;
}

/**
 * Kanban column shell — header (label · count · rolled-up value) over a
 * card stack. Drag-and-drop handlers pass straight through to the root.
 */
export function BoardColumn({
  title,
  count,
  meta,
  highlighted = false,
  children,
  className,
  ...rest
}: {
  title: string;
  count: number;
  /** Rolled-up value for the column, pre-formatted (e.g. "$48K"). */
  meta?: ReactNode;
  /** True while a dragged card is over this column. */
  highlighted?: boolean;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <section aria-label={`${title}, ${count}`} className={cn("flex w-72 shrink-0 flex-col gap-2.5", className)} {...rest}>
      <header
        className={cn(
          "flex h-10 items-center justify-between gap-2 rounded-lg border px-3 transition-colors duration-150 motion-reduce:transition-none",
          highlighted ? "border-accent bg-accent-muted" : "border-border bg-surface",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[12.5px] font-semibold text-foreground">{title}</h2>
          <span className="rounded-full bg-surface-raised px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>
        </div>
        {meta && <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">{meta}</span>}
      </header>
      <div
        className={cn(
          "flex min-h-[88px] flex-col gap-2 rounded-lg transition-colors duration-150 motion-reduce:transition-none",
          highlighted && "bg-accent-muted/40 ring-1 ring-accent/40",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Placeholder inside an empty `BoardColumn`. */
export function BoardColumnEmpty({ children = "Nothing here yet", highlighted = false }: { children?: ReactNode; highlighted?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed py-6 text-center text-[12px] transition-colors motion-reduce:transition-none",
        highlighted ? "border-accent text-accent" : "border-border text-subtle-foreground",
      )}
    >
      {children}
    </div>
  );
}
