"use client";

import { ChevronRight, ListTree } from "lucide-react";
import { Card, CardContent, EmptyState, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bebest/ui";
import type { AiRunResponse, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import { computeIntentBreakdown, queryIdsForIntent } from "@/data/ai-visibility/analysis";
import { INTENT_TYPE_LABEL } from "@/data/query-universe/constants";
import type { ResponseFilter } from "./response-filter";

/**
 * "Score breakdown by intent" — per the epic's UI surface. Not a backend
 * endpoint (only the composite AVS + its four global formula components
 * are persisted); computed client-side by grouping this run's responses
 * by their query's `intentType` (`queries.intent_type`, resolved via the
 * query set fetched alongside — see `AiRunDetail`). Every number here is a
 * real count over real observations, so clicking an intent row is exactly
 * as evidence-backed a drill-down as clicking a formula component.
 */
export function IntentBreakdownPanel({
  responses,
  queryMeta,
  loading,
  onDrillIntent,
}: {
  responses: AiRunResponse[];
  queryMeta: Map<string, AiVisibilityQueryMeta>;
  loading: boolean;
  onDrillIntent: (filter: ResponseFilter) => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (queryMeta.size === 0) {
    return (
      <EmptyState
        compact
        icon={<ListTree size={18} />}
        title="Query intent labels unavailable"
        description="Couldn't load this run's query set to group responses by intent — the raw-response explorer still has every response."
      />
    );
  }

  const stats = computeIntentBreakdown(responses, queryMeta);

  return (
    <Card>
      <CardContent className="p-0">
        <Table className="border-0 rounded-none">
          <TableHeader>
            <TableRow>
              <TableHead>Intent</TableHead>
              <TableHead>Queries covered</TableHead>
              <TableHead>Responses</TableHead>
              <TableHead>Mentioned</TableHead>
              <TableHead>Recommended</TableHead>
              <TableHead>Avg. position</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((row) => (
              <TableRow
                key={row.intentType}
                className={row.totalQueries === 0 ? "opacity-50" : "cursor-pointer"}
                onClick={() => {
                  if (row.totalQueries === 0) return;
                  onDrillIntent({
                    queryIds: queryIdsForIntent(queryMeta, row.intentType),
                    queryIdsLabel: `${INTENT_TYPE_LABEL[row.intentType]} intent`,
                  });
                }}
              >
                <TableCell className="font-medium">{INTENT_TYPE_LABEL[row.intentType]}</TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {row.queriesCovered}/{row.totalQueries}
                  {row.coveragePct !== null && <span className="text-subtle-foreground"> ({row.coveragePct}%)</span>}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">{row.totalResponses}</TableCell>
                <TableCell className="font-mono">
                  {row.mentionRatePct !== null ? `${row.mentionRatePct}%` : "—"}
                  <span className="text-subtle-foreground"> ({row.mentioned})</span>
                </TableCell>
                <TableCell className="font-mono">
                  {row.recommendationRatePct !== null ? `${row.recommendationRatePct}%` : "—"}
                  <span className="text-subtle-foreground"> ({row.recommended})</span>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {row.avgFirstPosition !== null ? `${Math.round(row.avgFirstPosition * 100)}%` : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {row.totalQueries > 0 && <ChevronRight size={14} className="text-subtle-foreground inline-block" />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
