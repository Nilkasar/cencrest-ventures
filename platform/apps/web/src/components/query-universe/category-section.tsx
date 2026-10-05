"use client";

import { Plus, X } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import type { Query, QueryCategory } from "@/data/query-universe/types";
import { INTENT_TYPE_LABEL, PRIORITY_LABEL, QUERY_CATEGORY_META } from "@/data/query-universe/constants";

/** Intent is a categorical tag (README §6: outline, no dot). */
export function IntentTag({ intent }: { intent: Query["intentType"] }) {
  return (
    <Badge variant="outline" size="sm">
      {INTENT_TYPE_LABEL[intent]}
    </Badge>
  );
}

export function PriorityText({ priority }: { priority: Query["priority"] }) {
  return (
    <span className={priority === 1 ? "text-[12px] font-medium text-foreground" : "text-[12px] text-muted-foreground"}>{PRIORITY_LABEL[priority]}</span>
  );
}

export function RemoveQueryButton({ query, removing, onRemove }: { query: Query; removing: boolean; onRemove: (query: Query) => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 text-subtle-foreground hover:bg-danger-muted hover:text-danger"
      aria-label={`Remove "${query.text}"`}
      loading={removing}
      onClick={() => onRemove(query)}
    >
      <X size={14} aria-hidden="true" />
    </Button>
  );
}

/**
 * One category of the query universe — the GEO engine's documented
 * taxonomy (label + its template pattern), then its queries, each tagged
 * with intent and priority. Add/remove only while the set is a draft.
 */
export function CategorySection({
  category,
  queries,
  editable,
  removingId,
  onRemove,
  onAdd,
}: {
  category: QueryCategory;
  queries: Query[];
  editable: boolean;
  removingId: string | null;
  onRemove: (query: Query) => void;
  onAdd: (category: QueryCategory) => void;
}) {
  const meta = QUERY_CATEGORY_META[category];

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          {meta.label}
          <span className="rounded-full bg-surface px-1.5 font-mono text-[11px] font-normal tabular-nums text-muted-foreground">{queries.length}</span>
        </span>
      }
      description={<span className="font-mono text-[11.5px]">{meta.pattern}</span>}
      actions={
        editable ? (
          <Button variant="ghost" size="sm" onClick={() => onAdd(category)} aria-label={`Add a ${meta.label} query`}>
            <Plus size={14} aria-hidden="true" /> Add
          </Button>
        ) : undefined
      }
      flush
    >
      {queries.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-muted-foreground">
          No {meta.label.toLowerCase()} queries in this set.{editable ? " Buyers who ask this kind of question won't be measured — add one if it matters." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {queries.map((query) => (
            <li key={query.id} className="flex min-h-11 items-center gap-3 px-5 py-2">
              <p className="min-w-0 flex-1 text-[13px] text-foreground">{query.text}</p>
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                {query.source === "manual" && (
                  <Badge variant="neutral" size="sm">
                    Added by you
                  </Badge>
                )}
                <IntentTag intent={query.intentType} />
                <span className="w-14 text-right">
                  <PriorityText priority={query.priority} />
                </span>
              </div>
              {editable && <RemoveQueryButton query={query} removing={removingId === query.id} onRemove={onRemove} />}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
