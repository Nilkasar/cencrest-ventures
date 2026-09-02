"use client";

import { useMemo, useState } from "react";
import { ChevronDown, MessageSquareOff, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
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
import type { AiRunResponse, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import {
  EXTRACTION_STATUS_BADGE_VARIANT,
  EXTRACTION_STATUS_LABEL,
  SENTIMENT_BADGE_VARIANT,
  SENTIMENT_LABEL,
  providerLabel,
} from "@/data/ai-visibility/labels";
import { describeFilter, matchesFilter, type ResponseFilter } from "./response-filter";
import { ResponseDetailDialog } from "./response-detail-dialog";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 25;

/**
 * The raw-response explorer — per the epic's UI surface. Operates over the
 * already-fetched, capped response set (`AiRunDetail`'s `getAllAiRunResponses`
 * call) rather than issuing a new server request per filter change: every
 * facet here (provider/status/sentiment/mentioned/recommended/search) is a
 * real field on data already in memory, and this is also the landing spot
 * for every drill-down click elsewhere on the screen (`filter` is owned by
 * `AiRunDetail`, not this component) — one filtering mechanism, not two.
 */
export function ResponsesExplorer({
  responses,
  total,
  truncated,
  loading,
  queryMeta,
  providers,
  filter,
  onFilterChange,
}: {
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
  const chips = describeFilter(filter);
  const openResponse = openResponseId ? (responses.find((r) => r.id === openResponseId) ?? null) : null;

  function update(patch: Partial<ResponseFilter>) {
    setVisibleCount(PAGE_SIZE);
    onFilterChange({ ...filter, ...patch });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
              <Input
                value={filter.search ?? ""}
                onChange={(e) => update({ search: e.target.value || undefined })}
                placeholder="Search question or response text…"
                className="pl-8"
              />
            </div>

            <Select value={filter.provider ?? "all"} onValueChange={(v) => update({ provider: v === "all" ? undefined : v })}>
              <SelectTrigger className="w-auto min-w-[140px]">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {providerLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filter.extractionStatus ?? "all"}
              onValueChange={(v) => update({ extractionStatus: v === "all" ? undefined : (v as ResponseFilter["extractionStatus"]) })}
            >
              <SelectTrigger className="w-auto min-w-[150px]">
                <SelectValue placeholder="Extraction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any extraction status</SelectItem>
                <SelectItem value="completed">Extracted</SelectItem>
                <SelectItem value="pending">Extracting</SelectItem>
                <SelectItem value="failed">Extraction failed</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filter.mentioned === undefined ? "all" : filter.mentioned ? "yes" : "no"}
              onValueChange={(v) => update({ mentioned: v === "all" ? undefined : v === "yes" })}
            >
              <SelectTrigger className="w-auto min-w-[150px]">
                <SelectValue placeholder="Mentioned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Mentioned or not</SelectItem>
                <SelectItem value="yes">Brand mentioned</SelectItem>
                <SelectItem value="no">Brand not mentioned</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filter.sentiment ?? "all"}
              onValueChange={(v) => update({ sentiment: v === "all" ? undefined : (v as ResponseFilter["sentiment"]) })}
            >
              <SelectTrigger className="w-auto min-w-[140px]">
                <SelectValue placeholder="Sentiment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any sentiment</SelectItem>
                <SelectItem value="positive">Positive</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
                <SelectItem value="negative">Negative</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-muted-foreground">Filtered by:</span>
              {chips.map((chip, i) => (
                <Badge key={i} variant="accent" size="sm">
                  {chip}
                </Badge>
              ))}
              <button
                type="button"
                onClick={() => onFilterChange({})}
                className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground ml-1"
              >
                <X size={12} /> Clear
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {truncated && (
        <p className="text-[12px] text-subtle-foreground">
          Showing the first {responses.length.toLocaleString()} of {total.toLocaleString()} responses gathered so far —
          filters apply within this set.
        </p>
      )}

      {loading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <EmptyState
          compact
          icon={<MessageSquareOff size={18} />}
          title="No responses match these filters"
          description={
            responses.length === 0
              ? "No responses have been gathered for this run yet."
              : "Try clearing a filter or two — every response for this run is in this set somewhere."
          }
        />
      )}

      {!loading && filtered.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Query</TableHead>
                <TableHead>Extraction</TableHead>
                <TableHead>Mentioned</TableHead>
                <TableHead>Sentiment</TableHead>
                <TableHead>Recommended</TableHead>
                <TableHead>Fetched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((response) => {
                const meta = queryMeta.get(response.queryId);
                return (
                  <TableRow
                    key={response.id}
                    className="cursor-pointer"
                    onClick={() => setOpenResponseId(response.id)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setOpenResponseId(response.id);
                    }}
                  >
                    <TableCell className="whitespace-nowrap text-[12.5px]">{providerLabel(response.provider)}</TableCell>
                    <TableCell className="max-w-[280px]">
                      <p className="text-[13px] text-foreground truncate">{meta?.text ?? response.queryId}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={EXTRACTION_STATUS_BADGE_VARIANT[response.extractionStatus]} size="sm">
                        {EXTRACTION_STATUS_LABEL[response.extractionStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-[12.5px] text-foreground">
                        {response.observation ? (response.observation.brandMentioned ? "Yes" : "No") : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {response.observation?.brandSentiment ? (
                        <Badge variant={SENTIMENT_BADGE_VARIANT[response.observation.brandSentiment]} size="sm">
                          {SENTIMENT_LABEL[response.observation.brandSentiment]}
                        </Badge>
                      ) : (
                        <span className="text-[12.5px] text-subtle-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-[12.5px] text-foreground">
                        {response.observation ? (response.observation.brandRecommended ? "Yes" : "No") : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[12px] text-muted-foreground whitespace-nowrap">{formatDateTime(response.createdAt)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {visible.length < filtered.length && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                <ChevronDown size={14} /> Load {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
              </Button>
            </div>
          )}
        </>
      )}

      <ResponseDetailDialog
        response={openResponse}
        queryMeta={openResponse ? queryMeta.get(openResponse.queryId) : undefined}
        open={openResponse !== null}
        onOpenChange={(open) => {
          if (!open) setOpenResponseId(null);
        }}
      />
    </div>
  );
}
