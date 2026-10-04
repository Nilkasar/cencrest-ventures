"use client";

import { ListTree } from "lucide-react";
import { EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import type { AiRunResponse, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import { computeIntentBreakdown, queryIdsForIntent } from "@/data/ai-visibility/analysis";
import { INTENT_TYPE_LABEL } from "@/data/query-universe/constants";
import { formatPercent } from "@/lib/format";
import type { ResponseFilter } from "./response-filter";

/**
 * "Score breakdown by intent" — computed client-side by grouping this
 * run's responses by their query's `intentType`. Every number is a real
 * count over real observations; selecting a row narrows the Responses
 * explorer to that intent's answers.
 */
export function IntentBreakdownPanel({
  responses,
  queryMeta,
  queryMetaFailed,
  onDrillIntent,
  className,
}: {
  responses: AiRunResponse[];
  queryMeta: Map<string, AiVisibilityQueryMeta>;
  queryMetaFailed: boolean;
  onDrillIntent: (filter: ResponseFilter) => void;
  className?: string;
}) {
  const stats = queryMeta.size > 0 ? computeIntentBreakdown(responses, queryMeta) : [];

  return (
    <Section title="By buyer intent" description="Where in the buying journey AI includes you. Select an intent to read its answers." flush className={className}>
      {queryMeta.size === 0 ? (
        <EmptyState
          compact
          icon={<ListTree size={18} />}
          title={queryMetaFailed ? "Intent labels didn't load" : "No queries in this set"}
          description="Answers can't be grouped by intent without the run's query set. Every answer is still in the Responses list below."
        />
      ) : (
        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Intent</TableHead>
              <TableHead className="text-right">Covered</TableHead>
              <TableHead className="text-right">Mentioned</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Recommended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((row) => {
              const empty = row.totalQueries === 0;
              const drill = () =>
                onDrillIntent({
                  queryIds: queryIdsForIntent(queryMeta, row.intentType),
                  queryIdsLabel: `${INTENT_TYPE_LABEL[row.intentType]} intent`,
                });
              return (
                <TableRow key={row.intentType} className={cn(empty ? "text-muted-foreground hover:bg-transparent" : "cursor-pointer")} onClick={empty ? undefined : drill}>
                  <TableCell>
                    {empty ? (
                      <span className="text-[13px]">{INTENT_TYPE_LABEL[row.intentType]}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          drill();
                        }}
                        className="rounded-sm text-[13px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {INTENT_TYPE_LABEL[row.intentType]}
                      </button>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {row.totalQueries} {row.totalQueries === 1 ? "query" : "queries"} · {row.totalResponses} answers
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={typography.numeric}>
                      {empty ? "—" : `${row.queriesCovered}/${row.totalQueries}`}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={typography.numeric}>{row.mentionRatePct !== null ? formatPercent(row.mentionRatePct) : "—"}</span>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className={typography.numeric}>{row.recommendationRatePct !== null ? formatPercent(row.recommendationRatePct) : "—"}</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
