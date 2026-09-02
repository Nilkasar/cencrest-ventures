import type { AiRunResponse, BrandSentiment, ExtractionStatus } from "@/data/ai-visibility/types";
import { EXTRACTION_STATUS_LABEL, providerLabel, SENTIMENT_LABEL } from "@/data/ai-visibility/labels";

/**
 * The single filter state shared by every drill-down source (the score
 * formula cards, the model-breakdown table, the by-intent panel, the
 * citation map, the sentiment chart) and the raw-response explorer's own
 * refine controls — one state, lifted to `AiRunDetail`, so "click a number
 * anywhere on this screen" and "narrow the explorer by hand" are the same
 * mechanism instead of two competing ones. This is what makes "drill from
 * the headline score down to a specific raw AI response" a real, wired
 * path rather than separate static panels.
 */
export interface ResponseFilter {
  provider?: string;
  queryIds?: Set<string>;
  /** Human label for the `queryIds` facet (e.g. "Comparison intent") —
   *  the set itself has no inherent description. */
  queryIdsLabel?: string;
  extractionStatus?: ExtractionStatus;
  sentiment?: BrandSentiment;
  recommended?: boolean;
  mentioned?: boolean;
  citedDomain?: string;
  search?: string;
}

export const EMPTY_FILTER: ResponseFilter = {};

export function isEmptyFilter(filter: ResponseFilter): boolean {
  return Object.values(filter).every((v) => v === undefined || (v instanceof Set && v.size === 0));
}

/** `queryText`, if given, is the response's own query's text — passed in
 *  by the caller (which owns the id -> query lookup) so `search` can match
 *  either the raw response body or the question that produced it. */
export function matchesFilter(response: AiRunResponse, filter: ResponseFilter, queryText?: string): boolean {
  if (filter.provider && response.provider !== filter.provider) return false;
  if (filter.queryIds && !filter.queryIds.has(response.queryId)) return false;
  if (filter.extractionStatus && response.extractionStatus !== filter.extractionStatus) return false;
  if (filter.sentiment && response.observation?.brandSentiment !== filter.sentiment) return false;
  if (filter.recommended !== undefined && Boolean(response.observation?.brandRecommended) !== filter.recommended) return false;
  if (filter.mentioned !== undefined && Boolean(response.observation?.brandMentioned) !== filter.mentioned) return false;
  if (filter.citedDomain && !(response.observation?.citedDomains ?? []).includes(filter.citedDomain)) return false;
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const matchesRaw = response.rawResponse.toLowerCase().includes(needle);
    const matchesQuery = (queryText ?? "").toLowerCase().includes(needle);
    if (!matchesRaw && !matchesQuery) return false;
  }
  return true;
}

/** Renders the active filter as human-readable chips, for the explorer's
 *  "filtered by: ..." bar. */
export function describeFilter(filter: ResponseFilter): string[] {
  const chips: string[] = [];
  if (filter.provider) chips.push(`Model: ${providerLabel(filter.provider)}`);
  if (filter.queryIds) chips.push(filter.queryIdsLabel ?? `${filter.queryIds.size} quer${filter.queryIds.size === 1 ? "y" : "ies"}`);
  if (filter.extractionStatus) chips.push(EXTRACTION_STATUS_LABEL[filter.extractionStatus]);
  if (filter.sentiment) chips.push(`Sentiment: ${SENTIMENT_LABEL[filter.sentiment]}`);
  if (filter.recommended !== undefined) chips.push(filter.recommended ? "Recommended" : "Not recommended");
  if (filter.mentioned !== undefined) chips.push(filter.mentioned ? "Brand mentioned" : "Brand not mentioned");
  if (filter.citedDomain) chips.push(`Cites ${filter.citedDomain}`);
  if (filter.search) chips.push(`"${filter.search}"`);
  return chips;
}
