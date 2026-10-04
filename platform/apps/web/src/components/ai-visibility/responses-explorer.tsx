"use client";

import { useMemo, useState } from "react";
import { ChevronDown, MessageSquareText, X } from "lucide-react";
import { Badge, Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { FilterSelect, ResultCount, ToolbarSearch } from "@/components/patterns/toolbar";
import { TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { NoResults } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import type { AiRunResponse, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { describeFilter, isEmptyFilter, matchesFilter, type ResponseFilter } from "./response-filter";
import { ResponseDetailDialog } from "./response-detail-dialog";
import { ExtractionBadge, SentimentBadge, shortProviderLabel } from "./status-badges";

const PAGE_SIZE = 25;

const COLUMNS: SkeletonColumn[] = [
  { header: "Question", cell: "entity" },
  { header: "Mentioned", cell: "badge" },
  { header: "Recommended", cell: "badge" },
  { header: "Tone", cell: "badge" },
  { header: "Fetched", cell: "meta" },
];

/**
 * The bottom of the drill-down: every raw AI answer in this run. One
 * filter state (owned by `AiRunDetail`) is shared with every number on the
 * page, so "select a number above" and "filter by hand here" are the same
 * mechanism. Filtering runs over the already-fetched set in memory.
 */
export function ResponsesExplorer({
  id,
  responses,
  total,
  truncated,
  loading,
  queryMeta,
  providers,
  filter,
  onFilterChange,
}: {
  id: string;
  responses: AiRunResponse[];
  total: number;
  truncated: boolean;
  loading: boolean;
  queryMeta: Map<string, AiVisibilityQueryMeta>;
  providers: string[];
  filter: ResponseFilter;
  onFilterChange: (filter: ResponseFilter) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openResponseId, setOpenResponseId] = useState<string | null>(null);

  const filtered = useMemo(
    () => responses.filter((r) => matchesFilter(r, filter, queryMeta.get(r.queryId)?.text)),
    [responses, filter, queryMeta],
  );

  const visible = filtered.slice(0, visibleCount);
  // Facets with no dedicated control (set by a drill-down elsewhere on the
  // page) are shown as chips so the user can see why the list narrowed.
  const drillChips = describeFilter({ queryIds: filter.queryIds, queryIdsLabel: filter.queryIdsLabel, recommended: filter.recommended, citedDomain: filter.citedDomain });
  const openResponse = openResponseId ? (responses.find((r) => r.id === openResponseId) ?? null) : null;
  const filtering = !isEmptyFilter(filter);

  function update(patch: Partial<ResponseFilter>) {
    setVisibleCount(PAGE_SIZE);
    onFilterChange({ ...filter, ...patch });
  }

  function clear() {
    setVisibleCount(PAGE_SIZE);
    onFilterChange({});
  }

  return (
    <Section
      id={id}
      className="scroll-mt-20"
      title="Responses"
      description="Every raw answer, with what we read from it. Open one to check the reading against the source text."
      flush
      footer={
        visible.length < filtered.length ? (
          <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            <ChevronDown size={14} aria-hidden="true" /> Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2 border-b border-border px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <ToolbarSearch
            value={filter.search ?? ""}
            onChange={(v) => update({ search: v || undefined })}
            placeholder="Search questions and answers"
            label="Search responses"
          />
          <FilterSelect
            value={filter.provider ?? "all"}
            onValueChange={(v) => update({ provider: v === "all" ? undefined : v })}
            options={[{ value: "all", label: "All models" }, ...providers.map((p) => ({ value: p, label: shortProviderLabel(p) }))]}
            label="Filter by model"
            className="sm:w-36"
          />
          <FilterSelect
            value={filter.mentioned === undefined ? "all" : filter.mentioned ? "yes" : "no"}
            onValueChange={(v) => update({ mentioned: v === "all" ? undefined : v === "yes" })}
            options={[
              { value: "all", label: "Mentioned or not" },
              { value: "yes", label: "Mentions you" },
              { value: "no", label: "Doesn't mention you" },
            ]}
            label="Filter by mention"
            className="sm:w-44"
          />
          <FilterSelect
            value={filter.sentiment ?? "all"}
            onValueChange={(v) => update({ sentiment: v === "all" ? undefined : (v as ResponseFilter["sentiment"]) })}
            options={[
              { value: "all", label: "Any tone" },
              { value: "positive", label: "Positive" },
              { value: "neutral", label: "Neutral" },
              { value: "mixed", label: "Mixed" },
              { value: "negative", label: "Negative" },
            ]}
            label="Filter by tone"
            className="sm:w-32"
          />
          <FilterSelect
            value={filter.extractionStatus ?? "all"}
            onValueChange={(v) => update({ extractionStatus: v === "all" ? undefined : (v as ResponseFilter["extractionStatus"]) })}
            options={[
              { value: "all", label: "Any reading" },
              { value: "completed", label: "Extracted" },
              { value: "pending", label: "Extracting" },
              { value: "failed", label: "Extraction failed" },
            ]}
            label="Filter by extraction status"
            className="sm:w-40"
          />
          <div className="flex items-center gap-2 sm:ml-auto">
            {filtering && (
              <Button variant="ghost" size="sm" onClick={clear} className="h-9">
                <X size={14} aria-hidden="true" /> Clear
              </Button>
            )}
            {!loading && <ResultCount count={filtered.length} noun="response" />}
          </div>
        </div>
        {drillChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground">Showing answers for</span>
            {drillChips.map((chip) => (
              <Badge key={chip} variant="info" size="sm">
                {chip}
              </Badge>
            ))}
          </div>
        )}
        {truncated && (
          <p className="text-[12px] text-muted-foreground">
            Showing the first {formatNumber(responses.length)} of {formatNumber(total)} answers gathered so far — filters apply within this set.
          </p>
        )}
      </div>

      {loading && <TableSkeleton columns={COLUMNS} rows={5} framed={false} label="Loading responses…" />}

      {!loading && responses.length === 0 && (
        <EmptyState
          compact
          icon={<MessageSquareText size={18} />}
          title="No answers gathered yet"
          description="Answers appear here the moment each model replies — you don't have to wait for the run to finish."
        />
      )}

      {!loading && responses.length > 0 && filtered.length === 0 && (
        <NoResults noun="responses" onClear={clear} hint="Every answer in this run is in the full list — clear a filter to widen it." />
      )}

      {!loading && filtered.length > 0 && (
        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>Mentioned</TableHead>
              <TableHead className="hidden sm:table-cell">Recommended</TableHead>
              <TableHead className="hidden md:table-cell">Tone</TableHead>
              <TableHead className="hidden lg:table-cell">Reading</TableHead>
              <TableHead className="hidden lg:table-cell">Fetched</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((response) => {
              const meta = queryMeta.get(response.queryId);
              const obs = response.observation;
              return (
                <TableRow key={response.id} className="cursor-pointer" onClick={() => setOpenResponseId(response.id)}>
                  <TableCell className="max-w-[360px]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenResponseId(response.id);
                      }}
                      className="block max-w-full truncate rounded-sm text-left text-[13px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {meta?.text ?? `Query ${response.queryId.slice(0, 8)}`}
                    </button>
                    <p className="truncate text-[12px] text-muted-foreground">{shortProviderLabel(response.provider)}</p>
                  </TableCell>
                  <TableCell>
                    <YesNo value={obs ? obs.brandMentioned : null} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <YesNo value={obs ? obs.brandRecommended : null} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {obs?.brandSentiment ? <SentimentBadge sentiment={obs.brandSentiment} /> : <span className="text-subtle-foreground">&mdash;</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ExtractionBadge status={response.extractionStatus} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap lg:table-cell">
                    <span className={typography.meta}>{formatRelativeTime(response.createdAt)}</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <ResponseDetailDialog
        response={openResponse}
        queryMeta={openResponse ? queryMeta.get(openResponse.queryId) : undefined}
        open={openResponse !== null}
        onOpenChange={(open) => {
          if (!open) setOpenResponseId(null);
        }}
      />
    </Section>
  );
}

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-subtle-foreground">&mdash;</span>;
  return value ? (
    <Badge variant="success" size="sm" dot>
      Yes
    </Badge>
  ) : (
    <Badge variant="neutral" size="sm" dot>
      No
    </Badge>
  );
}
