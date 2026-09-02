"use client";

import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import type { AsyncState } from "@/lib/use-async-data";
import { intentTypeLabel } from "@/data/competitive-intelligence/labels";
import type { Competitor } from "@/data/types";
import type { CompetitiveGapsResponse, PerQueryBreakdownRow, PerQueryCompetitorRow } from "@/data/competitive-intelligence/types";

interface EvidenceRow {
  row: PerQueryBreakdownRow;
  competitor: PerQueryCompetitorRow;
}

function formatGap(gap: number | null): { text: string; tone: "danger" | "success" | "neutral" } {
  if (gap === null) return { text: "—", tone: "neutral" };
  if (gap > 0) return { text: `+${gap.toFixed(1)} ahead of you`, tone: "danger" };
  if (gap < 0) return { text: `${Math.abs(gap).toFixed(1)} behind you`, tone: "success" };
  return { text: "Tied", tone: "neutral" };
}

function positionLabel(position: 1 | 2 | 3 | 4 | null): string {
  return position === null ? "not mentioned" : `position ${position}`;
}

/**
 * Per-intent comparison table + the signature per-query evidence sentence
 * (`docs/epics/08-competitive-intelligence.md`: "For 'best freight
 * visibility software,' CompetitorA appears in 84% of responses at
 * position 1, you appear in 2%") — the UI surface's two literal
 * requirements for this screen. One competitor is compared at a time (a
 * portfolio can hold up to 20 on the Pro tier; a single table stays
 * readable, a 20-column one would not) via the picker below the headline.
 *
 * Fetched once by the parent view (`CompetitorsView`) and passed down —
 * `GapFindingsPanel` needs the exact same response, so the fetch isn't
 * duplicated per panel.
 */
export function CompetitiveGapPanel({
  competitors,
  state,
  onRetry,
}: {
  competitors: Competitor[];
  state: AsyncState<CompetitiveGapsResponse | null>;
  onRetry: () => void;
}) {
  // `null` means "no explicit choice yet" — the default below is derived
  // at render time (never via an effect + setState) so there's no
  // cascading-render risk and no flash of an unselected picker while data
  // is still loading.
  const [explicitSelectedId, setExplicitSelectedId] = useState<string | null>(null);

  const gaps = state.status === "success" ? state.data : null;

  // Default to the first competitor that actually has a comparable run,
  // falling back to the first competitor at all — never overrides a
  // user's own choice (`explicitSelectedId`) once one has been made.
  const defaultSelectedId = gaps
    ? (gaps.competitors.find((c) => c.run !== null)?.competitorId ?? gaps.competitors[0]?.competitorId ?? competitors[0]?.id ?? null)
    : null;
  const selectedId = explicitSelectedId ?? defaultSelectedId;

  const selected = gaps?.competitors.find((c) => c.competitorId === selectedId) ?? null;
  const selectedName = selected?.competitorName ?? competitors.find((c) => c.id === selectedId)?.name ?? "this competitor";

  const evidenceRows = useMemo<EvidenceRow[]>(() => {
    if (!gaps || !selectedId) return [];
    const rows: EvidenceRow[] = [];
    for (const row of gaps.perQueryBreakdown) {
      const competitor = row.competitors.find((c) => c.competitorId === selectedId);
      if (competitor) rows.push({ row, competitor });
    }
    return rows;
  }, [gaps, selectedId]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Competitive gap</CardTitle>
          <CardDescription>Where a competitor beats you in AI answers, and by how much — per intent, per query.</CardDescription>
        </div>
        {gaps && gaps.competitors.length > 0 && (
          <Select value={selectedId ?? undefined} onValueChange={setExplicitSelectedId}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Compare against…" />
            </SelectTrigger>
            <SelectContent>
              {gaps.competitors.map((c) => (
                <SelectItem key={c.competitorId} value={c.competitorId}>
                  {c.competitorName}
                  {c.run === null ? " (no run yet)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {state.status === "loading" && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}

        {state.status === "error" && <ErrorPanel compact message={state.error.message} onRetry={onRetry} />}

        {state.status === "success" && gaps === null && (
          <EmptyState
            compact
            icon={<Target size={18} />}
            title="No active query set"
            description="Competitive gaps compare your brand's and each competitor's most recent run on your active query set — activate one in Query Universe first."
          />
        )}

        {state.status === "success" && gaps !== null && !gaps.computed && (
          <EmptyState
            compact
            icon={<Target size={18} />}
            title="Run your AI Visibility baseline first"
            description="Competitive gaps need your own brand's completed run on the active query set to compare against — head to AI Visibility and run a baseline."
          />
        )}

        {state.status === "success" && gaps !== null && gaps.computed && gaps.competitors.length === 0 && (
          <EmptyState
            compact
            icon={<Target size={18} />}
            title="No competitors tracked yet"
            description="Add a competitor above, then run a check to see the gap."
          />
        )}

        {state.status === "success" && gaps !== null && gaps.computed && selected && (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <p className="text-[13px] text-foreground">
                <span className="font-medium">{selectedName}</span>{" "}
                {selected.run === null ? (
                  <span className="text-muted-foreground">hasn&apos;t been run on this query set yet.</span>
                ) : (
                  (() => {
                    const { text, tone } = formatGap(selected.competitiveGap);
                    return (
                      <>
                        is{" "}
                        <span
                          className={
                            tone === "danger" ? "font-semibold text-danger" : tone === "success" ? "font-semibold text-success" : "font-medium"
                          }
                        >
                          {text}
                        </span>{" "}
                        overall.
                      </>
                    );
                  })()
                )}
              </p>
            </div>

            {selected.perIntentTypeGap.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Intent</TableHead>
                    <TableHead>Queries</TableHead>
                    <TableHead>Your score</TableHead>
                    <TableHead>{selectedName}</TableHead>
                    <TableHead>Gap</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.perIntentTypeGap.map((row) => {
                    const { text, tone } = formatGap(row.gap);
                    return (
                      <TableRow key={row.intentType}>
                        <TableCell className="font-medium">{intentTypeLabel(row.intentType)}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{row.queryCount}</TableCell>
                        <TableCell className="font-mono">{row.yourScore.toFixed(1)}</TableCell>
                        <TableCell className="font-mono">{row.competitorScore.toFixed(1)}</TableCell>
                        <TableCell>
                          <Badge variant={tone === "danger" ? "danger" : tone === "success" ? "success" : "neutral"} size="sm">
                            {text}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {evidenceRows.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-subtle-foreground mb-1">
                  Query-level evidence ({evidenceRows.length})
                </p>
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
                  {evidenceRows.map(({ row, competitor }) => (
                    <div key={row.queryId} className="px-4 py-3 flex flex-col gap-1">
                      <p className="text-[11.5px] text-subtle-foreground">
                        {row.intentType ? intentTypeLabel(row.intentType) : "Uncategorized"} · your position:{" "}
                        {positionLabel(row.yourStats.position)}
                      </p>
                      <p className="text-[13px] text-foreground leading-relaxed">{competitor.sentence}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
