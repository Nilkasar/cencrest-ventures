"use client";

import { useEffect, useRef } from "react";
import { MoreHorizontal, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  TableCell,
  TableRow,
} from "@bebest/ui";
import { CellLink, ClickableRow } from "@/components/patterns/data-table";
import { typography } from "@/components/patterns/typography";
import { RunStatusBadge } from "@/components/ai-visibility/status-badges";
import type { Competitor } from "@/data/types";
import { useCompetitorAiRun } from "@/hooks/use-competitor-ai-run";
import { formatRelativeTime } from "@/lib/format";
import { CompetitorRunStartError } from "./competitor-run-start-error";
import { GapValue, PriorityBadge, displayDomain, initials } from "./status-badges";

export const COMPETITOR_COLUMN_COUNT = 6;

/**
 * One tracked competitor in the list. Each row owns its own run trigger
 * and poll (competitors run on no shared schedule), so a check started
 * here ticks along in place; when it settles the parent refreshes the
 * comparison panels. The row opens the competitor's evidence page.
 */
export function CompetitorRow({
  competitor,
  gap,
  onEdit,
  onRemove,
  removing,
  onRunSettled,
}: {
  competitor: Competitor;
  /** Competitor AVS − yours on the active query set (`null` = not comparable). */
  gap: number | null;
  onEdit: (competitor: Competitor) => void;
  onRemove: (competitor: Competitor) => void;
  removing: boolean;
  onRunSettled: () => void;
}) {
  const { state, starting, startError, start } = useCompetitorAiRun(competitor.id);
  const run = state.status === "ready" ? state.run : null;
  const inFlight = run !== null && (run.status === "queued" || run.status === "running");
  const href = `/competitors/${competitor.id}`;

  // Refresh the comparison panels once a run started from this row lands.
  const lastStatus = useRef(run?.status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = run?.status;
    if ((prev === "queued" || prev === "running") && (run?.status === "completed" || run?.status === "failed")) onRunSettled();
  }, [run?.status, onRunSettled]);

  return (
    <>
      <ClickableRow href={href}>
        <TableCell>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-[11px] font-medium text-muted-foreground" aria-hidden="true">
              {initials(competitor.name)}
            </span>
            <div className="min-w-0">
              <CellLink href={href} className="block truncate text-[13px]">
                {competitor.name}
              </CellLink>
              <p className="truncate text-[12px] text-muted-foreground">{competitor.websiteUrl ? displayDomain(competitor.websiteUrl) : "No website"}</p>
            </div>
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <PriorityBadge priority={competitor.priority} />
        </TableCell>
        <TableCell>
          {state.status === "loading" ? (
            <Skeleton className="h-5 w-20 rounded-full" />
          ) : state.status === "error" ? (
            <span className={typography.meta}>Unavailable</span>
          ) : !run ? (
            <span className={typography.meta}>Not measured</span>
          ) : inFlight ? (
            <div className="flex flex-col gap-1">
              <RunStatusBadge status={run.status} />
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{Math.round(run.progressPct)}% gathered</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <RunStatusBadge status={run.status} />
              {run.completedAt && <span className={typography.meta}>{formatRelativeTime(run.completedAt)}</span>}
            </div>
          )}
        </TableCell>
        <TableCell className="text-right">
          <span className={`${typography.numeric} font-medium`}>
            {run?.aiVisibilityScore != null ? run.aiVisibilityScore.toFixed(1) : <span className="text-subtle-foreground">&mdash;</span>}
          </span>
        </TableCell>
        <TableCell className="hidden text-right sm:table-cell">
          <GapValue gap={gap} />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="outline"
              size="sm"
              loading={starting}
              disabled={inFlight || state.status === "loading"}
              onClick={() => void start()}
              aria-label={run ? `Run ${competitor.name} again` : `Run first check on ${competitor.name}`}
            >
              {run ? <RefreshCw size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
              <span className="hidden lg:inline">{inFlight ? "Running" : run ? "Run again" : "Run check"}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={`More actions for ${competitor.name}`} loading={removing}>
                  <MoreHorizontal size={15} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(competitor)}>
                  <Pencil size={14} aria-hidden="true" /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onRemove(competitor)} className="text-danger focus:text-danger">
                  <Trash2 size={14} aria-hidden="true" /> Stop tracking
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </ClickableRow>
      {startError !== null && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COMPETITOR_COLUMN_COUNT} className="pt-0">
            <CompetitorRunStartError error={startError} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
