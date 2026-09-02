"use client";

import { Plus, X } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import type { Query, QueryCategory } from "@/data/query-universe/types";
import { INTENT_TYPE_BADGE_VARIANT, INTENT_TYPE_LABEL, PRIORITY_LABEL, QUERY_CATEGORY_META } from "@/data/query-universe/constants";

/**
 * One category's block in the grouped review — the frontend's rendering of
 * `docs/10-seo/SEO_ENGINE.md`'s Intent Graph example (a category heading
 * over its queries, each annotated). This epic has no volume/coverage data
 * yet (that's Epic 4/7's job once real measurement runs), so each row is
 * annotated with what this epic actually owns: intent type and priority.
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
    <section className="rounded-xl border border-border bg-surface-raised" aria-labelledby={`qcat-${category}`}>
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 id={`qcat-${category}`} className="font-display text-[14.5px] font-semibold text-foreground">
              {meta.label}
            </h3>
            <Badge variant="neutral" size="sm">{queries.length}</Badge>
          </div>
          <p className="font-mono text-[11px] text-subtle-foreground mt-0.5">{meta.pattern}</p>
        </div>
        {editable && (
          <Button variant="ghost" size="sm" onClick={() => onAdd(category)}>
            <Plus size={13} /> Add
          </Button>
        )}
      </header>

      {queries.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-muted-foreground">
          No {meta.label.toLowerCase()} queries in this set yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {queries.map((query) => (
            <li key={query.id} className="flex items-center gap-3 px-5 py-2.5 group">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-foreground truncate">{query.text}</p>
              </div>
              <Badge variant={INTENT_TYPE_BADGE_VARIANT[query.intentType]} size="sm" className="shrink-0">
                {INTENT_TYPE_LABEL[query.intentType]}
              </Badge>
              <span className="hidden sm:inline font-mono text-[10.5px] uppercase tracking-[0.06em] text-subtle-foreground shrink-0 w-12 text-right">
                {PRIORITY_LABEL[query.priority]}
              </span>
              {query.source === "manual" && (
                <Badge variant="outline" size="sm" className="shrink-0 hidden md:inline-flex">
                  Manual
                </Badge>
              )}
              {editable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-subtle-foreground hover:text-danger"
                  aria-label={`Remove "${query.text}"`}
                  loading={removingId === query.id}
                  onClick={() => onRemove(query)}
                >
                  <X size={14} />
                </Button>
              ) : (
                <span className="w-7 shrink-0" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
