"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn, easings } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { SrTable } from "@/components/overview/primitives";
import { QUERY_CATEGORIES, type Query, type QueryCategory, type QueryIntentType } from "@/data/query-universe/types";
import { INTENT_TYPE_LABEL, QUERY_CATEGORY_META } from "@/data/query-universe/constants";
import { formatPercent } from "@/lib/format";

const INTENT_TYPES: QueryIntentType[] = ["informational", "commercial", "comparison", "transactional"];

function BarButton({
  label,
  sublabel,
  count,
  max,
  active,
  empty,
  index,
  onClick,
  valueLabel,
}: {
  label: string;
  sublabel?: string;
  count: number;
  max: number;
  active: boolean;
  empty: boolean;
  index: number;
  onClick: () => void;
  valueLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group grid w-full grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem] items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent-muted/50 hover:bg-accent-muted/60",
      )}
    >
      <span className="min-w-0">
        <span className={cn("flex items-center gap-1 truncate text-[12.5px]", empty ? "text-muted-foreground" : "text-foreground", active && "font-medium")}>
          {active && <Check size={12} className="shrink-0 text-accent" aria-hidden="true" />}
          {label}
        </span>
        {sublabel && <span className="block truncate text-[11.5px] text-muted-foreground">{sublabel}</span>}
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        <motion.span
          className={cn("block h-full w-full origin-left rounded-full", active ? "bg-accent" : "bg-border-strong group-hover:bg-muted-foreground")}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: max > 0 ? count / max : 0 }}
          transition={{ duration: 0.8, delay: 0.1 + index * 0.04, ease: easings.emphasized }}
        />
      </span>
      <span className={cn("text-right font-mono text-[12.5px] tabular-nums", empty ? "text-subtle-foreground" : "text-foreground")}>{valueLabel}</span>
    </button>
  );
}

/**
 * "Is my universe balanced?" — how many queries each of the ten GEO
 * categories holds. A category at zero is a blind spot (buyers asking that
 * kind of question won't be measured), so it's called out. Selecting a bar
 * filters the list below to that category.
 */
export function CategoryCoveragePanel({
  queries,
  active,
  onSelect,
  className,
}: {
  queries: Query[];
  active: QueryCategory | "all";
  onSelect: (category: QueryCategory | "all") => void;
  className?: string;
}) {
  const counts = new Map<QueryCategory, number>(QUERY_CATEGORIES.map((c) => [c, 0]));
  for (const q of queries) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const max = Math.max(...counts.values(), 1);
  const blind = QUERY_CATEGORIES.filter((c) => (counts.get(c) ?? 0) === 0);

  return (
    <Section
      title="By category"
      description={blind.length > 0 ? `${blind.length} of 10 categories have no queries — those buyer questions go unmeasured.` : "Every category has at least one query. Select one to filter the list."}
      className={className}
    >
      <ul className="-mx-2 flex flex-col">
        {QUERY_CATEGORIES.map((category, i) => {
          const count = counts.get(category) ?? 0;
          return (
            <li key={category}>
              <BarButton
                label={QUERY_CATEGORY_META[category].label}
                count={count}
                max={max}
                index={i}
                empty={count === 0}
                active={active === category}
                valueLabel={String(count)}
                onClick={() => onSelect(active === category ? "all" : category)}
              />
            </li>
          );
        })}
      </ul>
      <SrTable caption="Queries per category" head={["Category", "Queries"]} rows={QUERY_CATEGORIES.map((c) => [QUERY_CATEGORY_META[c].label, counts.get(c) ?? 0])} />
    </Section>
  );
}

/** The same set by the four buyer-intent types AI Visibility scores by. */
export function IntentMixPanel({
  queries,
  active,
  onSelect,
  className,
}: {
  queries: Query[];
  active: QueryIntentType | "all";
  onSelect: (intent: QueryIntentType | "all") => void;
  className?: string;
}) {
  const counts = new Map<QueryIntentType, number>(INTENT_TYPES.map((t) => [t, 0]));
  for (const q of queries) counts.set(q.intentType, (counts.get(q.intentType) ?? 0) + 1);
  const total = queries.length;
  const max = Math.max(...counts.values(), 1);

  return (
    <Section title="By buyer intent" description="AI Visibility breaks your score down by these four." className={className}>
      <ul className="-mx-2 flex flex-col">
        {INTENT_TYPES.map((intent, i) => {
          const count = counts.get(intent) ?? 0;
          return (
            <li key={intent}>
              <BarButton
                label={INTENT_TYPE_LABEL[intent]}
                sublabel={`${count} ${count === 1 ? "query" : "queries"}`}
                count={count}
                max={max}
                index={i}
                empty={count === 0}
                active={active === intent}
                valueLabel={total > 0 ? formatPercent((count / total) * 100) : "—"}
                onClick={() => onSelect(active === intent ? "all" : intent)}
              />
            </li>
          );
        })}
      </ul>
      <SrTable
        caption="Queries per intent type"
        head={["Intent", "Queries", "Share"]}
        rows={INTENT_TYPES.map((t) => [INTENT_TYPE_LABEL[t], counts.get(t) ?? 0, total > 0 ? formatPercent(((counts.get(t) ?? 0) / total) * 100) : "—"])}
      />
    </Section>
  );
}
