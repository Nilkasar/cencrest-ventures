"use client";

import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bebest/ui";
import type { AiRun } from "@/data/ai-visibility/types";
import { RUN_STATUS_BADGE_VARIANT, RUN_STATUS_LABEL, providerLabel } from "@/data/ai-visibility/labels";
import { formatDateTime } from "@/lib/format";

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}

/**
 * Past runs — per the epic's end-to-end flow step 6: re-running the same
 * query set creates a NEW `ai_runs` row (history preserved), never an
 * overwrite, so before/after comparison (Epic 14) has data to work with.
 * Every past run stays viewable here, not just the latest one.
 */
export function AiRunHistoryTable({ runs, viewingRunId, onView }: { runs: AiRun[]; viewingRunId: string; onView: (runId: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Models</TableHead>
          <TableHead>AVS</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const isViewing = run.id === viewingRunId;
          const hasResults = run.status === "completed" || run.status === "failed";
          return (
            <TableRow key={run.id}>
              <TableCell>
                <Badge variant={RUN_STATUS_BADGE_VARIANT[run.status]} size="sm">
                  {RUN_STATUS_LABEL[run.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="text-[12.5px] text-foreground">{run.startedAt ? formatDateTime(run.startedAt) : "—"}</span>
              </TableCell>
              <TableCell>
                <span className="font-mono text-[12.5px] text-muted-foreground">{formatDuration(run.startedAt, run.completedAt)}</span>
              </TableCell>
              <TableCell>
                <span className="text-[12px] text-muted-foreground">{run.providers.map(providerLabel).join(", ")}</span>
              </TableCell>
              <TableCell>
                <span className="font-mono text-[13px] font-semibold text-foreground">
                  {run.aiVisibilityScore !== null ? run.aiVisibilityScore.toFixed(1) : "—"}
                </span>
              </TableCell>
              <TableCell>
                {hasResults && (
                  <Button variant={isViewing ? "secondary" : "ghost"} size="sm" onClick={() => onView(run.id)} disabled={isViewing}>
                    {isViewing ? "Viewing" : "View"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
