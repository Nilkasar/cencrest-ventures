import * as React from "react";
import { cn } from "../lib/utils";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** `true` (default): the table is its own card — raised surface, border,
   *  radius matching `Card`. `false`: no chrome at all, for a table that
   *  sits flush inside a `Card`/`Section` which already supplies it. */
  framed?: boolean;
  /** Classes for the horizontal-scroll wrapper (e.g. a `max-h-*` +
   *  `overflow-y-auto` to make a sticky header meaningful). */
  containerClassName?: string;
}

export function Table({ className, framed = true, containerClassName, ...props }: TableProps) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto",
        framed && "rounded-xl border border-border bg-surface-raised shadow-xs",
        containerClassName,
      )}
    >
      <table className={cn("w-full caption-bottom text-[13px] tabular-nums", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface [&_tr]:hover:bg-transparent", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot className={cn("bg-surface border-t border-border font-medium", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors last:border-0 hover:bg-surface/60 data-[state=selected]:bg-accent-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-10 px-4 text-left align-middle font-medium text-[11px] uppercase tracking-[0.06em] text-subtle-foreground whitespace-nowrap",
        "[&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-4 py-3 align-middle text-foreground [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("mt-3 text-[12px] text-muted-foreground", className)} {...props} />;
}
