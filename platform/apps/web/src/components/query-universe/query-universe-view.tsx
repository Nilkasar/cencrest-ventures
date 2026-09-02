"use client";

import { useMemo, useState } from "react";
import { ListTree, Search } from "lucide-react";
import {
  Badge,
  Button,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDate } from "@/lib/format";
import {
  addQuery,
  activateQuerySet,
  archiveQuerySet,
  fetchQueryUniverse,
  generateQuerySet,
  removeQuery,
  QueryLimitError,
  type NewQueryInput,
} from "@/data/query-universe/client";
import {
  QUERY_CATEGORIES,
  type Query,
  type QueryCategory,
  type QueryIntentType,
  type QuerySet,
} from "@/data/query-universe/types";
import {
  INTENT_TYPE_BADGE_VARIANT,
  INTENT_TYPE_LABEL,
  PRIORITY_LABEL,
  QUERY_CATEGORY_META,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
} from "@/data/query-universe/constants";
import { CategorySection } from "./category-section";
import { QuerySetSummaryCard } from "./query-set-summary-card";
import { AddQueryDialog } from "./add-query-dialog";

type BusyAction = "generate" | "activate" | "archive" | null;

function CategorySkeletons() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-surface-raised p-5">
          <Skeleton className="h-4 w-40 mb-3" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function QueryUniverseView() {
  const { reload, ...state } = useAsyncData(() => fetchQueryUniverse(), []);

  const [tab, setTab] = useState<"grouped" | "all">("grouped");
  const [categoryFilter, setCategoryFilter] = useState<QueryCategory | "all">("all");
  const [intentFilter, setIntentFilter] = useState<QueryIntentType | "all">("all");

  const [busy, setBusy] = useState<BusyAction>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const [addOpen, setAddOpen] = useState(false);
  const [addCategory, setAddCategory] = useState<QueryCategory>("category");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const snapshot = state.status === "success" ? state.data : null;
  const focused = snapshot?.focused ?? null;
  const editable = focused?.status === "draft";

  const grouped = useMemo(() => {
    const byCategory = new Map<QueryCategory, Query[]>(QUERY_CATEGORIES.map((c) => [c, [] as Query[]]));
    for (const query of snapshot?.queries ?? []) {
      byCategory.get(query.category)?.push(query);
    }
    return byCategory;
  }, [snapshot?.queries]);

  const filteredAll = useMemo(() => {
    return (snapshot?.queries ?? []).filter(
      (q) => (categoryFilter === "all" || q.category === categoryFilter) && (intentFilter === "all" || q.intentType === intentFilter),
    );
  }, [snapshot?.queries, categoryFilter, intentFilter]);

  async function handleGenerate() {
    if (focused?.status === "draft") {
      const confirmed = window.confirm(
        `Regenerating replaces the current draft and discards its ${focused.queryCount.toLocaleString()} queries, including any you've added or removed manually. Continue?`,
      );
      if (!confirmed) return;
    }
    setBusy("generate");
    setActionError(undefined);
    try {
      await generateQuerySet();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't generate a query set — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleActivate() {
    if (!focused) return;
    setBusy("activate");
    setActionError(undefined);
    try {
      await activateQuerySet(focused.id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't activate this set — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleArchive() {
    if (!focused) return;
    if (!window.confirm(`Archive "${focused.name}"? AI Visibility and SEO Intelligence will stop reading it until a new set is activated.`)) {
      return;
    }
    setBusy("archive");
    setActionError(undefined);
    try {
      await archiveQuerySet(focused.id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't archive this set — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(query: Query) {
    if (!focused) return;
    setRemovingId(query.id);
    setActionError(undefined);
    try {
      await removeQuery(focused.id, query.id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't remove that query — try again.");
    } finally {
      setRemovingId(null);
    }
  }

  function openAddDialog(category: QueryCategory) {
    setAddCategory(category);
    setAddError(undefined);
    setAddOpen(true);
  }

  async function handleAddSubmit(values: NewQueryInput) {
    if (!focused) return;
    setAddSubmitting(true);
    setAddError(undefined);
    try {
      await addQuery(focused.id, values);
      reload();
      setAddOpen(false);
    } catch (err) {
      if (err instanceof QueryLimitError) {
        setAddError(err.message);
      } else {
        setAddError(err instanceof Error ? err.message : "Couldn't add that query — try again.");
      }
    } finally {
      setAddSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-32 w-full rounded-xl" />
        <CategorySkeletons />
      </div>
    );
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  if (!snapshot) return null;

  if (!focused) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          icon={<ListTree size={20} />}
          eyebrow="Query universe"
          title={snapshot.archived.length > 0 ? "Your last query set was archived" : "No query universe yet"}
          description={
            snapshot.archived.length > 0
              ? "Generate a new draft from your brand profile to keep curating — the archived set below stays for reference."
              : "Generate a query set from your brand's categories, use cases, and competitors — then remove what doesn't fit and add what's missing before activating it."
          }
          action={
            <Button variant="primary" size="sm" onClick={handleGenerate} loading={busy === "generate"}>
              Generate query universe
            </Button>
          }
        />
        {actionError && <ErrorPanel compact message={actionError} onRetry={handleGenerate} />}
        {snapshot.archived.length > 0 && <HistoryTable sets={snapshot.archived} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <QuerySetSummaryCard
        querySet={focused}
        onRegenerate={handleGenerate}
        onActivate={handleActivate}
        onArchive={handleArchive}
        busy={busy}
      />

      {actionError && <ErrorPanel compact message={actionError} onRetry={reload} />}

      {snapshot.active && focused.status === "draft" && (
        <p className="text-[12.5px] text-muted-foreground -mt-2">
          You also have an active set — <span className="font-medium text-foreground">v{snapshot.active.version}</span> (
          {snapshot.active.queryCount.toLocaleString()} queries) — currently read by AI Visibility and SEO Intelligence. Activating this
          draft will archive it.
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "grouped" | "all")}>
        <TabsList>
          <TabsTrigger value="grouped">Grouped by category</TabsTrigger>
          <TabsTrigger value="all">All queries ({snapshot.queries.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="grouped">
          <div className="flex flex-col gap-4">
            {QUERY_CATEGORIES.map((category) => (
              <CategorySection
                key={category}
                category={category}
                queries={grouped.get(category) ?? []}
                editable={editable}
                removingId={removingId}
                onRemove={handleRemove}
                onAdd={openAddDialog}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="all">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as QueryCategory | "all")}>
                <SelectTrigger className="w-48" aria-label="Filter by category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {QUERY_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {QUERY_CATEGORY_META[cat].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={intentFilter} onValueChange={(v) => setIntentFilter(v as QueryIntentType | "all")}>
                <SelectTrigger className="w-44" aria-label="Filter by intent type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All intent types</SelectItem>
                  {(["informational", "commercial", "comparison", "transactional"] as QueryIntentType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {INTENT_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(categoryFilter !== "all" || intentFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCategoryFilter("all");
                    setIntentFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>

            {filteredAll.length === 0 ? (
              <EmptyState
                compact
                icon={<Search size={18} />}
                title="No queries match these filters"
                description="Try a different category or intent type."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Source</TableHead>
                    {editable && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAll.map((query) => (
                    <TableRow key={query.id}>
                      <TableCell className="max-w-[420px] truncate">{query.text}</TableCell>
                      <TableCell className="text-muted-foreground">{QUERY_CATEGORY_META[query.category].label}</TableCell>
                      <TableCell>
                        <Badge variant={INTENT_TYPE_BADGE_VARIANT[query.intentType]} size="sm">
                          {INTENT_TYPE_LABEL[query.intentType]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{PRIORITY_LABEL[query.priority]}</TableCell>
                      <TableCell className="text-muted-foreground">{query.source === "manual" ? "Manual" : "Generated"}</TableCell>
                      {editable && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-subtle-foreground hover:text-danger"
                            loading={removingId === query.id}
                            onClick={() => handleRemove(query)}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {snapshot.archived.length > 0 && <HistoryTable sets={snapshot.archived} />}

      <AddQueryDialog
        key={addOpen ? addCategory : "closed"}
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultCategory={addCategory}
        onSubmit={handleAddSubmit}
        submitError={addError}
        submitting={addSubmitting}
      />
    </div>
  );
}

function HistoryTable({ sets }: { sets: QuerySet[] }) {
  return (
    <section>
      <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-subtle-foreground mb-2">Previous versions</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Queries</TableHead>
            <TableHead>Archived</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sets.map((set) => (
            <TableRow key={set.id}>
              <TableCell className="font-mono">v{set.version}</TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE_VARIANT[set.status]} size="sm">
                  {STATUS_LABEL[set.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{set.queryCount.toLocaleString()}</TableCell>
              <TableCell className="text-muted-foreground">{set.archivedAt ? formatDate(set.archivedAt) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
