"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@bebest/ui";

/**
 * Table conventions on top of `@bebest/ui`'s Table (see README.md "Tables"):
 *   - a clickable row is a `ClickableRow` whose primary cell holds a real
 *     `CellLink` — keyboard and screen-reader users get a genuine link,
 *     mouse users can click anywhere on the row, cmd/ctrl-click opens a tab;
 *   - sortable columns use `SortableHead` (`aria-sort` + a button);
 *   - numeric columns are right-aligned and use `typography.numeric`;
 *   - the loading state is `TableSkeleton` with the real column headers.
 */

export function ClickableRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  function onClick(event: MouseEvent<HTMLTableRowElement>) {
    // Let real controls inside the row (links, buttons, menus) do their own thing.
    if ((event.target as HTMLElement).closest("a, button, input, select, textarea, [role=menuitem], [role=checkbox]")) return;
    if (window.getSelection()?.toString()) return; // the user is selecting text
    if (event.metaKey || event.ctrlKey) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href);
  }
  return (
    <TableRow onClick={onClick} className={cn("cursor-pointer", className)}>
      {children}
    </TableRow>
  );
}

/** The row's primary label as a real link (the row's keyboard target). */
export function CellLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export type SortDirection = "asc" | "desc" | false;

export function SortableHead({
  children,
  direction,
  onSort,
  align = "left",
  className,
}: {
  children: ReactNode;
  direction: SortDirection;
  onSort: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className={cn(align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "-mx-1.5 inline-flex h-7 items-center gap-1 rounded px-1.5 uppercase tracking-[inherit] transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          direction && "text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {children}
        <Icon size={12} className={direction ? "opacity-100" : "opacity-50"} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

/** A full-width message row for a table that keeps its header when empty
 *  (tables inside a detail Section). List pages swap the table for an
 *  `EmptyState`/`NoResults` instead. */
export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-10 text-center text-[13px] text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

export type SkeletonCell = "text" | "entity" | "badge" | "number" | "meta";

export interface SkeletonColumn {
  header: string;
  cell?: SkeletonCell;
  align?: "left" | "right";
}

function SkeletonCellShape({ cell }: { cell: SkeletonCell }) {
  switch (cell) {
    case "entity":
      return (
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      );
    case "badge":
      return <Skeleton className="h-5 w-20 rounded-full" />;
    case "number":
      return <Skeleton className="ml-auto h-3 w-10" />;
    case "meta":
      return <Skeleton className="h-3 w-16" />;
    default:
      return <Skeleton className="h-3 w-28" />;
  }
}

/** Loading state for a table — same headers and cell shapes as the real
 *  table, so nothing shifts when the data lands. */
export function TableSkeleton({
  columns,
  rows = 6,
  framed = true,
  label = "Loading…",
}: {
  columns: SkeletonColumn[];
  rows?: number;
  framed?: boolean;
  label?: string;
}) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <Table framed={framed} aria-hidden="true">
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.header} className={col.align === "right" ? "text-right" : undefined}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              {columns.map((col) => (
                <TableCell key={col.header}>
                  <SkeletonCellShape cell={col.cell ?? "text"} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
