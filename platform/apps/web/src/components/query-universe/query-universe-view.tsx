"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, Info, LayoutList, ListTree, Plus, RefreshCw, Rocket, Rows3, Shapes, Sparkles, Star, UserPen } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  RefreshOverlay,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ClearFiltersButton, FilterSelect, ResultCount, Toolbar, ToolbarSearch, ViewToggle } from "@/components/patterns/toolbar";
import { TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { NoResults } from "@/components/patterns/states";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { typography } from "@/components/patterns/typography";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
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
import { QUERY_CATEGORIES, type Query, type QueryCategory, type QueryIntentType, type QuerySet } from "@/data/query-universe/types";
import { INTENT_TYPE_LABEL, QUERY_CATEGORY_META, STATUS_BADGE_VARIANT, STATUS_LABEL, describeQueryUpgradePath } from "@/data/query-universe/constants";
import { CategorySection, IntentTag, PriorityText, RemoveQueryButton } from "./category-section";
import { CategoryCoveragePanel, IntentMixPanel } from "./coverage-panels";
import { AddQueryDialog } from "./add-query-dialog";

type BusyAction = "generate" | "activate" | "archive" | null;
type View = "grouped" | "list";

const TITLE = "Query Universe";
const DESCRIPTION = "The buying questions your customers ask AI — generated from your brand profile, curated by you. AI Visibility and SEO Intelligence both measure against the active set.";

const COLUMNS: SkeletonColumn[] = [
  { header: "Query", cell: "text" },
  { header: "Category", cell: "meta" },
  { header: "Intent", cell: "badge" },
  { header: "Priority", cell: "meta" },
];

const CATEGORY_OPTIONS = [
  { value: "all" as const, label: "All categories" },
  ...QUERY_CATEGORIES.map((c) => ({ value: c, label: QUERY_CATEGORY_META[c].label })),
];

const INTENT_OPTIONS: { value: QueryIntentType | "all"; label: string }[] = [
  { value: "all", label: "All intents" },
  ...(["informational", "commercial", "comparison", "transactional"] as QueryIntentType[]).map((t) => ({ value: t, label: INTENT_TYPE_LABEL[t] })),
];

const VIEW_OPTIONS = [
  { value: "grouped" as const, label: "By category", icon: <Rows3 size={14} /> },
  { value: "list" as const, label: "Table", icon: <LayoutList size={14} /> },
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Query Universe — "Which questions am I measured on?" Curation page:
 * the set's state and lifecycle actions in the header, the shape of the
 * set (balance across categories and intents) up top, then the queries
 * themselves, searchable and filterable, editable only while a draft.
 */
export function QueryUniverseView() {
  const { reload, isRefreshing, ...state } = useAsyncData(() => fetchQueryUniverse(), []);

  const [view, setView] = useState<View>("grouped");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<QueryCategory | "all">("all");
  const [intentFilter, setIntentFilter] = useState<QueryIntentType | "all">("all");

  const [busy, setBusy] = useState<BusyAction>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ message: string; retry: () => void } | undefined>(undefined);

  const [addOpen, setAddOpen] = useState(false);
  const [addCategory, setAddCategory] = useState<QueryCategory>("category");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const snapshot = state.status === "success" ? state.data : null;
  const focused = snapshot?.focused ?? null;
  const editable = focused?.status === "draft";
  const queries = useMemo(() => snapshot?.queries ?? [], [snapshot?.queries]);

  const hasFilters = search.trim() !== "" || categoryFilter !== "all" || intentFilter !== "all";
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return queries.filter(
      (q) =>
        (categoryFilter === "all" || q.category === categoryFilter) &&
        (intentFilter === "all" || q.intentType === intentFilter) &&
        (needle === "" || q.text.toLowerCase().includes(needle)),
    );
  }, [queries, search, categoryFilter, intentFilter]);

  const grouped = useMemo(() => {
    const byCategory = new Map<QueryCategory, Query[]>(QUERY_CATEGORIES.map((c) => [c, [] as Query[]]));
    for (const query of filtered) byCategory.get(query.category)?.push(query);
    return byCategory;
  }, [filtered]);

  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setIntentFilter("all");
  }

  async function runAction(kind: Exclude<BusyAction, null>, action: () => Promise<unknown>, fallback: string, retry: () => void) {
    setBusy(kind);
    setActionError(undefined);
    try {
      await action();
      reload();
    } catch (err) {
      setActionError({ message: err instanceof Error ? err.message : fallback, retry });
    } finally {
      setBusy(null);
    }
  }

  function handleGenerate() {
    if (focused?.status === "draft") {
      const confirmed = window.confirm(
        `Regenerating replaces the current draft and discards its ${focused.queryCount.toLocaleString()} queries, including any you've added or removed by hand. Continue?`,
      );
      if (!confirmed) return;
    }
    void runAction("generate", generateQuerySet, "Couldn't generate a query set — try again.", handleGenerate);
  }

  function handleActivate() {
    if (!focused) return;
    const replaces = snapshot?.active ? ` Your current active set (v${snapshot.active.version}) will be archived.` : "";
    if (!window.confirm(`Activate this set? AI Visibility and SEO Intelligence will measure these ${focused.queryCount.toLocaleString()} queries, and it can no longer be edited.${replaces}`)) return;
    void runAction("activate", () => activateQuerySet(focused.id), "Couldn't activate this set — try again.", handleActivate);
  }

  function handleArchive() {
    if (!focused) return;
    if (!window.confirm(`Archive "${focused.name}"? AI Visibility and SEO Intelligence will stop reading it until a new set is activated.`)) return;
    void runAction("archive", () => archiveQuerySet(focused.id), "Couldn't archive this set — try again.", handleArchive);
  }

  async function handleRemove(query: Query) {
    if (!focused) return;
    setRemovingId(query.id);
    setActionError(undefined);
    try {
      await removeQuery(focused.id, query.id);
      reload();
    } catch (err) {
      setActionError({ message: err instanceof Error ? err.message : "Couldn't remove that query — try again.", retry: () => void handleRemove(query) });
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
      setAddError(err instanceof QueryLimitError ? err.message : err instanceof Error ? err.message : "Couldn't add that query — try again.");
    } finally {
      setAddSubmitting(false);
    }
  }

  // ---- Loading / error -----------------------------------------------------

  if (state.status === "loading") {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <PageStack>
          <StatGrid>
            {["Queries", "Categories covered", "High priority", "Added by you"].map((label) => (
              <StatTile key={label} label={label} value="—" loading />
            ))}
          </StatGrid>
          <Reveal>
            <TableSkeleton columns={COLUMNS} label="Loading your query universe…" />
          </Reveal>
        </PageStack>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorPanel title="Query Universe didn't load" message={state.error.message} onRetry={reload} />
      </>
    );
  }

  if (!snapshot) return null;

  // ---- No set yet ------------------------------------------------------------

  if (!focused) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <PageStack>
          {actionError && (
            <Reveal>
              <ErrorPanel compact title="That didn't work" message={actionError.message} onRetry={actionError.retry} />
            </Reveal>
          )}
          <Reveal>
            <EmptyState
              icon={<ListTree size={20} />}
              title={snapshot.archived.length > 0 ? "No active query set" : "No query universe yet"}
              description={
                snapshot.archived.length > 0
                  ? "Your last set was archived, so nothing is being measured. Generate a new draft from your brand profile to pick up where you left off."
                  : "We'll write the buying questions your customers ask, from your categories, use cases and competitors. You review them, then activate — that's what AI Visibility measures."
              }
              action={
                <Button variant="primary" onClick={handleGenerate} loading={busy === "generate"}>
                  <Sparkles size={14} aria-hidden="true" /> Generate query universe
                </Button>
              }
              secondaryAction={
                <Button asChild variant="ghost">
                  <Link href="/settings?tab=brand">Review brand profile</Link>
                </Button>
              }
            />
          </Reveal>
          {snapshot.archived.length > 0 && <HistorySection sets={snapshot.archived} />}
        </PageStack>
      </>
    );
  }

  // ---- A draft or active set -------------------------------------------------

  const categoriesCovered = QUERY_CATEGORIES.filter((c) => queries.some((q) => q.category === c)).length;
  const highPriority = queries.filter((q) => q.priority === 1).length;
  const manual = queries.filter((q) => q.source === "manual").length;
  const capped = focused.potentialCount > focused.planLimit;
  const upgrade = capped ? describeQueryUpgradePath(focused.planTier) : undefined;

  const headerActions =
    focused.status === "draft" ? (
      <>
        <Button variant="outline" size="sm" onClick={handleGenerate} loading={busy === "generate"}>
          <RefreshCw size={14} aria-hidden="true" /> Regenerate
        </Button>
        <Button variant="primary" size="sm" onClick={handleActivate} loading={busy === "activate"} disabled={focused.queryCount === 0}>
          <Rocket size={14} aria-hidden="true" /> Activate set
        </Button>
      </>
    ) : (
      <Button variant="outline" size="sm" onClick={handleArchive} loading={busy === "archive"}>
        <Archive size={14} aria-hidden="true" /> Archive
      </Button>
    );

  const addButton = editable ? (
    <Button variant="primary" size="sm" className="h-9" onClick={() => openAddDialog(categoryFilter === "all" ? "category" : categoryFilter)}>
      <Plus size={14} aria-hidden="true" /> Add query
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        meta={
          <>
            <span className="flex items-center gap-2">
              <Badge variant={STATUS_BADGE_VARIANT[focused.status]} size="sm" dot>
                {focused.status === "draft" ? "Draft — not measured yet" : STATUS_LABEL[focused.status]}
              </Badge>
              <span className="font-medium text-foreground">{focused.name}</span>
              <span className="font-mono">v{focused.version}</span>
            </span>
            <span>
              {focused.status === "active" && focused.activatedAt
                ? `Activated ${formatDateTime(focused.activatedAt)}`
                : `Updated ${formatDateTime(focused.updatedAt)}`}
            </span>
          </>
        }
        actions={headerActions}
      />

      <PageStack>
        {actionError && (
          <Reveal>
            <ErrorPanel compact title="That didn't work" message={actionError.message} onRetry={actionError.retry} />
          </Reveal>
        )}

        <Reveal>
          <Notice>
            {focused.status === "active" ? (
              <>
                This set is live and locked — AI Visibility and SEO Intelligence measure exactly these {formatNumber(focused.queryCount)} queries. To change it,
                archive it and generate a new draft.
              </>
            ) : snapshot.active ? (
              <>
                Review this draft, then activate it. Until then, your active set{" "}
                <span className="font-medium text-foreground">v{snapshot.active.version}</span> ({formatNumber(snapshot.active.queryCount)} queries) is
                still the one being measured — activating archives it.
              </>
            ) : (
              <>Remove what doesn&apos;t fit, add what&apos;s missing, then activate. Nothing is measured until you do.</>
            )}
          </Notice>
        </Reveal>

        <StatGrid>
          <StatTile
            label="Queries"
            icon={<ListTree size={13} />}
            value={formatNumber(focused.queryCount)}
            hint={
              capped
                ? `Plan cap of ${formatNumber(focused.planLimit)} reached · ${formatNumber(focused.potentialCount)} possible`
                : `of ${formatNumber(focused.planLimit)} on ${capitalize(focused.planTier)}`
            }
          />
          <StatTile
            label="Categories covered"
            icon={<Shapes size={13} />}
            value={`${categoriesCovered}/10`}
            hint={categoriesCovered < 10 ? `${10 - categoriesCovered} unmeasured` : "Every category represented"}
          />
          <StatTile label="High priority" icon={<Star size={13} />} value={formatNumber(highPriority)} hint="Closest to a buying decision" />
          <StatTile label="Added by you" icon={<UserPen size={13} />} value={formatNumber(manual)} hint="Beyond what was generated" />
        </StatGrid>

        {capped && upgrade && (
          <Reveal>
            <Notice action={<Button asChild variant="outline" size="sm"><Link href="/settings?tab=billing">See plans</Link></Button>}>
              Your brand profile supports {formatNumber(focused.potentialCount)} queries; your plan measures {formatNumber(focused.planLimit)}. {upgrade}
            </Notice>
          </Reveal>
        )}

        {queries.length > 0 && (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            <CategoryCoveragePanel queries={queries} active={categoryFilter} onSelect={setCategoryFilter} className="lg:col-span-7" />
            <IntentMixPanel queries={queries} active={intentFilter} onSelect={setIntentFilter} className="lg:col-span-5" />
          </div>
        )}

        <Toolbar
          end={
            <>
              <ResultCount count={filtered.length} noun="query" pluralNoun="queries" />
              <ViewToggle value={view} onChange={setView} options={VIEW_OPTIONS} label="Query view" />
              {addButton}
            </>
          }
        >
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search queries" label="Search queries" />
          <FilterSelect value={categoryFilter} onValueChange={setCategoryFilter} options={CATEGORY_OPTIONS} label="Filter by category" />
          <FilterSelect value={intentFilter} onValueChange={setIntentFilter} options={INTENT_OPTIONS} label="Filter by intent" />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>

        <Reveal>
          <RefreshOverlay active={isRefreshing}>
            {queries.length === 0 ? (
              <EmptyState
                compact
                icon={<ListTree size={18} />}
                title="This set has no queries"
                description={editable ? "Add the questions your buyers ask, or regenerate from your brand profile." : "Archive it and generate a new draft to start again."}
                action={addButton ?? undefined}
              />
            ) : filtered.length === 0 ? (
              <NoResults noun="queries" onClear={clearFilters} hint="Try a different search, category or intent." />
            ) : view === "grouped" ? (
              <div className="flex flex-col gap-5">
                {QUERY_CATEGORIES.filter((c) => !hasFilters || (grouped.get(c)?.length ?? 0) > 0).map((category) => (
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
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead className="hidden sm:table-cell">Priority</TableHead>
                    <TableHead className="hidden lg:table-cell">Source</TableHead>
                    {editable && (
                      <TableHead>
                        <span className="sr-only">Remove</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((query) => (
                    <TableRow key={query.id}>
                      <TableCell className="max-w-[420px]">
                        <p className="text-[13px] text-foreground">{query.text}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className={typography.meta}>{QUERY_CATEGORY_META[query.category].label}</span>
                      </TableCell>
                      <TableCell>
                        <IntentTag intent={query.intentType} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <PriorityText priority={query.priority} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className={typography.meta}>{query.source === "manual" ? "Added by you" : "Generated"}</span>
                      </TableCell>
                      {editable && (
                        <TableCell className="w-10 text-right">
                          <RemoveQueryButton query={query} removing={removingId === query.id} onRemove={handleRemove} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </RefreshOverlay>
        </Reveal>

        {snapshot.archived.length > 0 && <HistorySection sets={snapshot.archived} />}
      </PageStack>

      <AddQueryDialog
        key={addOpen ? addCategory : "closed"}
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultCategory={addCategory}
        onSubmit={handleAddSubmit}
        submitError={addError}
        submitting={addSubmitting}
      />
    </>
  );
}

function Notice({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Info size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function HistorySection({ sets }: { sets: QuerySet[] }) {
  return (
    <Section title="Previous versions" description="Archived sets stay for reference; past AI Visibility runs keep pointing at them." flush>
      <Table framed={false}>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Queries</TableHead>
            <TableHead>Archived</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sets.map((set) => (
            <TableRow key={set.id}>
              <TableCell>
                <p className="text-[13px] text-foreground">{set.name}</p>
                <p className="font-mono text-[12px] text-muted-foreground">v{set.version}</p>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE_VARIANT[set.status]} size="sm" dot>
                  {STATUS_LABEL[set.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <span className={typography.numeric}>{formatNumber(set.queryCount)}</span>
              </TableCell>
              <TableCell>
                <span className={typography.meta}>{set.archivedAt ? formatDate(set.archivedAt) : "—"}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}
