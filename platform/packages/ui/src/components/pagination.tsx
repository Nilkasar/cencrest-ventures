"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { cn } from "../lib/utils";

export interface PaginationProps {
  /** 1-indexed current page. */
  page: number;
  pageSize: number;
  /** Server-reported total row count across every page. */
  total: number;
  onPageChange: (page: number) => void;
  /** Plural noun describing what's being paged, e.g. "opportunities". */
  itemLabel?: string;
  className?: string;
}

/**
 * Real Prev/Next paging for any server-paginated list (`{ total, limit,
 * offset }` — the convention every list endpoint in this codebase
 * returns, per `docs/epics/19-production-hardening-backend.md`'s item 6).
 * Renders nothing when everything already fits on one page, so a small
 * list never grows a dead control. `aria-live` announces the range on
 * every page change for screen readers; Prev/Next reuse `Button`'s
 * existing focus-visible ring and disabled styling rather than a
 * one-off pattern.
 */
export function Pagination({ page, pageSize, total, onPageChange, itemLabel = "items", className }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const canPrev = page > 1;
  const canNext = page < pageCount;

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3 pt-1", className)}
    >
      <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-foreground">{start}–{end}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} aria-hidden="true" /> Previous
        </Button>
        <span className="px-1.5 font-mono text-[12px] text-muted-foreground" aria-hidden="true">
          {page} / {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          Next <ChevronRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
